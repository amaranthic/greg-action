/**
 * @fileoverview Tool permission parsing and evaluation policy.
 *
 * Implements fine-grained tool authorization inspired by ant, featuring:
 * - Native Bun.Glob pattern matching for file paths and wildcards.
 * - Shell anti-chaining security preventing injection attacks on scoped Bash rules.
 * - Decomposed command inspection for deny-rule enforcement across chained pipelines.
 * - Uniform handling of command prefixes (e.g. `git *` and `git:*`).
 * - Associative authorization of TaskManager as the companion supervisor tool for Bash.
 * - Deny-first precedence.
 *
 * @packageDocumentation
 */

import { isAbsolute, normalize, resolve } from "node:path";

/**
 * Valid canonical tool names recognized in the runtime.
 */
export type CanonicalToolName =
  | "readFile"
  | "writeFile"
  | "editFile"
  | "bash"
  | "taskManager"
  | "glob"
  | "grep";

/**
 * Normalized representation of a parsed tool permission rule.
 */
export interface ParsedToolRule {
  /** The original raw rule string supplied by the user. */
  readonly raw: string;
  /** The normalized canonical tool name. */
  readonly tool: CanonicalToolName;
  /** Optional pattern enclosed within parentheses (e.g. `git:*`, `src/**\/*.ts`). */
  readonly pattern: string | null;
}

/**
 * Result of evaluating a tool execution against configured permission rules.
 */
export interface ToolPermissionEvaluation {
  /** Whether the tool call is permitted to execute. */
  readonly decision: "allow" | "deny";
  /** Optional reason explaining the denial decision. */
  readonly reason?: string;
}

/**
 * Mapping of case-insensitive input names and aliases to canonical tool names.
 */
const CANONICAL_TOOL_MAP: Record<string, CanonicalToolName> = {
  readfile: "readFile",
  read: "readFile",
  writefile: "writeFile",
  write: "writeFile",
  editfile: "editFile",
  edit: "editFile",
  bash: "bash",
  sh: "bash",
  shell: "bash",
  taskmanager: "taskManager",
  task: "taskManager",
  tasks: "taskManager",
  glob: "glob",
  grep: "grep",
};

/**
 * Regular expression detecting shell command chaining, piping, redirection,
 * newlines, and subshell substitutions.
 */
export const BASH_CHAINING_REGEX = /[;&|\n`]|(?:\$|<|>)\(/;

/**
 * Normalizes a raw tool identifier to its canonical camelCase name.
 *
 * @param name - Raw tool name string.
 * @returns Canonical tool name or undefined if unrecognized.
 */
export function normalizeToolName(name: string): CanonicalToolName | undefined {
  const clean = name.trim().toLowerCase();
  return CANONICAL_TOOL_MAP[clean];
}

/**
 * Normalizes a bash pattern prefix, stripping trailing wildcards and colons.
 * E.g., `git:*` -> `git`, `git *` -> `git`, `npm:*` -> `npm`.
 *
 * @param pattern - Raw pattern from tool rule.
 * @returns Clean prefix string.
 */
export function normalizeBashPrefix(pattern: string): string {
  let clean = pattern.trim();
  if (clean.endsWith(":*")) {
    clean = clean.slice(0, -2);
  } else if (clean.endsWith(" *")) {
    clean = clean.slice(0, -2);
  } else if (clean.endsWith("*")) {
    clean = clean.slice(0, -1);
  }
  if (clean.endsWith(":")) {
    clean = clean.slice(0, -1);
  }
  return clean.trim();
}

/**
 * Checks if a candidate shell command matches a bash pattern prefix or glob.
 *
 * Supports uniform matching for both `git *` and `git:*` styles.
 *
 * @param pattern - Configured pattern (e.g. `git:*`, `git *`, `npm test`, `ls *`).
 * @param command - The candidate command string.
 * @returns True if the command matches the pattern.
 */
export function matchBashPrefix(pattern: string, command: string): boolean {
  const trimmed = command.trim();
  if (pattern === "*") {
    return true;
  }
  const prefix = normalizeBashPrefix(pattern);
  if (!prefix) {
    return true;
  }
  if (
    trimmed === prefix ||
    trimmed.startsWith(`${prefix} `) ||
    trimmed.startsWith(`${prefix}:`)
  ) {
    return true;
  }
  try {
    const glob = new Bun.Glob(pattern);
    if (glob.match(trimmed)) {
      return true;
    }
  } catch {
    // Ignore invalid glob patterns and fall back
  }
  return trimmed === pattern;
}

/**
 * Evaluates a shell command against a bash pattern rule with anti-chaining security.
 *
 * Scoped allow rules strictly reject commands containing chaining, piping, or command
 * substitution characters (`;&|\n$` and `$()`). Deny rules decompose the pipeline into
 * segments and verify that none of the individual segments match the denied pattern.
 *
 * @param pattern - Pattern from the parsed rule.
 * @param command - Shell command string.
 * @param isDeny - Whether this evaluation is for a deny rule.
 * @returns True if the command matches the rule.
 */
export function matchBashRule(
  pattern: string,
  command: string,
  isDeny: boolean
): boolean {
  const trimmed = command.trim();
  if (!trimmed) {
    return false;
  }

  if (isDeny) {
    if (matchBashPrefix(pattern, trimmed)) {
      return true;
    }
    const segments = command
      .split(/[;&|\n`()]/)
      .map((seg) => seg.replace(/^\$\(/, "").trim())
      .filter(Boolean);
    for (const segment of segments) {
      if (matchBashPrefix(pattern, segment)) {
        return true;
      }
    }
    return false;
  }

  // Scoped allow rules: reject any chaining or command substitution to prevent injection
  if (pattern !== "*" && BASH_CHAINING_REGEX.test(command)) {
    return false;
  }

  return matchBashPrefix(pattern, trimmed);
}

