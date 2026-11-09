/**
 * @fileoverview Git branch creation, validation, and checkout operations.
 *
 * Provides safe branch name validation, branch name generation following
 * `greg/{entityType}-{entityNumber}-{timestamp}`, and git checkout setup.
 *
 * @packageDocumentation
 */

import { execFileSync } from "node:child_process";
import * as core from "@actions/core";
import type { EntityGregContext } from "../context.js";
import type { Octokits } from "../api/client.js";

/**
 * Validates a git branch name against a strict whitelist pattern to prevent command injection.
 *
 * @param branchName - Git ref or branch name candidate.
 * @throws Error if branch name contains unsafe or invalid characters.
 */
export function validateBranchName(branchName: string): void {
  if (!branchName || branchName.trim().length === 0) {
    throw new Error("Branch name cannot be empty");
  }

  if (branchName.startsWith("-")) {
    throw new Error(
      `Invalid branch name: "${branchName}". Branch names cannot start with a dash.`
    );
  }

  if (/[\x00-\x1F\x7F ~^:?*[\]\\]/.test(branchName)) {
    throw new Error(
      `Invalid branch name: "${branchName}". Branch names cannot contain control characters, spaces, or special git characters (~^:?*[\\]).`
    );
  }

  const validPattern = /^[a-zA-Z0-9@_][a-zA-Z0-9/_.#+,@()-]*$/;
  if (!validPattern.test(branchName)) {
    throw new Error(
      `Invalid branch name: "${branchName}". Character sequence not permitted.`
    );
  }

  if (branchName.startsWith(".") || branchName.endsWith(".")) {
    throw new Error(
      `Invalid branch name: "${branchName}". Cannot start or end with a period.`
    );
  }

  if (branchName.endsWith("/")) {
    throw new Error(
      `Invalid branch name: "${branchName}". Cannot end with a slash.`
    );
  }

  if (
    branchName.includes("//") ||
    branchName.includes("..") ||
    branchName.includes("@{")
  ) {
    throw new Error(
      `Invalid branch name: "${branchName}". Traversal sequences forbidden.`
    );
  }

  if (branchName.endsWith(".lock") || branchName === "@") {
    throw new Error(
      `Invalid branch name: "${branchName}". Reserved git ref name.`
    );
  }
}

/**
 * Executes a git command safely using execFileSync without shell interpolation.
 *
 * @param args - Array of git command arguments.
 */
export function execGit(args: string[]): string {
  return execFileSync("git", args, {
    encoding: "utf8",
    env: process.env,
    stdio: ["pipe", "pipe", "pipe"],
  });
}

/**
 * Generates a standard Greg branch name: `{prefix}{entityType}-{entityNumber}-{timestamp}`.
 *
 * @param prefix - Prefix string (defaults to `greg/`).
 * @param entityType - `issue` or `pr`.
 * @param entityNumber - Issue or PR integer identifier.
 * @returns Safe branch name.
 */
export function generateBranchName(
  prefix: string,
  entityType: "issue" | "pr",
  entityNumber: number
): string {
  const timestamp = Math.floor(Date.now() / 1000);
  const cleanPrefix = prefix.endsWith("/") ? prefix : `${prefix}/`;
  const name = `${cleanPrefix}${entityType}-${entityNumber}-${timestamp}`;
  validateBranchName(name);
  return name;
}

/**
 * Result of branch resolution and checkout.
 */
export interface BranchInfo {
  readonly baseBranch: string;
  readonly gregBranch?: string;
  readonly currentBranch: string;
}

/**
 * Prepares the appropriate working git branch for the action.
 *
 * For open PRs: checks out the PR branch.
 * For issues: creates a new branch off the repository base branch.
 *
 * @param octokits - Authenticated GitHub client.
 * @param context - The entity context.
 * @returns Resolved {@link BranchInfo}.
 */
export async function setupBranch(
  octokits: Octokits,
  context: EntityGregContext
): Promise<BranchInfo> {
  const { owner, repo } = context.repository;
  const isPR = context.isPR;
  const baseBranchInput =
    context.inputs.baseBranch || context.repository.defaultBranch || "main";
  validateBranchName(baseBranchInput);

  if (isPR) {
    let headRef: string | undefined;
    let baseRef: string = baseBranchInput;
    let prState = "open";

    const prPayload = context.payload as {
      pull_request?: {
        head?: { ref?: string; sha?: string };
        base?: { ref?: string };
        state?: string;
      };
    };

    if (prPayload.pull_request?.head?.ref) {
      headRef = prPayload.pull_request.head.ref;
      baseRef = prPayload.pull_request.base?.ref || baseBranchInput;
      prState = prPayload.pull_request.state || "open";
    } else {
      try {
        const prResponse = await octokits.rest.pulls.get({
          owner,
          repo,
          pull_number: context.entityNumber,
        });
        headRef = prResponse.data.head.ref;
        baseRef = prResponse.data.base.ref;
        prState = prResponse.data.state;
      } catch (err) {
        core.warning(
          `Failed to fetch PR #${context.entityNumber} details: ${err}`
        );
      }
    }

    if (prState === "open" && headRef) {
      validateBranchName(headRef);
      validateBranchName(baseRef);

      core.info(`Open PR #${context.entityNumber}: checking out ${headRef}...`);
      try {
        execGit(["fetch", "origin", headRef]);
        execGit(["checkout", "-B", headRef, `origin/${headRef}`]);
      } catch (err) {
        core.warning(
          `Direct tracking checkout of ${headRef} failed: ${err}; falling back to local branch`
        );
        execGit(["checkout", "-B", headRef]);
      }

      return {
        baseBranch: baseRef,
        currentBranch: headRef,
        gregBranch: headRef,
      };
    }
  }

  // Issue context: create a new dedicated Greg branch
  const entityType = isPR ? "pr" : "issue";
  const newBranch = generateBranchName(
    context.inputs.branchPrefix,
    entityType,
    context.entityNumber
  );

  core.info(
    `Creating new working branch "${newBranch}" based on "${baseBranchInput}"...`
  );

  try {
    execGit(["fetch", "origin", baseBranchInput]);
    execGit(["checkout", "-B", newBranch, `origin/${baseBranchInput}`]);
  } catch {
    execGit(["checkout", "-B", newBranch]);
  }

  return {
    baseBranch: baseBranchInput,
    gregBranch: newBranch,
    currentBranch: newBranch,
  };
}
