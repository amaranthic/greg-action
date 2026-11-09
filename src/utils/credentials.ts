/**
 * @fileoverview Default endpoint resolution for AI providers.
 *
 * Ensures non-empty baseUrl is always provided to Harnex by populating standard
 * canonical endpoints when the user only supplies an API key.
 *
 * @packageDocumentation
 */

/**
 * Standard canonical base URLs for AI providers.
 */
const CANONICAL_BASE_URLS: Record<string, string> = {
  anthropic: "https://api.anthropic.com/v1",
  openai: "https://api.openai.com/v1",
  google: "https://generativelanguage.googleapis.com/v1beta",
  deepseek: "https://api.deepseek.com/v1",
  groq: "https://api.groq.com/openai/v1",
  mistral: "https://api.mistral.ai/v1",
  cohere: "https://api.cohere.com/v2",
  openrouter: "https://openrouter.ai/api/v1",
  xai: "https://api.x.ai/v1",
};

/**
 * Resolves the appropriate base URL for a given model string.
 *
 * @param modelString - Formatted as "provider/model_id".
 * @param customBaseUrl - User-supplied custom base URL (if any).
 * @returns Non-empty base URL string.
 */
export function resolveBaseUrl(
  modelString: string,
  customBaseUrl?: string
): string {
  if (customBaseUrl && customBaseUrl.trim()) {
    return customBaseUrl.trim();
  }

  if (modelString === "dummy") {
    return "http://localhost:8080/v1";
  }

  const slashIndex = modelString.indexOf("/");
  const provider =
    slashIndex !== -1
      ? modelString.slice(0, slashIndex).toLowerCase()
      : "anthropic";

  return CANONICAL_BASE_URLS[provider] || "https://api.anthropic.com/v1";
}