/**
 * Normalizes a path relative to the active workspace directory for policy evaluation.
 * Converts Windows backslashes to forward slashes and resolves relative paths cleanly.
 *
 * @param targetPath - Absolute or relative file path.
 * @param cwd - Base working directory (defaults to process.cwd()).
 * @returns Normalized relative path or "." for root.
 */
export function normalizePathForPolicy(
  targetPath: string,
  cwd: string = process.cwd()
): string {
  const normCwd = normalize(cwd).replace(/\\/g, "/");
  const resolved = isAbsolute(targetPath)
    ? normalize(targetPath).replace(/\\/g, "/")
    : normalize(resolve(cwd, targetPath)).replace(/\\/g, "/");

  if (resolved === normCwd) {
    return ".";
  }
  if (resolved.startsWith(normCwd + "/")) {
    return resolved.slice(normCwd.length + 1);
  }
  return resolved;
}

/**
 * Matches a relative path against a glob pattern using native Bun.Glob.
 *
 * @param pattern - Glob pattern (e.g. `src/*`, `src/**\/*.ts`, `test/*.test.ts`).
 * @param normPath - Normalized relative path.
 * @returns True if the path matches the glob pattern.
 */
export function matchPathGlob(pattern: string, normPath: string): boolean {
  const cleanPattern = pattern.replace(/^\.\//, "");
  try {
    const glob = new Bun.Glob(cleanPattern);
    return glob.match(normPath);
  } catch {
    return normPath === cleanPattern;
  }
}

/**
 * Matches a string against a glob or wildcard pattern using native Bun.Glob.
 *
 * @param pattern - Glob pattern.
 * @param candidate - Candidate string to evaluate.
 * @returns True if candidate satisfies the pattern.
 */
export function matchesPattern(pattern: string, candidate: string): boolean {
  if (pattern === "*") {
    return true;
  }
  if (pattern.endsWith(":*") || pattern.endsWith(" *")) {
    const prefix = normalizeBashPrefix(pattern);
    return (
      candidate === prefix ||
      candidate.startsWith(`${prefix} `) ||
      candidate.startsWith(`${prefix}:`)
    );
  }
  try {
    const glob = new Bun.Glob(pattern);
    return glob.match(candidate);
  } catch {
    return candidate === pattern;
  }
}

/**
 * Parses a single permission rule string into a structured {@link ParsedToolRule}.
 *
 * Examples:
 * - `"Bash"` -> `{ tool: "bash", pattern: null }`
 * - `"Bash(git:*)"` -> `{ tool: "bash", pattern: "git:*" }`
 * - `"ReadFile(src/**\/*.ts)"` -> `{ tool: "readFile", pattern: "src/**\/*.ts" }`
 *
 * @param ruleString - Raw rule string from workflow inputs.
 * @returns Parsed tool rule object.
 * @throws Error if the rule is malformed or specifies an unknown tool.
 */
export function parseToolRule(ruleString: string): ParsedToolRule {
  const trimmed = ruleString.trim();
  if (!trimmed) {
    throw new Error("Malformed permission rule: empty string provided");
  }

  const parenIndex = trimmed.indexOf("(");

  // Plain tool name with no parentheses
  if (parenIndex === -1) {
    if (trimmed.endsWith(")")) {
      throw new Error(`Malformed permission rule: "${trimmed}"`);
    }
    const tool = normalizeToolName(trimmed);
    if (!tool) {
      throw new Error(`Unknown tool "${trimmed}" in permission rule`);
    }
    return { raw: trimmed, tool, pattern: null };
  }

  // Parentheses present
  if (parenIndex === 0) {
    throw new Error(
      `Malformed rule: "${trimmed}" (missing tool name before parenthesis)`
    );
  }

  if (!trimmed.endsWith(")")) {
    throw new Error(
      `Malformed rule: "${trimmed}" (missing closing parenthesis)`
    );
  }

  const toolNamePart = trimmed.slice(0, parenIndex).trim();
  const tool = normalizeToolName(toolNamePart);
  if (!tool) {
    throw new Error(`Unknown tool "${toolNamePart}" in permission rule`);
  }

  const patternPart = trimmed.slice(parenIndex + 1, -1).trim();
  if (!patternPart) {
    throw new Error(
      `Malformed rule: empty pattern inside parentheses in "${trimmed}"`
    );
  }

  return { raw: trimmed, tool, pattern: patternPart };
}

/**
 * Parses a comma-separated list of rule strings into an array of {@link ParsedToolRule}.
 *
 * @param rulesString - Comma-separated rule definitions.
 * @returns Array of parsed rules.
 */
export function parseToolRuleList(
  rulesString: string | undefined
): ParsedToolRule[] {
  if (!rulesString || !rulesString.trim()) {
    return [];
  }
  return rulesString
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map(parseToolRule);
}

/**
 * Extracts the primary evaluation target string from tool parameters.
 *
 * @param toolName - Canonical tool name.
 * @param parameters - Tool input argument record.
 * @param cwd - Working directory for path normalization.
 * @returns Target string to test against patterns, or empty string.
 */
export function extractToolTarget(
  toolName: CanonicalToolName,
  parameters: Record<string, unknown>,
  cwd: string = process.cwd()
): string {
  switch (toolName) {
    case "bash":
      return typeof parameters.command === "string"
        ? parameters.command.trim()
        : "";
    case "readFile":
    case "writeFile":
    case "editFile": {
      const rawPath =
        typeof parameters.filePath === "string"
          ? parameters.filePath
          : typeof parameters.path === "string"
            ? parameters.path
            : "";
      return rawPath ? normalizePathForPolicy(rawPath, cwd) : "";
    }
    case "glob":
    case "grep": {
      const rawPath =
        typeof parameters.path === "string" && parameters.path.trim()
          ? parameters.path.trim()
          : "";
      if (rawPath) {
        return normalizePathForPolicy(rawPath, cwd);
      }
      return typeof parameters.pattern === "string"
        ? parameters.pattern.trim()
        : "";
    }
    case "taskManager":
      return typeof parameters.action === "string"
        ? parameters.action.trim()
        : "";
  }
}

/**
 * Evaluates whether a tool call satisfies a single parsed rule.
 *
 * Employs native Bun.Glob for path-based tools and anti-chaining prefix matching for bash.
 *
 * @param rule - Parsed tool rule.
 * @param toolName - Invoked tool canonical name.
 * @param parameters - Tool parameters record.
 * @param isDeny - Whether this match is being performed for a deny rule.
 * @param cwd - Base working directory for path resolution.
 * @returns True if the rule matches the tool invocation.
 */
export function ruleMatchesTool(
  rule: ParsedToolRule,
  toolName: CanonicalToolName,
  parameters: Record<string, unknown>,
  isDeny: boolean = false,
  cwd: string = process.cwd()
): boolean {
  if (rule.tool !== toolName) {
    return false;
  }
  if (rule.pattern === null) {
    return true;
  }

  if (toolName === "bash") {
    const command =
      typeof parameters.command === "string" ? parameters.command : "";
    return matchBashRule(rule.pattern, command, isDeny);
  }

  if (
    toolName === "readFile" ||
    toolName === "writeFile" ||
    toolName === "editFile"
  ) {
    const rawPath =
      typeof parameters.filePath === "string"
        ? parameters.filePath
        : typeof parameters.path === "string"
          ? parameters.path
          : "";
    if (!rawPath) {
      return false;
    }
    const norm = normalizePathForPolicy(rawPath, cwd);
    return matchPathGlob(rule.pattern, norm);
  }

  if (toolName === "glob") {
    const pathVal =
      typeof parameters.path === "string" ? parameters.path.trim() : ".";
    const normPath = normalizePathForPolicy(pathVal, cwd);
    if (matchPathGlob(rule.pattern, normPath)) {
      return true;
    }
    const patVal =
      typeof parameters.pattern === "string" ? parameters.pattern.trim() : "";
    if (patVal && matchesPattern(rule.pattern, patVal)) {
      return true;
    }
    return false;
  }

  if (toolName === "grep") {
    const pathVal =
      typeof parameters.path === "string" ? parameters.path.trim() : ".";
    const normPath = normalizePathForPolicy(pathVal, cwd);
    if (matchPathGlob(rule.pattern, normPath)) {
      return true;
    }
    const patVal =
      typeof parameters.pattern === "string" ? parameters.pattern.trim() : "";
    if (patVal && matchesPattern(rule.pattern, patVal)) {
      return true;
    }
    const globVal =
      typeof parameters.glob === "string" ? parameters.glob.trim() : "";
    if (globVal && matchPathGlob(rule.pattern, globVal)) {
      return true;
    }
    return false;
  }

  if (toolName === "taskManager") {
    const actionVal =
      typeof parameters.action === "string" ? parameters.action : "";
    return matchesPattern(rule.pattern, actionVal);
  }

  return false;
}

/**
 * Options supplied to {@link evaluateToolPolicy}.
 */
export interface EvaluateToolPolicyOptions {
  /** Raw or canonical tool name requested by the agent. */
  readonly toolName: string;
  /** Parameters passed to the tool call. */
  readonly parameters: Record<string, unknown>;
  /** Optional allow rules from workflow inputs. */
  readonly allowedRules?: readonly ParsedToolRule[];
  /** Optional deny rules from workflow inputs. */
  readonly disallowedRules?: readonly ParsedToolRule[];
  /** Default tools allowed for the current execution mode. */
  readonly defaultAllowedTools?: readonly CanonicalToolName[];
  /** Base working directory for resolving paths. */
  readonly cwd?: string;
}

/**
 * Evaluates a tool execution against configured allow and deny rule lists.
 *
 * Invariants:
 * - Deny rules evaluate first (deny-first precedence).
 * - Scoped allow rules for Bash enforce anti-chaining to prevent command injection.
 * - Bun.Glob is utilized for accurate path and wildcard glob matching.
 * - TaskManager is associated directly with Bash: if Bash is completely disallowed,
 *   TaskManager is also disallowed. In default engineering modes, TaskManager is permitted.
 *
 * @param options - Evaluation options.
 * @returns ToolPermissionEvaluation containing allow/deny decision.
 */
export function evaluateToolPolicy(
  options: EvaluateToolPolicyOptions
): ToolPermissionEvaluation {
  const cwd = options.cwd ?? process.cwd();
  const canonical = normalizeToolName(options.toolName);
  if (!canonical) {
    return {
      decision: "deny",
      reason: `Unknown tool "${options.toolName}" is not permitted.`,
    };
  }

  const disallowedRules = options.disallowedRules ?? [];
  const allowedRules = options.allowedRules ?? [];

  // Phase 1: Deny rules evaluate first
  for (const denyRule of disallowedRules) {
    if (ruleMatchesTool(denyRule, canonical, options.parameters, true, cwd)) {
      return {
        decision: "deny",
        reason: `Explicitly forbidden by rule: "${denyRule.raw}"`,
      };
    }
  }

  // Refinement: TaskManager is the supervisor associated with Bash.
  // If Bash is completely disallowed (rule with no pattern or "*"), TaskManager is also disallowed.
  if (canonical === "taskManager") {
    for (const denyRule of disallowedRules) {
      if (
        denyRule.tool === "bash" &&
        (denyRule.pattern === null || denyRule.pattern === "*")
      ) {
        return {
          decision: "deny",
          reason: `TaskManager is disallowed because Bash is disabled by rule: "${denyRule.raw}"`,
        };
      }
    }
  }

  // Phase 2: If allowed rules were provided, match against them
  if (allowedRules.length > 0) {
    for (const allowRule of allowedRules) {
      if (
        ruleMatchesTool(allowRule, canonical, options.parameters, false, cwd)
      ) {
        return { decision: "allow" };
      }
    }

    // Refinement: If TaskManager is invoked, allow it if Bash is in allowedRules or by supervisor default
    if (canonical === "taskManager") {
      const allowsBash = allowedRules.some((r) => r.tool === "bash");
      if (allowsBash) {
        return { decision: "allow" };
      }
      // If default mode allows TaskManager and Bash was not explicitly denied, allow
      if (
        !options.defaultAllowedTools ||
        options.defaultAllowedTools.includes("taskManager")
      ) {
        return { decision: "allow" };
      }
    }

    return {
      decision: "deny",
      reason: `Tool "${canonical}" did not match any configured allow rules.`,
    };
  }

  // Phase 3: Check default allowed tool set for the active mode
  if (
    options.defaultAllowedTools &&
    !options.defaultAllowedTools.includes(canonical)
  ) {
    return {
      decision: "deny",
      reason: `Tool "${canonical}" is not available in the current mode.`,
    };
  }

  return { decision: "allow" };
}
