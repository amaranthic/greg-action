/**
 * @fileoverview Data retrieval for GitHub issues, pull requests, and comment threads.
 *
 * Fetches issue descriptions, discussion comments, PR diffs, and changed file paths
 * using Octokit.
 *
 * @packageDocumentation
 */

import * as core from "@actions/core";
import type { Octokits } from "../api/client.js";
import type { EntityGregContext } from "../context.js";

/**
 * Normalized comment entry retrieved from GitHub discussion threads.
 */
export interface EntityComment {
  readonly id: number;
  readonly author: string;
  readonly body: string;
  readonly createdAt: string;
}

/**
 * File metadata for pull request modifications.
 */
export interface ChangedFile {
  readonly filename: string;
  readonly status: string;
  readonly additions: number;
  readonly deletions: number;
  readonly changes: number;
  readonly patch?: string;
}

/**
 * Complete retrieved GitHub context data for an issue or pull request.
 */
export interface FetchedEntityData {
  readonly title: string;
  readonly body: string;
  readonly author: string;
  readonly isPR: boolean;
  readonly number: number;
  readonly comments: readonly EntityComment[];
  readonly changedFiles?: readonly ChangedFile[];
  readonly baseRef?: string;
  readonly headRef?: string;
}

/**
 * Fetches all relevant context data for the target issue or pull request.
 *
 * @param octokits - Authenticated GitHub client.
 * @param context - Entity context.
 * @returns Fully populated {@link FetchedEntityData}.
 */
export async function fetchEntityData(
  octokits: Octokits,
  context: EntityGregContext
): Promise<FetchedEntityData> {
  const { owner, repo } = context.repository;
  const entityNumber = context.entityNumber;
  const isPR = context.isPR;

  core.info(
    `Fetching GitHub data for ${isPR ? "PR" : "Issue"} #${entityNumber}...`
  );

  // 1. Fetch comments
  const rawComments = await octokits.rest.issues.listComments({
    owner,
    repo,
    issue_number: entityNumber,
    per_page: 50,
  });

  const comments: EntityComment[] = rawComments.data.map((c) => ({
    id: c.id,
    author: c.user?.login || "unknown",
    body: c.body || "",
    createdAt: c.created_at,
  }));

  if (isPR) {
    const prResponse = await octokits.rest.pulls.get({
      owner,
      repo,
      pull_number: entityNumber,
    });

    const pr = prResponse.data;

    // Fetch changed files list with patch diffs
    const filesResponse = await octokits.rest.pulls.listFiles({
      owner,
      repo,
      pull_number: entityNumber,
      per_page: 100,
    });

    const changedFiles: ChangedFile[] = filesResponse.data.map((f) => ({
      filename: f.filename,
      status: f.status,
      additions: f.additions,
      deletions: f.deletions,
      changes: f.changes,
      patch: f.patch,
    }));

    return {
      title: pr.title,
      body: pr.body || "",
      author: pr.user?.login || "unknown",
      isPR: true,
      number: entityNumber,
      comments,
      changedFiles,
      baseRef: pr.base.ref,
      headRef: pr.head.ref,
    };
  }

  // Issue context
  const issueResponse = await octokits.rest.issues.get({
    owner,
    repo,
    issue_number: entityNumber,
  });

  const issue = issueResponse.data;

  return {
    title: issue.title,
    body: issue.body || "",
    author: issue.user?.login || "unknown",
    isPR: false,
    number: entityNumber,
    comments,
  };
}
