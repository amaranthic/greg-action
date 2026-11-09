/**
 * @fileoverview Trigger condition evaluation for issues, PRs, and comments.
 *
 * Checks whether an incoming GitHub event satisfies trigger requirements:
 * mention phrase (`@greg`), assignee, label, or direct prompt input.
 *
 * @packageDocumentation
 */

import * as core from "@actions/core";
import type { EntityGregContext, GregContext } from "../context.js";
import { isEntityContext } from "../context.js";

/**
 * Escapes special regex characters in a candidate string.
 */
function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Tests if target text contains the trigger phrase as a distinct word token.
 *
 * @param text - Source text to inspect.
 * @param triggerPhrase - Mention phrase to seek (e.g. `@greg`).
 * @returns True if phrase is present as a token.
 */
export function containsTriggerPhrase(
  text: string,
  triggerPhrase: string
): boolean {
  if (!text || !triggerPhrase) {
    return false;
  }
  const escaped = escapeRegExp(triggerPhrase.trim());
  const regex = new RegExp(`(^|\\s)${escaped}([\\s.,!?;:]|$)`, "i");
  return regex.test(text);
}

/**
 * Checks whether the incoming context matches trigger conditions.
 *
 * @param context - The Greg context.
 * @returns True if the action was triggered to run.
 */
export function checkContainsTrigger(context: GregContext): boolean {
  const { prompt, triggerPhrase, assigneeTrigger, labelTrigger } =
    context.inputs;

  // 1. Direct prompt supplied in workflow configuration
  if (prompt && prompt.trim()) {
    core.info("Prompt provided in action inputs; trigger condition met.");
    return true;
  }

  if (!isEntityContext(context)) {
    return false;
  }

  const entityContext = context as EntityGregContext;

  // 2. Issue comment event
  if (entityContext.eventName === "issue_comment") {
    const commentBody =
      (entityContext.payload as { comment?: { body?: string } }).comment
        ?.body || "";
    if (containsTriggerPhrase(commentBody, triggerPhrase)) {
      core.info(`Comment contains trigger phrase "${triggerPhrase}".`);
      return true;
    }
  }

  // 3. PR review comment event
  if (entityContext.eventName === "pull_request_review_comment") {
    const commentBody =
      (entityContext.payload as { comment?: { body?: string } }).comment
        ?.body || "";
    if (containsTriggerPhrase(commentBody, triggerPhrase)) {
      core.info(
        `PR review comment contains trigger phrase "${triggerPhrase}".`
      );
      return true;
    }
  }

  // 4. PR review event
  if (entityContext.eventName === "pull_request_review") {
    const reviewBody =
      (entityContext.payload as { review?: { body?: string } }).review?.body ||
      "";
    if (containsTriggerPhrase(reviewBody, triggerPhrase)) {
      core.info(`PR review contains trigger phrase "${triggerPhrase}".`);
      return true;
    }
  }

  // 5. Issues event (opened, labeled, assigned)
  if (entityContext.eventName === "issues") {
    const payload = entityContext.payload as {
      action?: string;
      issue?: { title?: string; body?: string };
      label?: { name?: string };
      assignee?: { login?: string };
    };

    if (payload.action === "assigned" && assigneeTrigger) {
      const cleanTarget = assigneeTrigger.replace(/^@/, "").toLowerCase();
      if (payload.assignee?.login?.toLowerCase() === cleanTarget) {
        core.info(`Issue assigned to trigger assignee "${assigneeTrigger}".`);
        return true;
      }
    }

    if (payload.action === "labeled" && labelTrigger) {
      if (payload.label?.name?.toLowerCase() === labelTrigger.toLowerCase()) {
        core.info(`Issue labeled with trigger label "${labelTrigger}".`);
        return true;
      }
    }

    if (payload.action === "opened") {
      const title = payload.issue?.title || "";
      const body = payload.issue?.body || "";
      if (
        containsTriggerPhrase(title, triggerPhrase) ||
        containsTriggerPhrase(body, triggerPhrase)
      ) {
        core.info(
          `Issue title or body contains trigger phrase "${triggerPhrase}".`
        );
        return true;
      }
    }
  }

  // 6. Pull request event (opened)
  if (
    entityContext.eventName === "pull_request" ||
    entityContext.eventName === "pull_request_target"
  ) {
    const payload = entityContext.payload as {
      action?: string;
      pull_request?: { title?: string; body?: string };
    };

    if (
      payload.action === "opened" ||
      payload.action === "synchronize" ||
      payload.action === "ready_for_review"
    ) {
      const title = payload.pull_request?.title || "";
      const body = payload.pull_request?.body || "";
      if (
        containsTriggerPhrase(title, triggerPhrase) ||
        containsTriggerPhrase(body, triggerPhrase)
      ) {
        core.info(
          `Pull request title or body contains trigger phrase "${triggerPhrase}".`
        );
        return true;
      }
    }
  }

  return false;
}
