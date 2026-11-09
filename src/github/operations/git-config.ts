/**
 * @fileoverview Git user and remote repository authentication configuration.
 *
 * Sets up git identity (`user.name`, `user.email`) and configures authenticated
 * git remotes using the provided GitHub token.
 *
 * @packageDocumentation
 */

import { execFileSync } from "node:child_process";
import * as core from "@actions/core";
import type { GregContext } from "../context.js";

/**
 * Configures git identity and origin remote credentials for pushing branches.
 *
 * @param token - Authenticated GitHub token.
 * @param context - The Greg context.
 */
export function configureGit(token: string, context: GregContext): void {
  const botName = "github-actions[bot]";
  const botEmail = "github-actions[bot]@users.noreply.github.com";

  core.info(`Configuring git user identity: ${botName} <${botEmail}>`);

  execFileSync("git", ["config", "user.name", botName], { stdio: "pipe" });
  execFileSync("git", ["config", "user.email", botEmail], { stdio: "pipe" });

  const { owner, repo } = context.repository;
  const serverUrl = process.env.GITHUB_SERVER_URL || "https://github.com";
  const url = new URL(serverUrl);
  const authenticatedUrl = `${url.protocol}//x-access-token:${token}@${url.host}/${owner}/${repo}.git`;

  try {
    execFileSync("git", ["remote", "set-url", "origin", authenticatedUrl], {
      stdio: "pipe",
    });
    core.info("Configured origin remote with authenticated token.");
  } catch (err) {
    core.warning(`Failed to update origin remote URL: ${err}`);
  }
}
