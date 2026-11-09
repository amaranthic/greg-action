/**
 * @fileoverview Parsing and typing for GitHub Actions execution contexts.
 *
 * Normalizes webhook payloads, issue/PR metadata, and action inputs into
 * a strongly-typed GregContext object.
 *
 * @packageDocumentation
 */

import * as github from "@actions/github";
import * as core from "@actions/core";
import type {
  IssuesEvent,
  IssueCommentEvent,
  PullRequestEvent,
  PullRequestReviewEvent,
  PullRequestReviewCommentEvent,
  WorkflowRunEvent,
} from "@octokit/webhooks-types";

/**
 * Event names that represent conversational or review entities (issues, PRs, comments).
 */
export const ENTITY_EVENT_NAMES = [
  "issues",
  "issue_comment",
  "pull_request",
  "pull_request_target",
  "pull_request_review",
  "pull_request_review_comment",
] as const;

/**
 * Event names that represent background or automated execution.
 */
export const AUTOMATION_EVENT_NAMES = [
  "workflow_dispatch",
  "repository_dispatch",
  "schedule",
  "workflow_run",
  "push",
] as const;

export type EntityEventName = (typeof ENTITY_EVENT_NAMES)[number];
export type AutomationEventName = (typeof AUTOMATION_EVENT_NAMES)[number];

/**
 * Strongly typed inputs supplied to Greg Action.
 */
export interface GregInputs {
  readonly prompt: string;
  readonly triggerPhrase: string;
  readonly assigneeTrigger: string;
  readonly labelTrigger: string;
  readonly baseBranch?: string;
  readonly branchPrefix: string;
  readonly branchNameTemplate?: string;
  readonly allowedTools: string;
  readonly disallowedTools: string;
  readonly mode?: string;
  readonly model: string;
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly useStickyComment: boolean;
  readonly allowedBots: string;
  readonly maxTurns: number;
  readonly instructions: string;
  readonly githubToken: string;
}

/**
 * Common metadata present across all GitHub event types.
 */
export interface BaseGregContext {
  readonly runId: string;
  readonly eventAction?: string;
  readonly repository: {
    readonly owner: string;
    readonly repo: string;
    readonly fullName: string;
    readonly defaultBranch?: string;
  };
  readonly actor: string;
  readonly inputs: GregInputs;
}

/**
 * Context for entity-based triggers (issue, pull request, or comment).
 */
export interface EntityGregContext extends BaseGregContext {
  readonly eventName: EntityEventName;
  readonly payload:
    | IssuesEvent
    | IssueCommentEvent
    | PullRequestEvent
    | PullRequestReviewEvent
    | PullRequestReviewCommentEvent;
  readonly entityNumber: number;
  readonly isPR: boolean;
}

/**
 * Context for automation triggers (workflow_dispatch, schedule, push, etc.).
 */
export interface AutomationGregContext extends BaseGregContext {
  readonly eventName: AutomationEventName | string;
  readonly payload: Record<string, unknown>;
}

/**
 * Union representing any valid Greg Action context.
 */
export type GregContext = EntityGregContext | AutomationGregContext;

/**
 * Type guard checking if the context represents an issue or pull request entity.
 *
 * @param context - The Greg context to test.
 * @returns True if context is an EntityGregContext.
 */
export function isEntityContext(
  context: GregContext
): context is EntityGregContext {
  return "entityNumber" in context;
}

/**
 * Helper to retrieve an action input or fall back to an environment variable.
 */
function readInput(
  name: string,
  fallbackEnvVar?: string,
  defaultValue = ""
): string {
  const fromCore = core.getInput(name);
  if (fromCore) return fromCore.trim();
  if (fallbackEnvVar && process.env[fallbackEnvVar]) {
    return process.env[fallbackEnvVar]!.trim();
  }
  return defaultValue;
}

/**
 * Parses the current GitHub Actions runner environment and event payload into a typed GregContext.
 *
 * @returns Fully populated GregContext.
 */
