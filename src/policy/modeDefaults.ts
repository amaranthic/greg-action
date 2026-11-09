/**
 * @fileoverview Default tool exposures and policy definitions per execution mode.
 *
 * Configures tool exposure sets for `tag`, `review`, and `automation` modes.
 *
 * @packageDocumentation
 */

import type { CanonicalToolName } from "./toolPermissions.js";

/**
 * Execution modes supported by Greg Action.
 */
export type GregMode = "tag" | "review" | "automation";

/**
 * Read-only tool set for inspection and review workflows.
 */
export const REVIEW_MODE_TOOLS: readonly CanonicalToolName[] = Object.freeze([
  "readFile",
  "glob",
  "grep",
]);

/**
 * Full tool set for interactive and automated engineering workflows.
 */
export const FULL_ENGINEERING_TOOLS: readonly CanonicalToolName[] =
  Object.freeze([
    "readFile",
    "writeFile",
    "editFile",
    "bash",
    "taskManager",
    "glob",
    "grep",
  ]);

/**
 * Returns the default allowed tools for the specified Greg execution mode.
 *
 * @param mode - Greg mode (`tag`, `review`, or `automation`).
 * @returns Array of canonical tool names available by default in that mode.
 */
export function getDefaultToolsForMode(
  mode: GregMode
): readonly CanonicalToolName[] {
  switch (mode) {
    case "review":
      return REVIEW_MODE_TOOLS;
    case "tag":
    case "automation":
      return FULL_ENGINEERING_TOOLS;
  }
}
