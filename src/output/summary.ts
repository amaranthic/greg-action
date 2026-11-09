/**
 * @fileoverview GitHub Actions step summary generation.
 *
 * Renders structured Markdown execution reports and appends them to `$GITHUB_STEP_SUMMARY`.
 *
 * @packageDocumentation
 */

import { appendFileSync } from "node:fs";
import * as core from "@actions/core";
import { redactSecrets } from "../utils/sanitizer.js";

/**
 * Summary metrics and parameters captured during execution.
 */
export interface RunSummaryData {
  readonly mode: string;
  readonly model: string;
  readonly turnsExecuted: number;
  readonly toolsUsed: readonly string[];
  readonly branchName?: string;
  readonly responseText: string;
  readonly conclusion: "success" | "failure";
  readonly errorMessage?: string;
}

/**
 * Formats a run summary into GitHub Flavored Markdown.
 *
 * @param data - Summary data object.
 * @returns Formatted Markdown string.
 */
export function formatStepSummary(data: RunSummaryData): string {
  const statusEmoji = data.conclusion === "success" ? "✅" : "❌";
  const sections: string[] = [
    `## ${statusEmoji} Greg Action Report`,
    "",
    "| Parameter | Value |",
    "|---|---|",
    `| **Status** | \`${data.conclusion}\` |`,
    `| **Mode** | \`${data.mode}\` |`,
    `| **Model** | \`${data.model}\` |`,
    `| **Turns Executed** | ${data.turnsExecuted} |`,
    data.branchName ? `| **Branch** | \`${data.branchName}\` |` : undefined,
    data.toolsUsed.length > 0
      ? `| **Tools Used** | ${data.toolsUsed.map((t) => `\`${t}\``).join(", ")} |`
      : undefined,
  ].filter(Boolean) as string[];

  sections.push("");

  if (data.errorMessage) {
    sections.push(
      `> [!CAUTION]\n> **Error:** ${redactSecrets(data.errorMessage)}\n`
    );
  }

  if (data.responseText && data.responseText.trim()) {
    sections.push("### Output Summary\n");
    sections.push(redactSecrets(data.responseText.trim()));
    sections.push("");
  }

  return sections.join("\n");
}

/**
 * Appends the formatted run summary to `$GITHUB_STEP_SUMMARY` if the environment variable is present.
 *
 * @param data - Summary data object.
 */
export function writeStepSummary(data: RunSummaryData): void {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) {
    return;
  }

  try {
    const markdown = formatStepSummary(data);
    appendFileSync(summaryPath, `${markdown}\n`, "utf8");
    core.info("Successfully wrote report to GitHub Step Summary.");
  } catch (err) {
    core.warning(`Failed to write GitHub Step Summary: ${err}`);
  }
}
