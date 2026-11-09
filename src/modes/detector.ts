/**
 * @fileoverview Auto-detection of Greg execution mode from GitHub context and inputs.
 *
 * Distinguishes between:
 * - `tag`: Interactive mention (@greg) in issues/PRs with progress tracking and branch updates.
 * - `review`: Read-only analysis of pull requests without modifying files or committing code.
 * - `automation`: Headless execution from workflows, schedules, or explicit prompt inputs.
 *
 * @packageDocumentation
 */

import type { GregContext } from "../github/context.js";
import { isEntityContext } from "../github/context.js";
import type { GregMode } from "../policy/modeDefaults.js";
import { checkContainsTrigger } from "../github/validation/trigger.js";

/**
 * Detects the appropriate execution mode for the current action run.
 *
 * @param context - The parsed Greg context.
 * @returns Detected {@link GregMode} (`tag`, `review`, or `automation`).
 */
export function detectMode(context: GregContext): GregMode {
  // 1. Explicit override via action inputs
  const explicitMode = context.inputs.mode?.trim().toLowerCase();
  if (
    explicitMode === "tag" ||
    explicitMode === "review" ||
    explicitMode === "automation"
  ) {
    return explicitMode;
  }

  // 2. Explicit prompt supplied without @greg comment trigger defaults to automation
  if (context.inputs.prompt && context.inputs.prompt.trim()) {
    // If it's a comment event containing @greg with extra prompt, it is still interactive tag mode
    if (isEntityContext(context) && checkContainsTrigger(context)) {
      return "tag";
    }
    return "automation";
  }

  // 3. Entity-based contexts (issues, comments, PRs)
  if (isEntityContext(context)) {
    // If the event triggered via @greg mention, assignee, or label
    if (checkContainsTrigger(context)) {
      return "tag";
    }

    // Pull request events without @greg mention default to automated review mode
    if (context.isPR) {
      return "review";
    }
  }

  // 4. Default for workflow_dispatch, schedule, or push events
  return "automation";
}
