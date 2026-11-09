/**
 * @fileoverview GitHub sticky tracking comment management.
 *
 * Creates and dynamically updates a live progress tracking comment on issues and PRs,
 * keeping developers informed of Greg's execution stages in real time with clean,
 * emoji-free Markdown logs and tool call details.
 *
 * @packageDocumentation
 */

import * as core from "@actions/core";
import type { Octokit } from "@octokit/rest";
import type { EntityGregContext } from "../context.js";

/**
 * Record of a single tool execution for progress logging.
 */
export interface ToolActivityRecord {
  /** Unique invocation identifier. */
  readonly callId?: string;
  /** Name of the tool executed (e.g. `ReadFile`, `Bash`). */
  readonly toolName: string;
  /** Primary argument summary (e.g. file path, shell command). */
  readonly detail?: string;
  /** Whether the tool completed with an error. */
  readonly isError?: boolean;
  /** Execution duration in milliseconds. */
  readonly durationMs?: number;
}

/**
 * Progress checklist items and status shown in the tracking comment.
 */
export interface CommentProgressState {
  readonly environmentReady?: boolean;
  readonly branchConfigured?: boolean;
  readonly runningTurn?: boolean;
  readonly turnCompleted?: boolean;
  readonly branchName?: string;
  readonly responseSummary?: string;
  readonly error?: string;
  readonly triggerActor?: string;
  readonly durationMs?: number;
  readonly toolActivities?: readonly ToolActivityRecord[];
}

/**
 * Formats a duration in milliseconds into a concise string (e.g. '45s', '2m 15s').
 *
 * @param durationMs - Time elapsed in milliseconds.
 * @returns Formatted human-readable duration string.
 *
 * @example
 * ```typescript
 * formatDuration(45000); // returns '45s'
 * formatDuration(125000); // returns '2m 5s'
 * ```
 */
export function formatDuration(durationMs: number): string {
  const totalSeconds = Math.max(1, Math.round(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

/**
 * Extracts a concise summary string from tool invocation parameters.
 *
 * @param parameters - Parameter dictionary passed to the tool.
 * @returns Concise parameter detail string.
 *
 * @example
 * ```typescript
 * extractToolParameterDetail({ filePath: "src/index.ts" }); // returns 'src/index.ts'
 * ```
 */
export function extractToolParameterDetail(
  parameters: Record<string, unknown>
): string {
  if (typeof parameters.filePath === "string") return parameters.filePath;
  if (typeof parameters.path === "string") return parameters.path;
  if (typeof parameters.command === "string") {
    const cmd = parameters.command.trim();
    return cmd.length > 60 ? `${cmd.slice(0, 57)}...` : cmd;
  }
  if (typeof parameters.pattern === "string") return parameters.pattern;
  if (typeof parameters.query === "string") return parameters.query;
  if (typeof parameters.action === "string") return parameters.action;
  return "";
}

/**
 * Builds the Markdown body for a tracking comment from current progress state.
 * Structured cleanly without emojis, mirroring the Claude Code Action format.
 *
 * @param owner - Repository owner login.
 * @param repo - Repository name.
 * @param runId - GitHub Actions run ID.
 * @param state - Current progress flags and data.
 * @returns Formatted clean Markdown comment string.
 */
export function buildCommentBody(
  owner: string,
  repo: string,
  runId: string,
  state: CommentProgressState
): string {
  const runUrl = `https://github.com/${owner}/${repo}/actions/runs/${runId}`;
  const durationStr =
    state.durationMs !== undefined ? formatDuration(state.durationMs) : "";

  let header = "";
  if (state.error) {
    header = `**Greg encountered an error${durationStr ? ` after ${durationStr}` : ""}**`;
  } else if (state.turnCompleted) {
    const actorPart = state.triggerActor
      ? ` @${state.triggerActor}'s task`
      : " task";
    header = `**Greg finished${actorPart}${durationStr ? ` in ${durationStr}` : ""}**`;
  } else {
    header = "**Greg is working...**";
  }

  let links = ` —— [View job](${runUrl})`;
  if (state.branchName) {
    const branchUrl = `https://github.com/${owner}/${repo}/tree/${encodeURIComponent(state.branchName)}`;
    links += ` • [\`${state.branchName}\`](${branchUrl})`;
  }

  let body = `${header}${links}\n\n`;

  if (!state.turnCompleted && !state.error) {
    body += "I am analyzing this and executing the task.\n\n";
  }

  if (state.toolActivities && state.toolActivities.length > 0) {
    const count = state.toolActivities.length;
    const toolPlural = count === 1 ? "call" : "calls";
    body += `<details>\n<summary>Tool activity (${count} ${toolPlural})</summary>\n\n`;
    for (const activity of state.toolActivities) {
      const detailStr = activity.detail ? ` (\`${activity.detail}\`)` : "";
      const statusStr = activity.isError ? " - failed" : "";
      const timeStr =
        activity.durationMs !== undefined
          ? ` (${formatDuration(activity.durationMs)})`
          : "";
      body += `- \`${activity.toolName}\`${detailStr}${timeStr}${statusStr}\n`;
    }
    body += "\n</details>\n\n";
  }

  if (state.error) {
    body += `\`\`\`\n${state.error}\n\`\`\`\n\n`;
  }

  if (state.responseSummary) {
    body += `---\n\n${state.responseSummary}\n`;
  }

  return body.trim();
}

/**
 * Creates the initial tracking comment on the issue or PR.
 *
 * @param octokit - Authenticated Octokit REST instance.
 * @param context - Entity context.
 * @returns The created comment ID.
 */
export async function createInitialTrackingComment(
  octokit: Octokit,
  context: EntityGregContext
): Promise<number> {
  const { owner, repo } = context.repository;
  const initialBody = buildCommentBody(owner, repo, context.runId, {
    environmentReady: true,
    triggerActor: context.actor,
  });

  try {
    const response = await octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: context.entityNumber,
      body: initialBody,
    });
    core.info(`Created initial tracking comment #${response.data.id}`);
    return response.data.id;
  } catch (err) {
    core.error(`Failed to create initial tracking comment: ${err}`);
    throw err;
  }
}

/**
 * Updates an existing tracking comment with new progress or final results.
 *
 * @param octokit - Authenticated Octokit instance.
 * @param context - Entity context.
 * @param commentId - The ID of the comment to update.
 * @param state - Updated progress state.
 */
export async function updateTrackingComment(
  octokit: Octokit,
  context: EntityGregContext,
  commentId: number,
  state: CommentProgressState
): Promise<void> {
  const { owner, repo } = context.repository;
  const body = buildCommentBody(owner, repo, context.runId, state);

  try {
    await octokit.rest.issues.updateComment({
      owner,
      repo,
      comment_id: commentId,
      body,
    });
  } catch (err) {
    core.warning(`Failed to update tracking comment #${commentId}: ${err}`);
  }
}
