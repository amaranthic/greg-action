/**
 * @fileoverview GitHub token resolution and secret registration.
 *
 * Resolves the GitHub authentication token from workflow inputs or environment variables
 * and registers it with the GitHub Actions runner so it is masked in log outputs.
 *
 * @packageDocumentation
 */

import * as core from "@actions/core";

/**
 * Resolves the GitHub authentication token to use for API operations.
 *
 * Checks in order:
 * 1. `inputs.githubToken` (explicit parameter in workflow)
 * 2. `process.env.GITHUB_TOKEN` (workflow environment token)
 * 3. `process.env.GH_TOKEN` (GitHub CLI convention)
 *
 * @param explicitToken - Optional explicit token passed into the action.
 * @returns Non-empty GitHub token.
 * @throws Error if no token could be resolved.
 */
export function resolveGitHubToken(explicitToken?: string): string {
  const token =
    explicitToken?.trim() ||
    process.env.GITHUB_TOKEN?.trim() ||
    process.env.GH_TOKEN?.trim();

  if (!token) {
    throw new Error(
      "Missing GitHub token. Please supply `github_token` in your workflow step with: or provide GITHUB_TOKEN in env."
    );
  }

  // Register with runner to mask token in logs
  core.setSecret(token);
  return token;
}
