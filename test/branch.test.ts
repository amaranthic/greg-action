/**
 * @fileoverview Test suite for branch validation and name generation.
 */

import { describe, expect, it } from "bun:test";
import {
  validateBranchName,
  generateBranchName,
} from "../src/github/operations/branch.js";

describe("validateBranchName", () => {
  it("accepts valid git branch names", () => {
    expect(() => validateBranchName("main")).not.toThrow();
    expect(() => validateBranchName("greg/issue-42-123456")).not.toThrow();
    expect(() => validateBranchName("feature/auth-provider")).not.toThrow();
    expect(() => validateBranchName("release/v1.0.0")).not.toThrow();
  });

  it("rejects leading dash to prevent option injection", () => {
    expect(() => validateBranchName("-b")).toThrow();
    expect(() => validateBranchName("--help")).toThrow();
  });

  it("rejects control characters, spaces, and git revision operators", () => {
    expect(() => validateBranchName("branch with space")).toThrow();
    expect(() => validateBranchName("branch..traversal")).toThrow();
    expect(() => validateBranchName("branch//slashes")).toThrow();
    expect(() => validateBranchName("branch.lock")).toThrow();
    expect(() => validateBranchName("@")).toThrow();
    expect(() => validateBranchName("branch@{1}")).toThrow();
  });
});

describe("generateBranchName", () => {
  it("generates correct branch format greg/issue-{number}-{timestamp}", () => {
    const branch = generateBranchName("greg/", "issue", 42);
    expect(branch.startsWith("greg/issue-42-")).toBe(true);
    expect(() => validateBranchName(branch)).not.toThrow();
  });

  it("handles custom prefixes cleanly", () => {
    const branch = generateBranchName("agent", "pr", 101);
    expect(branch.startsWith("agent/pr-101-")).toBe(true);
  });
});
