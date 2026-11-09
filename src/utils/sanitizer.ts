/**
 * @fileoverview Sanitization utilities to redact secrets and credentials from outputs.
 *
 * @packageDocumentation
 */

/**
 * Patterns that identify sensitive authentication tokens or credentials.
 */
const SENSITIVE_PATTERNS = [
  /gh[pousr]_[A-Za-z0-9_]{36,}/g, // GitHub tokens
  /github_pat_[A-Za-z0-9_]{82}/g, // Fine-grained GitHub PAT
  /sk-ant-[A-Za-z0-9_-]{32,}/g, // Anthropic API keys
  /sk-[A-Za-z0-9_-]{20,}/g, // OpenAI-style keys
  /AIza[0-9A-Za-z-_]{35}/g, // Google API keys
  /xox[baprs]-[0-9a-zA-Z-]{10,}/g, // Slack tokens
];

/**
 * Redacts secrets and credentials from an input string.
 *
 * @param input - The raw string that may contain secrets.
 * @param customSecrets - Optional additional secret strings to redact.
 * @returns Cleaned string with secrets replaced with `[REDACTED]`.
 */
export function redactSecrets(
  input: string,
  customSecrets: readonly string[] = []
): string {
  if (!input) {
    return "";
  }

  let cleaned = input;

  for (const pattern of SENSITIVE_PATTERNS) {
    cleaned = cleaned.replace(pattern, "[REDACTED]");
  }

  for (const secret of customSecrets) {
    if (secret && secret.length >= 4) {
      cleaned = cleaned.replaceAll(secret, "[REDACTED]");
    }
  }

  return cleaned;
}
