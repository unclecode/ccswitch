/**
 * Repair a Claude Code transcript that already contains foreign response ids.
 *
 * The proxy prevents this from happening. This is the rescue path for sessions
 * that were poisoned before ccswitch was in place, or by any other tool that
 * pointed Claude Code at a third-party endpoint directly.
 */

import { existsSync, copyFileSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { isAnthropicId, toMsgId } from "./rewrite";

export interface FixResult {
  path: string;
  patched: number;
  mapping: Record<string, string>;
  backup: string | null;
}

/** Find a transcript by session id across all projects. */
export function findTranscript(sessionId: string): string {
  if (existsSync(sessionId)) return sessionId;

  const projects = join(homedir(), ".claude", "projects");
  const hits: string[] = [];
  if (existsSync(projects)) {
    for (const dir of readdirSync(projects)) {
      const candidate = join(projects, dir, `${sessionId}.jsonl`);
      if (existsSync(candidate)) hits.push(candidate);
    }
  }
  if (hits.length === 1) return hits[0]!;
  if (hits.length === 0) throw new Error(`no transcript found for session '${sessionId}'`);
  throw new Error(`ambiguous session id; matches:\n${hits.join("\n")}`);
}

/**
 * Rewrite every non-`msg_` assistant id to a deterministic `msg_` one.
 *
 * Synthetic entries (Claude Code's own local error/notice lines, model
 * `<synthetic>`) are left alone: Claude Code never selects them as
 * previous_message_id, so rewriting them would be noise.
 */
export function fixTranscript(path: string, dryRun = false): FixResult {
  const lines = readFileSync(path, "utf8").split(/(?<=\n)/);
  const mapping: Record<string, string> = {};
  const out: string[] = [];
  let patched = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      out.push(line);
      continue;
    }
    let rec: any;
    try {
      rec = JSON.parse(trimmed);
    } catch {
      out.push(line);
      continue;
    }

    const msg = rec?.message ?? {};
    const id = msg.id;
    if (
      rec?.type === "assistant" &&
      typeof id === "string" &&
      !isAnthropicId(id) &&
      msg.model !== "<synthetic>"
    ) {
      mapping[id] ??= toMsgId(id);
      msg.id = mapping[id];
      out.push(JSON.stringify(rec) + "\n");
      patched++;
    } else {
      out.push(line);
    }
  }

  let backup: string | null = null;
  if (patched > 0 && !dryRun) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    backup = `${path}.bak-${stamp}`;
    copyFileSync(path, backup);
    writeFileSync(path, out.join(""));
  }

  return { path, patched, mapping, backup };
}
