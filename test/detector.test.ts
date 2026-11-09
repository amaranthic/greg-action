/**
 * @fileoverview Test suite for execution mode auto-detection.
 */

import { describe, expect, it } from "bun:test";
import { detectMode } from "../src/modes/detector.js";
import type { GregContext } from "../src/github/context.js";

function createMockContext(overrides: Partial<GregContext>): GregContext {
  const defaultContext: GregContext = {
    runId: "123",
    actor: "developer",
    repository: {
      owner: "owner",
      repo: "repo",
      fullName: "owner/repo",
      defaultBranch: "main",
    },
    inputs: {
      prompt: "",
      triggerPhrase: "@greg",
      assigneeTrigger: "greg",
      labelTrigger: "greg",
      branchPrefix: "greg/",
      allowedTools: "",
      disallowedTools: "",
      model: "dummy",
      apiKey: "test-key",
      baseUrl: "https://api.anthropic.com/v1",
      useStickyComment: true,
      allowedBots: "",
      maxTurns: 10,
      instructions: "",
      githubToken: "gh-token",
    },
    eventName: "push",
    payload: {},
  };

  return { ...defaultContext, ...overrides } as GregContext;
}

describe("detectMode", () => {
  it("honors explicit mode override in inputs", () => {
    const context = createMockContext({
      inputs: {
        ...createMockContext({}).inputs,
        mode: "review",
      },
    });
    expect(detectMode(context)).toBe("review");
  });

  it("detects tag mode when issue comment contains trigger phrase", () => {
    const context = createMockContext({
      eventName: "issue_comment",
      entityNumber: 42,
      isPR: false,
      payload: {
        comment: {
          body: "Hey @greg please implement user authentication",
        },
      },
    } as any);
    expect(detectMode(context)).toBe("tag");
  });

  it("detects review mode for PR events without tag phrase", () => {
    const context = createMockContext({
      eventName: "pull_request",
      entityNumber: 99,
      isPR: true,
      payload: {
        action: "opened",
        pull_request: {
          title: "Feature: Add payments",
          body: "Standard implementation",
        },
      },
    } as any);
    expect(detectMode(context)).toBe("review");
  });

  it("detects automation mode when explicit prompt is provided", () => {
    const context = createMockContext({
      inputs: {
        ...createMockContext({}).inputs,
        prompt: "Run nightly repository health check",
      },
      eventName: "schedule",
    });
    expect(detectMode(context)).toBe("automation");
  });
});
