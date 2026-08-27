/**
 * Provider registry.
 *
 * Every provider here exposes an Anthropic-compatible Messages API, which is what
 * lets Claude Code talk to it at all. What they do NOT agree on is the shape of
 * the response `id`: Anthropic returns `msg_...`, OpenRouter returns `gen-...`,
 * Groq returns its own form. That mismatch is what ccswitch's proxy exists to fix.
 */

export interface Provider {
  /** Short name used on the CLI: `ccswitch use openrouter/...`. */
  id: string;
  /** Human-facing label. */
  label: string;
  /** Base URL of the Anthropic-compatible endpoint (no trailing slash). */
  baseUrl: string;
  /** Environment variable holding the API key. */
  keyEnv: string;
  /** Where to get a key, shown when the env var is missing. */
  keysUrl: string;
  /** Where the user browses available models. */
  modelsUrl: string;
}

export const PROVIDERS: Record<string, Provider> = {
  openrouter: {
    id: "openrouter",
    label: "OpenRouter",
    baseUrl: "https://openrouter.ai/api",
    keyEnv: "OPENROUTER_API_KEY",
    keysUrl: "https://openrouter.ai/keys",
    modelsUrl: "https://openrouter.ai/models",
  },
  groq: {
    id: "groq",
    label: "Groq",
    baseUrl: "https://api.groq.com/anthropic",
    keyEnv: "GROQ_API_KEY",
    keysUrl: "https://console.groq.com/keys",
    modelsUrl: "https://console.groq.com/docs/models",
  },
};

export const DEFAULT_PROVIDER = "openrouter";

/** Seed favorites for a fresh install. Kept short and current on purpose. */
export const SEED_FAVORITES = [
  {
    provider: "openrouter",
    id: "z-ai/glm-5.3-flash",
    note: "GLM-5.3 Flash — fast, 1M context, very cheap",
  },
  {
    provider: "openrouter",
    id: "moonshotai/kimi-k3",
    note: "Kimi K3 — strong agentic reasoning",
  },
  {
    provider: "openrouter",
    id: "qwen/qwen3.8-flash",
    note: "Qwen3.8 Flash — cheap and quick",
  },
  {
    provider: "groq",
    id: "moonshotai/kimi-k2-instruct",
    note: "Kimi K2 on Groq — very high tokens/sec",
  },
];

export function getProvider(id: string): Provider {
  const p = PROVIDERS[id];
  if (!p) {
    throw new Error(
      `unknown provider '${id}'. Known: ${Object.keys(PROVIDERS).join(", ")}`,
    );
  }
  return p;
}

/**
 * Split a model reference into provider + model id.
 *   "groq:llama-3.3-70b"        -> { provider: "groq",       model: "llama-3.3-70b" }
 *   "z-ai/glm-5.3-flash"        -> { provider: <fallback>,   model: "z-ai/glm-5.3-flash" }
 *
 * A leading `provider:` prefix wins; otherwise the fallback (usually the last-used
 * provider, else openrouter) applies. Note that model ids themselves often contain
 * "/" (vendor/model), so only ":" is treated as the provider separator.
 */
export function parseModelRef(
  ref: string,
  fallbackProvider: string = DEFAULT_PROVIDER,
): { provider: string; model: string } {
  const sep = ref.indexOf(":");
  if (sep > 0) {
    const maybe = ref.slice(0, sep);
    if (PROVIDERS[maybe]) return { provider: maybe, model: ref.slice(sep + 1) };
  }
  return { provider: fallbackProvider, model: ref };
}
