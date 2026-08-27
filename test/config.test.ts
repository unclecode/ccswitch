import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applyAnthropic,
  applyProvider,
  projectRoot,
  readJson,
  readStatus,
  settingsPath,
  writeJson,
} from "../src/config";
import { parseModelRef, getProvider, PROVIDERS } from "../src/providers";

const dirs: string[] = [];

function project(): string {
  const dir = mkdtempSync(join(tmpdir(), "ccswitch-proj-"));
  dirs.push(dir);
  mkdirSync(join(dir, ".claude"), { recursive: true });
  return dir;
}

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe("parseModelRef", () => {
  test("reads an explicit provider prefix", () => {
    expect(parseModelRef("groq:llama-3.3-70b")).toEqual({
      provider: "groq",
      model: "llama-3.3-70b",
    });
  });

  test("falls back for a bare model id", () => {
    expect(parseModelRef("z-ai/glm-5.3-flash")).toEqual({
      provider: "openrouter",
      model: "z-ai/glm-5.3-flash",
    });
  });

  test("keeps vendor/model slashes intact", () => {
    expect(parseModelRef("groq:moonshotai/kimi-k2-instruct")).toEqual({
      provider: "groq",
      model: "moonshotai/kimi-k2-instruct",
    });
  });

  test("an unknown prefix is treated as part of the model id", () => {
    // Avoids silently sending "anthropic:foo" to the wrong place.
    expect(parseModelRef("notaprovider:thing")).toEqual({
      provider: "openrouter",
      model: "notaprovider:thing",
    });
  });

  test("honours a custom fallback provider", () => {
    expect(parseModelRef("some-model", "groq").provider).toBe("groq");
  });
});

describe("getProvider", () => {
  test("returns known providers", () => {
    expect(getProvider("openrouter").baseUrl).toContain("openrouter.ai");
    expect(getProvider("groq").baseUrl).toContain("groq.com");
  });

  test("throws helpfully on an unknown one", () => {
    expect(() => getProvider("nope")).toThrow(/unknown provider/);
  });

  test("every provider declares the fields the CLI relies on", () => {
    for (const p of Object.values(PROVIDERS)) {
      expect(p.baseUrl).toStartWith("https://");
      expect(p.baseUrl.endsWith("/")).toBe(false);
      expect(p.keyEnv).toMatch(/^[A-Z0-9_]+$/);
      expect(p.keysUrl).toStartWith("https://");
      expect(p.modelsUrl).toStartWith("https://");
    }
  });
});

describe("applyProvider / applyAnthropic", () => {
  test("writes the override keys", () => {
    const root = project();
    applyProvider({
      baseUrl: "http://127.0.0.1:8787",
      token: "secret",
      model: "z-ai/glm-5.3-flash",
      root,
    });

    const env = readJson(settingsPath(root)).env;
    expect(env.ANTHROPIC_BASE_URL).toBe("http://127.0.0.1:8787");
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe("secret");
    expect(env.ANTHROPIC_MODEL).toBe("z-ai/glm-5.3-flash");
    expect(env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe("z-ai/glm-5.3-flash");
  });

  test("blanks ANTHROPIC_API_KEY rather than leaving it unset", () => {
    // Guards against a stray key in the shell causing surprise API billing.
    const root = project();
    applyProvider({ baseUrl: "http://x", token: "t", model: "m", root });
    expect(readJson(settingsPath(root)).env.ANTHROPIC_API_KEY).toBe("");
  });

  test("preserves unrelated settings", () => {
    const root = project();
    writeJson(settingsPath(root), {
      permissions: { allow: ["Bash(ls:*)"] },
      env: { MY_OWN_VAR: "keep me" },
    });

    applyProvider({ baseUrl: "http://x", token: "t", model: "m", root });

    const data = readJson(settingsPath(root));
    expect(data.permissions.allow).toEqual(["Bash(ls:*)"]);
    expect(data.env.MY_OWN_VAR).toBe("keep me");
  });

  test("switching back overwrites rather than deletes by default", () => {
    // A running session picks up changed values but never un-applies removed keys.
    const root = project();
    applyProvider({ baseUrl: "http://x", token: "t", model: "m", root });

    applyAnthropic(false, root);

    const env = readJson(settingsPath(root)).env;
    expect(env.ANTHROPIC_BASE_URL).toBe("https://api.anthropic.com");
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe("");
    expect(env.ANTHROPIC_MODEL).toBe("");
  });

  test("--clean removes the keys entirely", () => {
    const root = project();
    applyProvider({ baseUrl: "http://x", token: "t", model: "m", root });

    applyAnthropic(true, root);

    const env = readJson(settingsPath(root)).env ?? {};
    expect("ANTHROPIC_BASE_URL" in env).toBe(false);
    expect("ANTHROPIC_MODEL" in env).toBe(false);
  });

  test("--clean keeps unrelated env vars and drops an emptied env block", () => {
    const root = project();
    writeJson(settingsPath(root), { env: { KEEP: "1" } });
    applyProvider({ baseUrl: "http://x", token: "t", model: "m", root });

    applyAnthropic(true, root);

    expect(readJson(settingsPath(root)).env).toEqual({ KEEP: "1" });
  });

  test("switching back with no settings file is a no-op", () => {
    const root = project();
    expect(applyAnthropic(false, root).existed).toBe(false);
  });

  test("a backup is written before each change", () => {
    const root = project();
    applyProvider({ baseUrl: "http://x", token: "t", model: "m", root });
    // First call had no prior file to back up; the second does.
    const { backup } = applyProvider({ baseUrl: "http://y", token: "t", model: "m", root });
    expect(backup).toBeTruthy();
    expect(readJson(backup!).env.ANTHROPIC_BASE_URL).toBe("http://x");
  });
});

describe("readStatus", () => {
  test("reports the subscription when nothing is overridden", () => {
    const root = project();
    expect(readStatus(root)).toEqual({ mode: "anthropic", leftovers: false });
  });

  test("flags leftover empty keys", () => {
    const root = project();
    applyProvider({ baseUrl: "http://x", token: "t", model: "m", root });
    applyAnthropic(false, root);

    const status = readStatus(root);
    expect(status.mode).toBe("anthropic");
    expect(status.mode === "anthropic" && status.leftovers).toBe(true);
  });

  test("detects a proxied third-party route", () => {
    const root = project();
    applyProvider({
      baseUrl: "http://127.0.0.1:8787",
      token: "t",
      model: "z-ai/glm-5.3-flash",
      root,
    });

    const status = readStatus(root);
    expect(status.mode).toBe("third-party");
    expect(status.mode === "third-party" && status.viaProxy).toBe(true);
    expect(status.mode === "third-party" && status.model).toBe("z-ai/glm-5.3-flash");
  });

  test("detects a direct third-party route", () => {
    const root = project();
    applyProvider({
      baseUrl: "https://openrouter.ai/api",
      token: "t",
      model: "m",
      root,
    });

    const status = readStatus(root);
    expect(status.mode === "third-party" && status.viaProxy).toBe(false);
  });
});

describe("projectRoot", () => {
  test("finds the nearest ancestor holding .claude", () => {
    const root = project();
    const nested = join(root, "a", "b");
    mkdirSync(nested, { recursive: true });
    expect(projectRoot(nested)).toBe(root);
  });
});
