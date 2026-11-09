/**
 * @fileoverview Repository collaborator permission validation.
 *
 * Checks that the actor initiating the workflow run possesses write or admin
 * access to the target repository, preventing untrusted fork contributors from
 * triggering privileged runner actions.
 *
 * @packageDocumentation
 */

import * as core from "@actions/core";
import type { Octokit } from "@octokit/rest";
import type { GregContext } from "../context.js";
import { isAllowedBot } from "./actor.js";

/**
 * Checks if the event actor has write permissions to the repository.
 *
 * @param octokit - Authenticated Octokit REST client.
 * @param context - The Greg context.
 * @returns True if actor has write or admin access.
 */
export async function checkWritePermissions(
  octokit: Octokit,
  context: GregContext
): Promise<boolean> {
  const { repository, actor } = context;

  // GitHub apps / bot users ending in [bot]
  if (actor.endsWith("[bot]")) {
    core.info(
      `Actor ${actor} is a registered GitHub App bot; permission verified.`
    );
    return true;
  }

  try {
    core.info(`Verifying collaborator permissions for actor: ${actor}`);

    const response = await octokit.repos.getCollaboratorPermissionLevel({
      owner: repository.owner,
      repo: repository.repo,
      username: actor,
    });

    const permission = response.data.permission;
    core.info(`Actor "${actor}" collaborator permission level: ${permission}`);

    if (permission === "admin" || permission === "write") {
      return true;
    }

    core.warning(
      `Actor "${actor}" has insufficient permissions: ${permission}`
    );
    return false;
  } catch (error) {
    if (error instanceof Error && error.message.includes("is not a user")) {
      // Actor is likely a non-user App identity (e.g. Copilot)
      if (isAllowedBot(actor, context.inputs.allowedBots || "")) {
        core.info(`Non-user actor "${actor}" authorized via allowed_bots.`);
        return true;
      }
      core.warning(`Non-user actor "${actor}" is not in allowed_bots list.`);
      return false;
    }

    core.error(`Failed to verify permissions: ${error}`);
    throw error;
  }
}