export function parseGitHubContext(): GregContext {
  const context = github.context;

  const rawMaxTurns = parseInt(readInput("max_turns", "MAX_TURNS", "50"), 10);
  const maxTurns =
    Number.isFinite(rawMaxTurns) && rawMaxTurns > 0 ? rawMaxTurns : 50;

  const inputs: GregInputs = {
    prompt: readInput("prompt", "PROMPT"),
    triggerPhrase: readInput("trigger_phrase", "TRIGGER_PHRASE", "@greg"),
    assigneeTrigger: readInput("assignee_trigger", "ASSIGNEE_TRIGGER", "greg"),
    labelTrigger: readInput("label_trigger", "LABEL_TRIGGER", "greg"),
    baseBranch: readInput("base_branch", "BASE_BRANCH") || undefined,
    branchPrefix: readInput("branch_prefix", "BRANCH_PREFIX", "greg/"),
    branchNameTemplate:
      readInput("branch_name_template", "BRANCH_NAME_TEMPLATE") || undefined,
    allowedTools: readInput("allowed_tools", "ALLOWED_TOOLS"),
    disallowedTools: readInput("disallowed_tools", "DISALLOWED_TOOLS"),
    mode: readInput("mode", "MODE") || undefined,
    model: readInput("model", "MODEL", "dummy"),
    apiKey:
      readInput("api_key", "API_KEY") ||
      process.env.ANTHROPIC_API_KEY ||
      process.env.OPENAI_API_KEY ||
      "",
    baseUrl: readInput("base_url", "BASE_URL") || "",
    useStickyComment:
      readInput("use_sticky_comment", "USE_STICKY_COMMENT", "true") !== "false",
    allowedBots: readInput("allowed_bots", "ALLOWED_BOTS"),
    maxTurns,
    instructions: readInput("instructions", "INSTRUCTIONS"),
    githubToken:
      readInput("github_token", "GITHUB_TOKEN") ||
      process.env.GITHUB_TOKEN ||
      "",
  };

  const defaultBranch =
    (context.payload.repository as { default_branch?: string } | undefined)
      ?.default_branch ?? "main";

  const commonFields: BaseGregContext = {
    runId: String(context.runId ?? process.env.GITHUB_RUN_ID ?? "0"),
    eventAction: context.payload.action,
    repository: {
      owner: context.repo.owner,
      repo: context.repo.repo,
      fullName: `${context.repo.owner}/${context.repo.repo}`,
      defaultBranch,
    },
    actor: context.actor,
    inputs,
  };

  switch (context.eventName) {
    case "issues": {
      const payload = context.payload as IssuesEvent;
      return {
        ...commonFields,
        eventName: "issues",
        payload,
        entityNumber: payload.issue.number,
        isPR: false,
      };
    }

    case "issue_comment": {
      const payload = context.payload as IssueCommentEvent;
      return {
        ...commonFields,
        eventName: "issue_comment",
        payload,
        entityNumber: payload.issue.number,
        isPR: Boolean(payload.issue.pull_request),
      };
    }

    case "pull_request":
    case "pull_request_target": {
      const payload = context.payload as PullRequestEvent;
      return {
        ...commonFields,
        eventName: context.eventName as EntityEventName,
        payload,
        entityNumber: payload.pull_request.number,
        isPR: true,
      };
    }

    case "pull_request_review": {
      const payload = context.payload as PullRequestReviewEvent;
      return {
        ...commonFields,
        eventName: "pull_request_review",
        payload,
        entityNumber: payload.pull_request.number,
        isPR: true,
      };
    }

    case "pull_request_review_comment": {
      const payload = context.payload as PullRequestReviewCommentEvent;
      return {
        ...commonFields,
        eventName: "pull_request_review_comment",
        payload,
        entityNumber: payload.pull_request.number,
        isPR: true,
      };
    }

    default: {
      return {
        ...commonFields,
        eventName: context.eventName,
        payload: context.payload as Record<string, unknown>,
      };
    }
  }
}
