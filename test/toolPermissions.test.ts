/**
 * @fileoverview Test suite for ant-style tool permission parsing and policy evaluation.
 */

import { describe, expect, it } from "bun:test";
import {
  parseToolRule,
  parseToolRuleList,
  matchesPattern,
  evaluateToolPolicy,
} from "../src/policy/toolPermissions.js";

describe("parseToolRule", () => {
  it("parses simple tool names without patterns", () => {
    const rule = parseToolRule("Bash");
    expect(rule.tool).toBe("bash");
    expect(rule.pattern).toBeNull();
  });

  it("normalizes case-insensitively and maps aliases", () => {
    expect(parseToolRule("ReadFile").tool).toBe("readFile");
    expect(parseToolRule("read").tool).toBe("readFile");
    expect(parseToolRule("EditFile").tool).toBe("editFile");
    expect(parseToolRule("taskmanager").tool).toBe("taskManager");
    expect(parseToolRule("tasks").tool).toBe("taskManager");
  });

  it("parses tool names with patterns", () => {
    const bashRule = parseToolRule("Bash(git:*)");
    expect(bashRule.tool).toBe("bash");
    expect(bashRule.pattern).toBe("git:*");

    const readRule = parseToolRule("ReadFile(src/*)");
    expect(readRule.tool).toBe("readFile");
    expect(readRule.pattern).toBe("src/*");
  });

  it("throws error for malformed rules or missing parentheses", () => {
    expect(() => parseToolRule("")).toThrow();
    expect(() => parseToolRule("Bash(git:*")).toThrow();
    expect(() => parseToolRule("Bash()")).toThrow();
    expect(() => parseToolRule("UnknownTool")).toThrow();
  });
});

describe("parseToolRuleList", () => {
  it("parses comma-separated lists of rules", () => {
    const rules = parseToolRuleList("ReadFile, EditFile, Bash(npm test)");
    expect(rules).toHaveLength(3);
    expect(rules[0].tool).toBe("readFile");
    expect(rules[1].tool).toBe("editFile");
    expect(rules[2].tool).toBe("bash");
    expect(rules[2].pattern).toBe("npm test");
  });

  it("handles empty or whitespace strings cleanly", () => {
    expect(parseToolRuleList("")).toHaveLength(0);
    expect(parseToolRuleList(undefined)).toHaveLength(0);
  });
});

describe("matchesPattern", () => {
  it("matches wildcard prefix patterns", () => {
    expect(matchesPattern("git:*", "git:status")).toBe(true);
    expect(matchesPattern("git:*", "git status")).toBe(true);
    expect(matchesPattern("git:*", "npm test")).toBe(false);
  });

  it("matches wildcard suffix and exact patterns", () => {
    expect(matchesPattern("src/*", "src/index.ts")).toBe(true);
    expect(matchesPattern("npm test", "npm test")).toBe(true);
    expect(matchesPattern("npm test", "npm run build")).toBe(false);
  });
});

describe("evaluateToolPolicy", () => {
  it("always permits taskManager without requiring pattern rules", () => {
    const evalResult = evaluateToolPolicy({
      toolName: "taskManager",
      parameters: { action: "status", taskId: "t1" },
      allowedRules: [parseToolRule("ReadFile")],
    });
    expect(evalResult.decision).toBe("allow");
  });

  it("enforces deny rules first", () => {
    const disallowed = parseToolRuleList("Bash(curl:*)");
    const allowed = parseToolRuleList("Bash");

    const deniedCall = evaluateToolPolicy({
      toolName: "bash",
      parameters: { command: "curl -s http://example.com" },
      allowedRules: allowed,
      disallowedRules: disallowed,
    });
    expect(deniedCall.decision).toBe("deny");

    const allowedCall = evaluateToolPolicy({
      toolName: "bash",
      parameters: { command: "npm test" },
      allowedRules: allowed,
      disallowedRules: disallowed,
    });
    expect(allowedCall.decision).toBe("allow");
  });

  it("denies unallowed tools when allowedRules list is provided", () => {
    const allowed = parseToolRuleList("ReadFile, Glob");

    const result = evaluateToolPolicy({
      toolName: "writeFile",
      parameters: { filePath: "src/new.ts", content: "code" },
      allowedRules: allowed,
    });
    expect(result.decision).toBe("deny");
  });
});
