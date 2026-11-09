/**
 * @fileoverview Actor validation and bot loop prevention.
 *
 * Ensures only human contributors or explicitly whitelisted bots can trigger actions,
 * preventing accidental recursive invocation loops between bots.
 *
 * @packageDocumentation
 */

import * as core from "@actions/core";
import type { GregContext } from "../context.js";

/**
 * Checks if a username corresponds to an allowed bot identity.
 *
 * @param actor - The username of the actor triggering the event.
 * @param allowedBots - Comma-separated list of allowed bot names or `*`.
 * @returns True if the actor is permitted to execute as a bot.
 */
export function isAllowedBot(actor: string, allowedBots: string): boolean {
  const trimmed = allowedBots.trim();
  if (trimmed === "*") {
    return true;
  }
  if (!trimmed) {
    return false;
  }

  const allowedList = trimmed
    .split(",")
    .map((bot) =>
      bot
        .trim()
        .toLowerCase()
        .replace(/\[bot\]$/, "")
    )
    .filter((bot) => bot.length > 0);

  const normalizedActor = actor.toLowerCase().replace(/\[bot\]$/, "");
  return allowedList.includes(normalizedActor);
}

/**
 * Validates that the event actor is either human or on the allowed bots whitelist.
 *
 * @param context - The Greg execution context.
 * @throws Error if the actor is an unauthorized bot.
 */
export function validateActor(context: GregContext): void {
  const actor = context.actor;
  const isBot = actor.endsWith("[bot]") || actor.toLowerCase().includes("bot");

  if (!isBot) {
    return;
  }

  const allowedBots = context.inputs.allowedBots || "";
  if (!isAllowedBot(actor, allowedBots)) {
    core.warning(
      `Actor ${actor} appears to be a bot and is not on the allowed_bots whitelist. Ignoring event.`
    );
    throw new Error(`Actor ${actor} is an unauthorized bot.`);
  }

  core.info(`Actor ${actor} authorized via allowed_bots configuration.`);
}
