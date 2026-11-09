/**
 * @fileoverview Tool permission parsing and evaluation policy.
 *
 * Implements fine-grained tool authorization inspired by ant, supporting
 * pattern-based rule matching (e.g. `Bash(git:*)`, `ReadFile(src/*)`)
 * with deny-first precedence and automatic exemption for internal task management.
 *
 * @packageDocumentation
 */

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
  /** Optional pattern enclosed within parentheses (e.g. `git:*`). */
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
 * Mapping of case-insensitive input names to canonical tool names.
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
 * Parses a single permission rule string into a structured {@link ParsedToolRule}.
 *
 * Examples:
 * - `"Bash"` -> `{ tool: "bash", pattern: null }`
 * - `"Bash(git:*)"` -> `{ tool: "bash", pattern: "git:*" }`
 * - `"ReadFile(src/*)"` -> `{ tool: "readFile", pattern: "src/*" }`
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

  // Case 1: Plain tool name with no parentheses
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

  // Case 2: Parentheses present
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
 * Matches a string against a simple wildcard glob pattern (supporting `*` prefix/suffix/contains).
 *
 * @param pattern - Glob pattern containing optional wildcards.
 * @param candidate - Candidate string to evaluate.
 * @returns True if candidate satisfies the pattern.
 */
export function matchesPattern(pattern: string, candidate: string): boolean {
  if (pattern === "*") {
    return true;
  }
  if (pattern.endsWith(":*")) {
    const prefix = pattern.slice(0, -2);
    return (
      candidate === prefix ||
      candidate.startsWith(`${prefix} `) ||
      candidate.startsWith(`${prefix}:`)
    );
  }
  if (pattern.endsWith("*")) {
    const prefix = pattern.slice(0, -1);
    return candidate.startsWith(prefix);
  }
  if (pattern.startsWith("*")) {
    const suffix = pattern.slice(1);
    return candidate.endsWith(suffix);
  }
  return candidate === pattern;
}

/**
 * Extracts the primary evaluation target argument from tool parameters.
 *
 * @param toolName - Canonical tool name.
 * @param parameters - Tool input argument record.
 * @returns Target string to test against patterns, or empty string.
 */
export function extractToolTarget(
  toolName: CanonicalToolName,
  parameters: Record<string, unknown>
): string {
  switch (toolName) {
    case "bash":
      return typeof parameters.command === "string"
        ? parameters.command.trim()
        : "";
    case "readFile":
    case "writeFile":
    case "editFile":
      return typeof parameters.filePath === "string"
        ? parameters.filePath.trim()
        : "";
    case "glob":
    case "grep":
      if (typeof parameters.pattern === "string")
        return parameters.pattern.trim();
      if (typeof parameters.path === "string") return parameters.path.trim();
      return "";
    case "taskManager":
      return "";
  }
}

/**
 * Evaluates whether a tool call satisfies a single parsed rule.
 *
 * @param rule - Parsed tool rule.
 * @param toolName - Invoked tool canonical name.
 * @param parameters - Tool parameters record.
 * @returns True if the rule matches the tool invocation.
 */
export function ruleMatchesTool(
  rule: ParsedToolRule,
  toolName: CanonicalToolName,
  parameters: Record<string, unknown>
): boolean {
  if (rule.tool !== toolName) {
    return false;
  }
  if (!rule.pattern) {
    return true;
  }
  const target = extractToolTarget(toolName, parameters);
  return matchesPattern(rule.pattern, target);
}

/**
 * Evaluates a tool execution against configured allow and deny rule lists.
 *
 * Invariant: TaskManager is always fully allowed without pattern restrictions.
 * Invariant: Deny rules evaluate first (deny-first precedence).
 *
 * @param options - Evaluation options.
 * @returns ToolPermissionEvaluation containing allow/deny decision.
 */
export function evaluateToolPolicy(options: {
  readonly toolName: string;
  readonly parameters: Record<string, unknown>;
  readonly allowedRules?: readonly ParsedToolRule[];
  readonly disallowedRules?: readonly ParsedToolRule[];
  readonly defaultAllowedTools?: readonly CanonicalToolName[];
}): ToolPermissionEvaluation {
  const canonical = normalizeToolName(options.toolName);
  if (!canonical) {
    return {
      decision: "deny",
      reason: `Unknown tool "${options.toolName}" is not permitted.`,
    };
  }

  // TaskManager is strictly an internal process supervisor, always allowed when exposed.
  if (canonical === "taskManager") {
    return { decision: "allow" };
  }

  const disallowedRules = options.disallowedRules ?? [];
  const allowedRules = options.allowedRules ?? [];

  // Phase 1: Deny rules evaluate first
  for (const denyRule of disallowedRules) {
    if (ruleMatchesTool(denyRule, canonical, options.parameters)) {
      return {
        decision: "deny",
        reason: `Explicitly forbidden by rule: "${denyRule.raw}"`,
      };
    }
  }

  // Phase 2: If allowed rules were provided, match against them
  if (allowedRules.length > 0) {
    for (const allowRule of allowedRules) {
      if (ruleMatchesTool(allowRule, canonical, options.parameters)) {
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
