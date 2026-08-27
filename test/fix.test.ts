import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixTranscript } from "../src/fix";

const dirs: string[] = [];

function transcript(lines: object[]): string {
  const dir = mkdtempSync(join(tmpdir(), "ccswitch-test-"));
  dirs.push(dir);
  const path = join(dir, "session.jsonl");
  writeFileSync(path, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  return path;
}

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

const assistant = (id: string, model = "z-ai/glm-5.3-flash") => ({
  type: "assistant",
  requestId: id,
  message: { id, model, role: "assistant", content: [{ type: "text", text: "hi" }] },
});

describe("fixTranscript", () => {
  test("rewrites foreign assistant ids", () => {
    const path = transcript([assistant("gen-1"), assistant("gen-2")]);
    const result = fixTranscript(path);

    expect(result.patched).toBe(2);
    expect(Object.keys(result.mapping)).toHaveLength(2);

    const ids = readFileSync(path, "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l).message.id);
    expect(ids.every((id) => id.startsWith("msg_"))).toBe(true);
  });

  test("leaves requestId alone", () => {
    // Only `message.id` is sent back as previous_message_id. Claude Code checks
    // that `requestId` is merely present, so the true upstream value is kept as
    // an honest record of which request produced the turn.
    const path = transcript([assistant("gen-1")]);
    fixTranscript(path);

    const rec = JSON.parse(readFileSync(path, "utf8").trim());
    expect(rec.requestId).toBe("gen-1");
    expect(rec.message.id).toStartWith("msg_");
  });

  test("maps repeated ids consistently", () => {
    // One assistant turn spans several lines sharing a message id.
    const path = transcript([assistant("gen-1"), assistant("gen-1"), assistant("gen-1")]);
    const result = fixTranscript(path);

    expect(result.patched).toBe(3);
    expect(Object.keys(result.mapping)).toHaveLength(1);

    const ids = readFileSync(path, "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l).message.id);
    expect(new Set(ids).size).toBe(1);
  });

  test("leaves a clean transcript untouched", () => {
    const path = transcript([assistant("msg_011CeSZ1Aeu7wQerbPL9pk1a", "claude-opus-5")]);
    const before = readFileSync(path, "utf8");

    const result = fixTranscript(path);

    expect(result.patched).toBe(0);
    expect(result.backup).toBeNull();
    expect(readFileSync(path, "utf8")).toBe(before);
  });

  test("skips synthetic entries", () => {
    // Claude Code's own local notices; never selected as previous_message_id.
    const path = transcript([
      { type: "assistant", message: { id: "abc-uuid", model: "<synthetic>", content: [] } },
      assistant("gen-1"),
    ]);
    const result = fixTranscript(path);

    expect(result.patched).toBe(1);
    expect(readFileSync(path, "utf8")).toContain("abc-uuid");
  });

  test("ignores user and other record types", () => {
    const path = transcript([
      { type: "user", message: { role: "user", content: "hello" } },
      { type: "file-history-snapshot", id: "gen-not-a-message" },
      assistant("gen-1"),
    ]);
    const result = fixTranscript(path);

    expect(result.patched).toBe(1);
    expect(readFileSync(path, "utf8")).toContain("gen-not-a-message");
  });

  test("writes a backup before modifying", () => {
    const path = transcript([assistant("gen-1")]);
    const result = fixTranscript(path);

    expect(result.backup).toBeTruthy();
    expect(readFileSync(result.backup!, "utf8")).toContain("gen-1");
  });

  test("dry run reports without writing", () => {
    const path = transcript([assistant("gen-1")]);
    const before = readFileSync(path, "utf8");

    const result = fixTranscript(path, true);

    expect(result.patched).toBe(1);
    expect(result.backup).toBeNull();
    expect(readFileSync(path, "utf8")).toBe(before);
  });

  test("preserves malformed lines instead of dropping them", () => {
    const dir = mkdtempSync(join(tmpdir(), "ccswitch-test-"));
    dirs.push(dir);
    const path = join(dir, "session.jsonl");
    writeFileSync(path, `not json at all\n${JSON.stringify(assistant("gen-1"))}\n`);

    fixTranscript(path);

    const out = readFileSync(path, "utf8");
    expect(out).toContain("not json at all");

    const rec = JSON.parse(out.trim().split("\n")[1]!);
    expect(rec.message.id).toStartWith("msg_");
  });

  test("keeps the line count stable", () => {
    const path = transcript([assistant("gen-1"), assistant("gen-2"), assistant("gen-3")]);
    const before = readFileSync(path, "utf8").trim().split("\n").length;

    fixTranscript(path);

    expect(readFileSync(path, "utf8").trim().split("\n").length).toBe(before);
  });

  test("output stays valid JSONL", () => {
    const path = transcript([assistant("gen-1"), assistant("gen-2")]);
    fixTranscript(path);

    for (const line of readFileSync(path, "utf8").trim().split("\n")) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });
});
