/**
 * @fileoverview Review mode execution handler.
 *
 * Implements read-only pull request code reviews and automated analysis:
 * - Only exposes read-only tools: `readFile`, `glob`, `grep`.
 * - Unregisters mutating tools (`writeFile`, `editFile`, `bash`, `taskManager`).
 * - Never modifies files, commits, or pushes branches.
 * - Posts a structured review comment directly to the pull request.
 *
 * @packageDocumentation
 */

import * as core from "@actions/core";
import { AgentEngine, ToolRegistry } from "@amaranthic/hernex";
import type { Octokits } from "../../github/api/client.js";
import type { EntityGregContext } from "../../github/context.js";
import { fetchEntityData } from "../../github/data/fetcher.js";
import { buildPrompts } from "../../prompt/builder.js";

/**
 * Result returned by review mode execution.
 */
export interface ReviewModeResult {
  readonly conclusion: "success" | "failure";
  readonly fullResponse: string;
  readonly toolsUsed: readonly string[];
  readonly turnsExecuted: number;
  readonly errorMessage?: string;
}

/**
 * Executes Greg in read-only review mode.
 *
 * @param options - Execution parameters.
 * @returns Result object containing review comments and status.
 */
export async function executeReviewMode(options: {
  readonly octokits: Octokits;
  readonly context: EntityGregContext;
  readonly apiKey: string;
  readonly baseUrl: string;
}): Promise<ReviewModeResult> {
  const { octokits, context, apiKey, baseUrl } = options;
  const toolsUsed = new Set<string>();
  let fullResponse = "";

  try {
    core.info(`Executing review mode for PR #${context.entityNumber}...`);

    // 1. Fetch PR details and diffs
    const entityData = await fetchEntityData(octokits, context);

    // 2. Build review prompts
    const { systemPrompt, initialPrompt } = buildPrompts({
      mode: "review",
      context,
      entityData,
    });

    // 3. Configure strictly read-only tools (no mutating tools)
    const tools = new ToolRegistry({ includeDefaults: true });
    tools.unregister("writeFile");
    tools.unregister("editFile");
    tools.unregister("bash");
    tools.unregister("taskManager");

    // 4. Initialize Harnex AgentEngine
    const engine = new AgentEngine({
      threadId: `greg-review-${context.runId}`,
      workingDirectory: process.cwd(),
      model: context.inputs.model,
      apiKey,
      baseUrl,
      tools,
      instructions: systemPrompt,
      maxSteps: context.inputs.maxTurns * 3,
      persist: false,
      checkpoint: false,
      hooks: {
        onAuthorizeTool: async ({ toolName }) => {
          toolsUsed.add(toolName);
          // Only read-only tools exist in registry
          return { decision: "allow" };
        },
      },
    });

    // 5. Stream review generation via Harnex
    for await (const event of engine.runTurn(initialPrompt)) {
      if (event.type === "tokenDelta") {
        fullResponse += event.text;
      }
    }

    // 6. Post review comment to the pull request
    if (fullResponse.trim().length > 0) {
      const { owner, repo } = context.repository;
      const reviewHeader = "### 🔍 Greg Code Review\n\n";
      await octokits.rest.issues.createComment({
        owner,
        repo,
        issue_number: context.entityNumber,
        body: reviewHeader + fullResponse.trim(),
      });
      core.info("Posted code review comment to pull request.");
    }

    return {
      conclusion: "success",
      fullResponse,
      toolsUsed: Array.from(toolsUsed),
      turnsExecuted: 1,
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    core.error(`Review mode failed: ${errorMessage}`);
    return {
      conclusion: "failure",
      fullResponse,
      toolsUsed: Array.from(toolsUsed),
      turnsExecuted: 1,
      errorMessage,
    };
  }
}
