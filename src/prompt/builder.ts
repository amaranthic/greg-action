/**
 * @fileoverview System prompt and user turn prompt builder.
 *
 * Assembles mode-specific instructions, environment metadata, GitHub discussion context,
 * and user prompt strings into final prompts for Harnex AgentEngine.
 *
 * @packageDocumentation
 */

import type { GregContext } from "../github/context.js";
import type { FetchedEntityData } from "../github/data/fetcher.js";
import type { GregMode } from "../policy/modeDefaults.js";
import { getInstructionsForMode } from "./instructions.js";
import { formatEntityContext } from "./context-formatter.js";

/**
 * Result of building prompts for an agent turn.
 */
export interface BuiltPrompts {
  /** The complete system prompt for the AgentEngine. */
  readonly systemPrompt: string;
  /** The initial user message for the first turn. */
  readonly initialPrompt: string;
}

/**
 * Builds the system prompt and initial turn prompt for the specified execution context.
 *
 * @param options - Prompt build configuration options.
 * @returns Fully composed {@link BuiltPrompts}.
 */
export function buildPrompts(options: {
  readonly mode: GregMode;
  readonly context: GregContext;
  readonly entityData?: FetchedEntityData;
  readonly currentBranch?: string;
}): BuiltPrompts {
  const { mode, context, entityData, currentBranch } = options;

  // 1. Base instructions for the mode
  const modeInstructions = getInstructionsForMode(mode);

  // 2. Environment context metadata
  const environmentLines = [
    "## Environment Metadata",
    `- Repository: ${context.repository.fullName}`,
    `- Default Branch: ${context.repository.defaultBranch || "main"}`,
    currentBranch ? `- Active Branch: ${currentBranch}` : undefined,
    `- Execution Mode: ${mode}`,
    `- Working Directory: ${process.cwd()}`,
  ]
    .filter(Boolean)
    .join("\n");

  // 3. User custom instructions from workflow input
  const customInstructions = context.inputs.instructions?.trim()
    ? `## Additional Project Instructions\n${context.inputs.instructions.trim()}`
    : "";

  const systemPromptParts = [modeInstructions, environmentLines];
  if (customInstructions) {
    systemPromptParts.push(customInstructions);
  }
  const systemPrompt = systemPromptParts.join("\n\n");

  // 4. Initial turn user prompt
  let initialPrompt = "";

  if (entityData) {
    const formattedContext = formatEntityContext(entityData);
    if (mode === "review") {
      initialPrompt = `Please perform a thorough code review of this pull request:\n\n${formattedContext}`;
    } else {
      const explicitPrompt = context.inputs.prompt?.trim();
      const promptHeader = explicitPrompt
        ? `### User Instruction\n${explicitPrompt}\n\n`
        : "";
      initialPrompt = `${promptHeader}Here is the GitHub context for this task:\n\n${formattedContext}\n\nPlease address the request and implement any needed code changes.`;
    }
  } else {
    // Automation mode with explicit prompt
    initialPrompt =
      context.inputs.prompt?.trim() ||
      `Please analyze the repository ${context.repository.fullName} and perform the automated task.`;
  }

  return {
    systemPrompt,
    initialPrompt,
  };
}
