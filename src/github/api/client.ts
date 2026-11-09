/**
 * @fileoverview Octokit REST and GraphQL API client factory.
 *
 * @packageDocumentation
 */

import { Octokit } from "@octokit/rest";
import { graphql } from "@octokit/graphql";

/**
 * Combined REST and GraphQL GitHub API client container.
 */
export interface Octokits {
  /** REST API client. */
  readonly rest: Octokit;
  /** GraphQL query client. */
  readonly graphql: typeof graphql;
}

/**
 * Creates authenticated Octokit REST and GraphQL clients using the provided token.
 *
 * @param token - GitHub authentication token.
 * @returns Combined {@link Octokits} client bundle.
 */
export function createOctokit(token: string): Octokits {
  const apiUrl = process.env.GITHUB_API_URL || "https://api.github.com";
  const graphqlUrl =
    process.env.GITHUB_GRAPHQL_URL || "https://api.github.com/graphql";

  return {
    rest: new Octokit({
      auth: token,
      baseUrl: apiUrl,
    }),
    graphql: graphql.defaults({
      baseUrl: graphqlUrl,
      headers: {
        authorization: `token ${token}`,
      },
    }),
  };
}
