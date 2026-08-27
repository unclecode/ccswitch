/**
 * Hook installation must never damage a user's existing settings.json — it is the
 * file that configures their whole Claude Code setup.
 */
import { describe, expect, test } from "bun:test";

/** Pure form of installHook's merge, so it can be tested without touching $HOME. */
function addHook(settings: any, command = "ccswitch heal --quiet"): any {
  const next = structuredClone(settings);
  next.hooks ??= {};
  next.hooks.SessionStart ??= [];
  next.hooks.SessionStart.push({ hooks: [{ type: "command", command }] });
  return next;
}

function hasHook(settings: any): boolean {
  const entries = settings?.hooks?.SessionStart;
  if (!Array.isArray(entries)) return false;
  return entries.some((e: any) =>
    (e?.hooks ?? []).some(
      (h: any) => typeof h?.command === "string" && h.command.includes("ccswitch heal"),
    ),
  );
}

function removeHook(settings: any): any {
  const next = structuredClone(settings);
  if (!hasHook(next)) return next;
  next.hooks.SessionStart = next.hooks.SessionStart
    .map((e: any) => ({
      ...e,
      hooks: (e.hooks ?? []).filter(
        (h: any) => !(typeof h?.command === "string" && h.command.includes("ccswitch heal")),
      ),
    }))
    .filter((e: any) => (e.hooks ?? []).length > 0);
  if (next.hooks.SessionStart.length === 0) delete next.hooks.SessionStart;
  if (Object.keys(next.hooks).length === 0) delete next.hooks;
  return next;
}

describe("hook detection", () => {
  test("absent in empty settings", () => {
    expect(hasHook({})).toBe(false);
  });

  test("absent when other hooks exist", () => {
    expect(
      hasHook({ hooks: { Stop: [{ hooks: [{ type: "command", command: "say done" }] }] } }),
    ).toBe(false);
  });

  test("present once installed", () => {
    expect(hasHook(addHook({}))).toBe(true);
  });

  test("tolerates a malformed hooks block", () => {
    expect(hasHook({ hooks: { SessionStart: "not an array" } })).toBe(false);
    expect(hasHook({ hooks: null })).toBe(false);
  });
});

describe("hook install", () => {
  test("preserves unrelated settings", () => {
    const before = {
      model: "claude-opus-5",
      env: { FOO: "1" },
      permissions: { allow: ["Bash(ls:*)"] },
    };
    const after = addHook(before);

    expect(after.model).toBe("claude-opus-5");
    expect(after.env).toEqual({ FOO: "1" });
    expect(after.permissions.allow).toEqual(["Bash(ls:*)"]);
  });

  test("keeps the user's existing SessionStart hooks", () => {
    const before = {
      hooks: { SessionStart: [{ hooks: [{ type: "command", command: "my-own-thing" }] }] },
    };
    const after = addHook(before);

    expect(after.hooks.SessionStart).toHaveLength(2);
    expect(JSON.stringify(after)).toContain("my-own-thing");
  });

  test("keeps hooks of other kinds", () => {
    const before = { hooks: { Stop: [{ hooks: [{ type: "command", command: "cleanup" }] }] } };
    const after = addHook(before);

    expect(after.hooks.Stop).toHaveLength(1);
    expect(hasHook(after)).toBe(true);
  });
});

describe("hook uninstall", () => {
  test("removes only our hook", () => {
    const settings = addHook({
      hooks: { SessionStart: [{ hooks: [{ type: "command", command: "my-own-thing" }] }] },
    });
    const after = removeHook(settings);

    expect(hasHook(after)).toBe(false);
    expect(JSON.stringify(after)).toContain("my-own-thing");
  });

  test("cleans up empty containers it leaves behind", () => {
    const after = removeHook(addHook({}));
    expect(after.hooks).toBeUndefined();
  });

  test("leaves other settings intact", () => {
    const after = removeHook(addHook({ model: "claude-opus-5" }));
    expect(after.model).toBe("claude-opus-5");
  });

  test("is a no-op when the hook is absent", () => {
    const settings = { model: "x" };
    expect(removeHook(settings)).toEqual(settings);
  });

  test("install then uninstall round-trips to the original", () => {
    const original = {
      model: "claude-opus-5",
      hooks: { Stop: [{ hooks: [{ type: "command", command: "cleanup" }] }] },
    };
    expect(removeHook(addHook(original))).toEqual(original);
  });
});
