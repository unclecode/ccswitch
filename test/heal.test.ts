import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { heal } from "../src/heal";
import { settingsPath } from "../src/config";

const dirs: string[] = [];
function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), "ccswitch-heal-"));
  dirs.push(d);
  return d;
}
afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }); });

describe("heal seeds the settings file", () => {
  test("creates {} where the file is missing", async () => {
    const dir = tempDir();
    const result = await heal(dir);

    expect(existsSync(settingsPath(dir))).toBe(true);
    expect(JSON.parse(readFileSync(settingsPath(dir), "utf8"))).toEqual({});
    // A fresh directory is on the subscription, so nothing else to do.
    expect(result.action).toBe("not-needed");
  });

  test("never overwrites an existing file", async () => {
    const dir = tempDir();
    mkdirSync(join(dir, ".claude"), { recursive: true });
    writeFileSync(settingsPath(dir), JSON.stringify({ env: { KEEP: "1" } }));

    await heal(dir);

    expect(JSON.parse(readFileSync(settingsPath(dir), "utf8")).env.KEEP).toBe("1");
  });
});
