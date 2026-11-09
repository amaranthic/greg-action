/**
 * @fileoverview Automation mode execution handler.
 *
 * Implements headless CI/CD task automations:
 * - Runs with explicit user prompt from workflow YAML.
 * - Silent execution (no interactive sticky comments).
 * - Exposes tools gated by ant-style allow/disallow policy rules.
 * - Commits changes if files were modified.
 * - Emits structured JSON outputs for downstream workflow jobs.
 *
 * @packageDocumentation
 */

import * as core from "@actions/core";
import { AgentEngine, ToolRegistry } from "@amaranthic/hernex";
import type { GregContext } from "../../github/context.js";
import { execGit } from "../../github/operations/branch.js";
import { buildPrompts } from "../../prompt/builder.js";
import {
  parseToolRuleList,
  evaluateToolPolicy,
} from "../../policy/toolPermissions.js";
import { getDefaultToolsForMode } from "../../policy/modeDefaults.js";

/**
 * Result returned by automation mode execution.
 */
export interface AutomationModeResult {
  readonly conclusion: "success" | "failure";
  readonly fullResponse: string;
  readonly toolsUsed: readonly string[];
  readonly turnsExecuted: number;
  readonly branchName?: string;
  readonly errorMessage?: string;
}

/**
 * Executes Greg in headless automation mode.
 *
 * @param options - Execution parameters.
 * @returns Result object containing response text and status.
 */
export async function executeAutomationMode(options: {
  readonly context: GregContext;
  readonly apiKey: string;
  readonly baseUrl: string;
}): Promise<AutomationModeResult> {
  const { context, apiKey, baseUrl } = options;
  const toolsUsed = new Set<string>();
  let fullResponse = "";

  try {
    core.info("Executing headless automation mode...");

    // 1. Build prompts from inputs
    const { systemPrompt, initialPrompt } = buildPrompts({
      mode: "automation",
      context,
    });

    // 2. Setup Harnex ToolRegistry and permissions
    const tools = new ToolRegistry({ includeDefaults: true });
    const allowedRules = parseToolRuleList(context.inputs.allowedTools);
    const disallowedRules = parseToolRuleList(context.inputs.disallowedTools);
    const defaultAllowedTools = getDefaultToolsForMode("automation");

    // 3. Initialize Harnex AgentEngine
    const engine = new AgentEngine({
      threadId: `greg-auto-${context.runId}`,
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

    // 4. Stream turn execution via Harnex
    for await (const event of engine.runTurn(initialPrompt)) {
      if (event.type === "tokenDelta") {
        fullResponse += event.text;
      } else if (event.type === "toolExecutionStarted") {
        core.info(`Tool started: ${event.toolName}`);
      }
    }

    // 5. Commit any changes if working tree was modified
    try {
      const gitStatus = execGit(["status", "--porcelain"]);
      if (gitStatus.trim().length > 0) {
        core.info(
          "Working directory changes detected in automation mode. Committing..."
        );
        execGit(["add", "-A"]);
        execGit([
          "commit",
          "-m",
          "🤖 Greg: automated engineering task changes",
        ]);
      }
    } catch (gitErr) {
      core.warning(`Git commit skipped in automation mode: ${gitErr}`);
    }

    return {
      conclusion: "success",
      fullResponse,
      toolsUsed: Array.from(toolsUsed),
      turnsExecuted: 1,
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    core.error(`Automation mode failed: ${errorMessage}`);
    return {
      conclusion: "failure",
      fullResponse,
      toolsUsed: Array.from(toolsUsed),
      turnsExecuted: 1,
      errorMessage,
    };
  }
}
