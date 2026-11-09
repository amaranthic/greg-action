/**
 * @fileoverview Tag mode execution handler.
 *
 * Implements interactive @greg mentions on PRs and issues:
 * - Checks out PR branch or creates a new working branch.
 * - Posts and updates a live sticky tracking comment on GitHub.
 * - Restores sensitive project configs from the base branch (security).
 * - Executes the agent turn loop using Harnex AgentEngine.
 * - Commits and pushes any code modifications back to the branch.
 *
 * @packageDocumentation
 */

import * as core from "@actions/core";
import { AgentEngine, ToolRegistry } from "@amaranthic/hernex";
import type { Octokits } from "../../github/api/client.js";
import type { EntityGregContext } from "../../github/context.js";
import { setupBranch, execGit } from "../../github/operations/branch.js";
import {
  createInitialTrackingComment,
  updateTrackingComment,
} from "../../github/operations/comments.js";
import { configureGit } from "../../github/operations/git-config.js";
import { restoreConfigFromBase } from "../../github/operations/restore-config.js";
import { fetchEntityData } from "../../github/data/fetcher.js";
import { buildPrompts } from "../../prompt/builder.js";
import {
  parseToolRuleList,
  evaluateToolPolicy,
} from "../../policy/toolPermissions.js";
import { getDefaultToolsForMode } from "../../policy/modeDefaults.js";

/**
 * Result returned by tag mode execution.
 */
export interface TagModeResult {
  readonly conclusion: "success" | "failure";
  readonly branchName?: string;
  readonly fullResponse: string;
  readonly toolsUsed: readonly string[];
  readonly turnsExecuted: number;
  readonly commentId?: number;
  readonly errorMessage?: string;
}

/**
 * Executes Greg in interactive tag mode.
 *
 * @param options - Execution parameters.
 * @returns Result object detailing the turn outcome.
 */
export async function executeTagMode(options: {
  readonly octokits: Octokits;
  readonly context: EntityGregContext;
  readonly githubToken: string;
  readonly apiKey: string;
  readonly baseUrl: string;
}): Promise<TagModeResult> {
  const { octokits, context, githubToken, apiKey, baseUrl } = options;
  const toolsUsed = new Set<string>();
  let commentId: number | undefined;
  let fullResponse = "";
  let branchName: string | undefined;

  try {
    // 1. Create sticky tracking comment
    if (context.inputs.useStickyComment) {
      commentId = await createInitialTrackingComment(octokits.rest, context);
    }

    // 2. Setup branch and git credentials
    const branchInfo = await setupBranch(octokits, context);
    branchName = branchInfo.gregBranch || branchInfo.currentBranch;

    configureGit(githubToken, context);

    if (commentId) {
      await updateTrackingComment(octokits.rest, context, commentId, {
        environmentReady: true,
        branchConfigured: true,
      });
    }

    // 3. Restore security-critical configs on PR contexts
    if (context.isPR) {
      restoreConfigFromBase(branchInfo.baseBranch);
    }

    // 4. Fetch GitHub entity discussion context and build prompts
    const entityData = await fetchEntityData(octokits, context);
    const { systemPrompt, initialPrompt } = buildPrompts({
      mode: "tag",
      context,
      entityData,
      currentBranch: branchName,
    });

    // 5. Setup Harnex ToolRegistry and evaluate policies
    const tools = new ToolRegistry({ includeDefaults: true });
    const allowedRules = parseToolRuleList(context.inputs.allowedTools);
    const disallowedRules = parseToolRuleList(context.inputs.disallowedTools);
    const defaultAllowedTools = getDefaultToolsForMode("tag");

    // 6. Initialize Harnex AgentEngine
    const engine = new AgentEngine({
      threadId: `greg-${context.runId}`,
      workingDirectory: process.cwd(),
      model: context.inputs.model,
      apiKey,
      baseUrl,
      tools,
      instructions: systemPrompt,
      maxSteps: context.inputs.maxTurns * 5,
      persist: false,
      checkpoint: false,
      hooks: {
        onAuthorizeTool: async ({ toolName, parameters }) => {
          toolsUsed.add(toolName);
          const evaluation = evaluateToolPolicy({
            toolName,
            parameters: (parameters as Record<string, unknown>) || {},
            allowedRules,
            disallowedRules,
            defaultAllowedTools,
          });

          if (evaluation.decision === "deny") {
            core.warning(
              `Denied tool call "${toolName}": ${evaluation.reason}`
            );
            return {
              decision: "deny",
              reason: evaluation.reason || "Policy denied",
            };
          }

          return { decision: "allow" };
        },
      },
    });

    if (commentId) {
      await updateTrackingComment(octokits.rest, context, commentId, {
        environmentReady: true,
        branchConfigured: true,
        runningTurn: true,
      });
    }

    // 7. Stream turn execution via Harnex
    for await (const event of engine.runTurn(initialPrompt)) {
      if (event.type === "tokenDelta") {
        fullResponse += event.text;
      } else if (event.type === "toolExecutionStarted") {
        core.info(`Tool started: ${event.toolName}`);
      }
    }

    // 8. Commit and push any code changes if files were modified
    try {
      const gitStatus = execGit(["status", "--porcelain"]);
      if (gitStatus.trim().length > 0) {
        core.info(
          "Working directory changes detected. Committing and pushing..."
        );
        execGit(["add", "-A"]);
        execGit([
          "commit",
          "-m",
          `🤖 Greg: implement changes for #${context.entityNumber}`,
        ]);
        if (branchName) {
          execGit(["push", "-u", "origin", branchName]);
          core.info(`Pushed branch ${branchName} to origin.`);
        }
      }
    } catch (gitErr) {
      core.warning(`Failed to push changes: ${gitErr}`);
    }

    // 9. Finalize tracking comment
    if (commentId) {
      await updateTrackingComment(octokits.rest, context, commentId, {
        environmentReady: true,
        branchConfigured: true,
        turnCompleted: true,
        branchName,
        responseSummary: fullResponse.slice(-3000),
      });
    }

    return {
      conclusion: "success",
      branchName,
      fullResponse,
      toolsUsed: Array.from(toolsUsed),
      turnsExecuted: 1,
      commentId,
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    core.error(`Tag mode failed: ${errorMessage}`);

    if (commentId) {
      await updateTrackingComment(octokits.rest, context, commentId, {
        error: errorMessage,
      });
    }

    return {
      conclusion: "failure",
      branchName,
      fullResponse,
      toolsUsed: Array.from(toolsUsed),
      turnsExecuted: 1,
      commentId,
      errorMessage,
    };
  }
}
