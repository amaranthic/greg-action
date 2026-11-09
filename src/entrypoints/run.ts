#!/usr/bin/env bun
/**
 * @fileoverview Main entrypoint orchestrator for Greg Action.
 *
 * Coordinates context parsing, actor permissions, mode auto-detection,
 * execution dispatch (tag, review, automation), step summary generation,
 * and output registration.
 *
 * @packageDocumentation
 */

import * as core from "@actions/core";
import { parseGitHubContext, isEntityContext } from "../github/context.js";
import { validateActor } from "../github/validation/actor.js";
import { checkWritePermissions } from "../github/validation/permissions.js";
import { checkContainsTrigger } from "../github/validation/trigger.js";
import { resolveGitHubToken } from "../github/token.js";
import { createOctokit } from "../github/api/client.js";
import { detectMode } from "../modes/detector.js";
import { executeTagMode } from "../modes/tag/index.js";
import { executeReviewMode } from "../modes/review/index.js";
import { executeAutomationMode } from "../modes/automation/index.js";
import { resolveBaseUrl } from "../utils/credentials.js";
import { writeStepSummary } from "../output/summary.js";

/**
 * Main execution function for Greg Action.
 */
export async function run(): Promise<void> {
  let modeName = "automation";
  let modelName = "unknown";
  let branchName: string | undefined;
  let fullResponse = "";
  let toolsUsed: readonly string[] = [];
  let conclusion: "success" | "failure" = "success";
  let errorMessage: string | undefined;

  try {
    // 1. Parse GitHub Context
    const context = parseGitHubContext();
    modelName = context.inputs.model;

    core.info(
      `Greg Action initialized for repository: ${context.repository.fullName}`
    );
    core.info(`Triggered event: ${context.eventName}`);

    // 2. Validate actor (loop prevention for bots)
    validateActor(context);

    // 3. Resolve GitHub token and initialize Octokit
    const githubToken = resolveGitHubToken(context.inputs.githubToken);
    const octokits = createOctokit(githubToken);

    // 4. Verify actor repository permissions
    const hasWriteAccess = await checkWritePermissions(octokits.rest, context);
    if (!hasWriteAccess) {
      core.setFailed(
        `Actor "${context.actor}" does not have write access to this repository.`
      );
      return;
    }

    // 5. Detect execution mode
    modeName = detectMode(context);
    core.info(`Auto-detected execution mode: ${modeName}`);

    // 6. Check trigger condition for tag mode
    if (modeName === "tag") {
      const isTriggered = checkContainsTrigger(context);
      if (!isTriggered) {
        core.info(
          `Trigger phrase "${context.inputs.triggerPhrase}" not found. Skipping execution.`
        );
        core.setOutput("conclusion", "skipped");
        return;
      }
    }

    // 7. Resolve model credentials
    const apiKey = context.inputs.apiKey;
    if (!apiKey) {
      throw new Error(
        "Missing AI API key. Please supply `api_key` in action inputs or set ANTHROPIC_API_KEY / OPENAI_API_KEY."
      );
    }
    const baseUrl = resolveBaseUrl(
      context.inputs.model,
      context.inputs.baseUrl
    );

    // 8. Execute corresponding mode handler
    if (modeName === "tag" && isEntityContext(context)) {
      const result = await executeTagMode({
        octokits,
        context,
        githubToken,
        apiKey,
        baseUrl,
      });
      conclusion = result.conclusion;
      branchName = result.branchName;
      fullResponse = result.fullResponse;
      toolsUsed = result.toolsUsed;
      errorMessage = result.errorMessage;
    } else if (modeName === "review" && isEntityContext(context)) {
      const result = await executeReviewMode({
        octokits,
        context,
        apiKey,
        baseUrl,
      });
      conclusion = result.conclusion;
      fullResponse = result.fullResponse;
      toolsUsed = result.toolsUsed;
      errorMessage = result.errorMessage;
    } else {
      const result = await executeAutomationMode({
        context,
        apiKey,
        baseUrl,
      });
      conclusion = result.conclusion;
      fullResponse = result.fullResponse;
      toolsUsed = result.toolsUsed;
      errorMessage = result.errorMessage;
    }

    // 9. Register action outputs
    core.setOutput("conclusion", conclusion);
    if (branchName) {
      core.setOutput("branch_name", branchName);
    }
    core.setOutput("github_token", githubToken);

    // Emit structured JSON output
    const structuredOutput = JSON.stringify({
      conclusion,
      mode: modeName,
      branchName,
      toolsUsed,
      summary: fullResponse.slice(-1000),
    });
    core.setOutput("structured_output", structuredOutput);

    if (conclusion === "failure") {
      core.setFailed(errorMessage || "Action completed with failure.");
    }
  } catch (err) {
    conclusion = "failure";
    errorMessage = err instanceof Error ? err.message : String(err);
    core.setFailed(`Action execution failed: ${errorMessage}`);
  } finally {
    // 10. Always write step summary report
    writeStepSummary({
      mode: modeName,
      model: modelName,
      turnsExecuted: 1,
      toolsUsed,
      branchName,
      responseText: fullResponse,
      conclusion,
      errorMessage,
    });
  }
}

if (import.meta.main) {
  run();
}
