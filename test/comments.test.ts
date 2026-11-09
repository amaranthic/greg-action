/**
 * @fileoverview Unit tests for sticky tracking comment builder and formatting.
 */

import { describe, it, expect } from "bun:test";
import {
  buildCommentBody,
  formatDuration,
  extractToolParameterDetail,
} from "../src/github/operations/comments.js";

describe("comments formatting", () => {
  it("formats duration accurately into seconds and minutes", () => {
    expect(formatDuration(400)).toBe("1s");
    expect(formatDuration(15000)).toBe("15s");
    expect(formatDuration(65000)).toBe("1m 5s");
    expect(formatDuration(130000)).toBe("2m 10s");
  });

  it("extracts concise parameter details across common tools", () => {
    expect(extractToolParameterDetail({ filePath: "src/index.ts" })).toBe(
      "src/index.ts"
    );
    expect(extractToolParameterDetail({ path: "README.md" })).toBe("README.md");
    expect(extractToolParameterDetail({ command: "npm test" })).toBe(
      "npm test"
    );
    expect(extractToolParameterDetail({ pattern: "src/**/*.ts" })).toBe(
      "src/**/*.ts"
    );
    expect(extractToolParameterDetail({ query: "foo" })).toBe("foo");
    expect(extractToolParameterDetail({ action: "list" })).toBe("list");

    const longCommand = "a".repeat(100);
    const detail = extractToolParameterDetail({ command: longCommand });
    expect(detail.length).toBeLessThanOrEqual(60);
    expect(detail.endsWith("...")).toBe(true);
  });

  it("builds initial working comment with clean markdown and no emojis", () => {
    const body = buildCommentBody("amaranthic", "greg-action", "12345", {
      environmentReady: true,
      triggerActor: "sapirrior",
    });

    expect(body).toContain("**Greg is working...**");
    expect(body).toContain(
      "[View job](https://github.com/amaranthic/greg-action/actions/runs/12345)"
    );
    expect(body).toContain("I am analyzing this and executing the task.");
    // Verify no emojis are present
    expect(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}]/u.test(body)).toBe(false);
  });

  it("builds working comment with collapsible tool activities and no emojis", () => {
    const body = buildCommentBody("amaranthic", "greg-action", "12345", {
      environmentReady: true,
      runningTurn: true,
      durationMs: 12000,
      toolActivities: [
        { toolName: "ReadFile", detail: "package.json", durationMs: 400 },
        {
          toolName: "Bash",
          detail: "npm test",
          isError: true,
          durationMs: 3500,
        },
      ],
    });

    expect(body).toContain("<details>");
    expect(body).toContain("<summary>Tool activity (2 calls)</summary>");
    expect(body).toContain("- `ReadFile` (`package.json`) (1s)");
    expect(body).toContain("- `Bash` (`npm test`) (4s) - failed");
    expect(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}]/u.test(body)).toBe(false);
  });

  it("builds final completed comment with branch link, PR creation link, summary, and duration", () => {
    const body = buildCommentBody("amaranthic", "greg-action", "12345", {
      turnCompleted: true,
      triggerActor: "sapirrior",
      durationMs: 45000,
      branchName: "greg/issue-1-test",
      prLink:
        "https://github.com/amaranthic/greg-action/compare/main...greg/issue-1-test?expand=1",
      responseSummary: "All tests have passed successfully.",
      toolActivities: [
        { toolName: "Bash", detail: "npm test", durationMs: 4200 },
      ],
    });

    expect(body).toContain("**Greg finished @sapirrior's task in 45s**");
    expect(body).toContain(
      "[`greg/issue-1-test`](https://github.com/amaranthic/greg-action/tree/greg%2Fissue-1-test)"
    );
    expect(body).toContain(
      "[Create PR ➔](https://github.com/amaranthic/greg-action/compare/main...greg/issue-1-test?expand=1)"
    );
    expect(body).toContain("All tests have passed successfully.");
    expect(body).toContain("<summary>Tool activity (1 call)</summary>");
    expect(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}]/u.test(body)).toBe(false);
  });

  it("builds completed comment without branch or PR link when no changes were pushed", () => {
    const body = buildCommentBody("amaranthic", "greg-action", "12345", {
      turnCompleted: true,
      triggerActor: "sapirrior",
      durationMs: 8000,
      responseSummary: "Test suite report: all 42 unit tests passed.",
      toolActivities: [
        { toolName: "Bash", detail: "npm test", durationMs: 4200 },
      ],
    });

    expect(body).toContain("**Greg finished @sapirrior's task in 8s**");
    expect(body).not.toContain("tree/");
    expect(body).not.toContain("Create PR");
    expect(body).toContain("Test suite report: all 42 unit tests passed.");
    expect(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}]/u.test(body)).toBe(false);
  });

  it("builds clean error comment when execution fails", () => {
    const body = buildCommentBody("amaranthic", "greg-action", "12345", {
      error: "Authentication failed: invalid token",
      durationMs: 5000,
    });

    expect(body).toContain("**Greg encountered an error after 5s**");
    expect(body).toContain("```\nAuthentication failed: invalid token\n```");
    expect(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}]/u.test(body)).toBe(false);
  });
});
