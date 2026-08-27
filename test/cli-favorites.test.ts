import { describe, expect, test } from "bun:test";
import { parseModelRef } from "../src/providers";
import type { Favorite } from "../src/config";

/**
 * Favorite matching rules, mirroring cmdRemove: an unprefixed id matches on model
 * alone (so users need not remember which provider it came from), while a
 * prefixed one must match both.
 */
function findMatches(favorites: Favorite[], ref: string, fallback?: string): Favorite[] {
  const explicit = ref.includes(":");
  const { provider, model } = parseModelRef(ref, fallback);
  return favorites.filter((f) =>
    explicit ? f.id === model && f.provider === provider : f.id === model,
  );
}

const favorites: Favorite[] = [
  { provider: "openrouter", id: "z-ai/glm-5.3-flash" },
  { provider: "groq", id: "llama-3.3-70b-versatile" },
  { provider: "openrouter", id: "moonshotai/kimi-k3" },
  { provider: "groq", id: "moonshotai/kimi-k3" },
];

describe("favorite matching", () => {
  test("an unprefixed id matches across providers", () => {
    // Regression: removing a Groq favorite without the prefix used to fail,
    // because the fallback provider was openrouter.
    const hits = findMatches(favorites, "llama-3.3-70b-versatile", "openrouter");
    expect(hits).toHaveLength(1);
    expect(hits[0]!.provider).toBe("groq");
  });

  test("a prefixed id matches only that provider", () => {
    expect(findMatches(favorites, "groq:moonshotai/kimi-k3")).toHaveLength(1);
  });

  test("an ambiguous unprefixed id reports every match", () => {
    expect(findMatches(favorites, "moonshotai/kimi-k3")).toHaveLength(2);
  });

  test("an unknown id matches nothing", () => {
    expect(findMatches(favorites, "nope/nothing")).toHaveLength(0);
  });
});
