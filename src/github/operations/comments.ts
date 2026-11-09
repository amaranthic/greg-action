/**
 * @fileoverview GitHub sticky tracking comment management.
 *
 * Creates and dynamically updates a live progress tracking comment on issues and PRs,
 * keeping developers informed of Greg's execution stages in real time.
 *
 * @packageDocumentation
 */

import * as core from "@actions/core";
import type { Octokit } from "@octokit/rest";
import type { EntityGregContext } from "../context.js";

/**
 * Progress checklist items shown in the live sticky comment.
 */
export interface CommentProgressState {
  readonly environmentReady?: boolean;
  readonly branchConfigured?: boolean;
  readonly runningTurn?: boolean;
  readonly turnCompleted?: boolean;
  readonly branchName?: string;
  readonly responseSummary?: string;
  readonly error?: string;
}

/**
 * Builds the Markdown body for a tracking comment from current progress state.
 *
 * @param owner - Repository owner login.
 * @param repo - Repository name.
 * @param runId - GitHub Actions run ID.
 * @param state - Current progress flags and data.
 * @returns Formatted Markdown comment string.
 */
export function buildCommentBody(
  owner: string,
  repo: string,
  runId: string,
  state: CommentProgressState
): string {
  const runUrl = `https://github.com/${owner}/${repo}/actions/runs/${runId}`;
  const header = `### 🤖 Greg is on it ([view run logs](${runUrl}))\n\n`;

  const items = [
    `- [${state.environmentReady ? "x" : " "}] Initializing environment & security policies`,
    `- [${state.branchConfigured ? "x" : " "}] Setting up workspace branch`,
    `- [${state.runningTurn || state.turnCompleted ? "x" : " "}] Executing engineering turn`,
  ];

  if (state.branchName) {
    items.push(`- [x] Pushed changes to branch: \`${state.branchName}\``);
  }

  let body = header + items.join("\n") + "\n\n";

  if (state.responseSummary) {
    body += `---\n\n#### Summary of Changes\n\n${state.responseSummary}\n`;
  }

  if (state.error) {
    body += `\n> [!CAUTION]\n> Execution failed: ${state.error}\n`;
  }

  return body;
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
