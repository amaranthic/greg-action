/**
 * @fileoverview Configuration restoration from PR base branch.
 *
 * Prevents PR authors from overriding agent configuration, hooks, or tool configurations
 * by checking out sensitive paths from the trusted base ref before execution.
 *
 * @packageDocumentation
 */

import { execFileSync } from "node:child_process";
import * as core from "@actions/core";

/**
 * Paths that must be restored from the trusted base branch on PR contexts.
 */
export const SENSITIVE_PATHS = [
  ".greg",
  ".greg.json",
  ".mcp.json",
  "GREG.md",
  ".gitmodules",
  ".husky",
];

/**
 * Restores security-sensitive configuration files from the specified base branch.
 *
 * @param baseBranch - Trusted target branch name of the pull request.
 * @returns Array of paths that were checked out from base branch.
 */
export function restoreConfigFromBase(baseBranch: string): string[] {
  const restoredPaths: string[] = [];

  core.info(
    `Restoring security-sensitive configuration files from base branch "${baseBranch}"...`
  );

  for (const path of SENSITIVE_PATHS) {
    try {
      execFileSync("git", ["checkout", `origin/${baseBranch}`, "--", path], {
        stdio: "pipe",
      });
      core.info(`Restored "${path}" from origin/${baseBranch}`);
      restoredPaths.push(path);
    } catch {
      // Path did not exist in base branch, which is normal
    }
  }

  return restoredPaths;
}
