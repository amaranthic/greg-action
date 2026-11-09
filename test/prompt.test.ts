/**
 * @fileoverview Test suite for prompt building and context formatting.
 */

import { describe, expect, it } from "bun:test";
import { buildPrompts } from "../src/prompt/builder.js";
import { formatEntityContext } from "../src/prompt/context-formatter.js";
import type { FetchedEntityData } from "../src/github/data/fetcher.js";

describe("formatEntityContext", () => {
  it("formats issue title, author, and comments into markdown", () => {
    const data: FetchedEntityData = {
      title: "Fix database connection leak",
      body: "Connections are left open after query failure",
      author: "alice",
      isPR: false,
      number: 15,
      comments: [
        {
          id: 1,
          author: "bob",
          body: "I can reproduce this on Node 22",
          createdAt: "2026-11-09T10:00:00Z",
        },
      ],
    };

    const formatted = formatEntityContext(data);
    expect(formatted).toContain("Issue #15: Fix database connection leak");
    expect(formatted).toContain("@alice");
    expect(formatted).toContain("Connections are left open");
    expect(formatted).toContain("@bob");
  });

  it("includes changed files list for pull requests", () => {
    const data: FetchedEntityData = {
      title: "Add payment gateway",
      body: "Implements stripe webhook handler",
      author: "charlie",
      isPR: true,
      number: 77,
      comments: [],
      changedFiles: [
        {
          filename: "src/billing/stripe.ts",
          status: "added",
          additions: 50,
          deletions: 0,
          changes: 50,
        },
      ],
    };

    const formatted = formatEntityContext(data);
    expect(formatted).toContain("Pull Request #77: Add payment gateway");
    expect(formatted).toContain("src/billing/stripe.ts");
    expect(formatted).toContain("+50 -0");
  });
});

describe("buildPrompts", () => {
  const mockContext: any = {
    repository: {
      fullName: "test-org/test-repo",
      defaultBranch: "main",
    },
    inputs: {
      instructions: "Always write TypeScript strictly",
      prompt: "",
    },
  };

  it("includes mode instructions, repository metadata, and custom instructions", () => {
    const { systemPrompt, initialPrompt } = buildPrompts({
      mode: "tag",
      context: mockContext,
    });

    expect(systemPrompt).toContain("You are Greg");
    expect(systemPrompt).toContain("test-org/test-repo");
    expect(systemPrompt).toContain("Always write TypeScript strictly");
    expect(initialPrompt).toBeDefined();
  });

  it("builds review mode system prompt with review principles", () => {
    const { systemPrompt } = buildPrompts({
      mode: "review",
      context: mockContext,
    });

    expect(systemPrompt).toContain("expert code reviewer");
    expect(systemPrompt).toContain("Read-Only Analysis");
  });
});
