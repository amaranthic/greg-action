/**
 * @fileoverview Formatting utilities for GitHub issue, PR, and comment context.
 *
 * Converts fetched GitHub entity data into structured, clean Markdown blocks
 * suitable for inclusion in the AI prompt.
 *
 * @packageDocumentation
 */

import type { FetchedEntityData } from "../github/data/fetcher.js";

/**
 * Formats fetched GitHub entity data into a clear Markdown context block for the model.
 *
 * @param data - Fetched issue or pull request data.
 * @returns Markdown-formatted context string.
 */
export function formatEntityContext(data: FetchedEntityData): string {
  const sections: string[] = [];

  const entityType = data.isPR ? "Pull Request" : "Issue";
  sections.push(`## GitHub ${entityType} #${data.number}: ${data.title}`);
  sections.push(`**Author:** @${data.author}`);

  if (data.body && data.body.trim()) {
    sections.push(`### Description\n\n${data.body.trim()}`);
  }

  // Changed files for PRs
  if (data.isPR && data.changedFiles && data.changedFiles.length > 0) {
    sections.push("### Changed Files");
    const fileList = data.changedFiles
      .slice(0, 30)
      .map(
        (f) =>
          `- \`${f.filename}\` (${f.status}: +${f.additions} -${f.deletions})`
      )
      .join("\n");
    sections.push(fileList);

    // Append sample patches for small/medium PRs
    const patches = data.changedFiles
      .filter((f) => f.patch)
      .slice(0, 10)
      .map(
        (f) => `#### File: \`${f.filename}\`\n\`\`\`diff\n${f.patch}\n\`\`\``
      )
      .join("\n\n");

    if (patches) {
      sections.push(`### Key Diffs\n\n${patches}`);
    }
  }

  // Discussion comments
  if (data.comments && data.comments.length > 0) {
    sections.push("### Discussion Thread");
    const formattedComments = data.comments
      .slice(-15) // Recent 15 comments
      .map((c) => `**@${c.author}** (${c.createdAt}):\n${c.body}`)
      .join("\n\n---\n\n");
    sections.push(formattedComments);
  }

  return sections.join("\n\n");
}
