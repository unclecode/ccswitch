/**
 * ccswitch state and Claude Code settings manipulation.
 *
 * Two files matter:
 *  - ~/.ccswitch.json                    , favorites + last used (global, ours)
 *  - <project>/.claude/settings.local.json, the provider override (per project,
 *                                            Claude Code's own file)
 *
 * The per-project scope is deliberate: switching a project to a cheap model must
 * never drag your other projects or sessions off the Claude subscription.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, copyFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { SEED_FAVORITES } from "./providers";

export const STATE_PATH = join(homedir(), ".ccswitch.json");
export const BACKUP_ROOT = join(homedir(), ".ccswitch-backups");
export const DEFAULT_PORT = 8787;

/** Env keys ccswitch owns. Everything else in `env` is left untouched. */
export const OVERRIDE_KEYS = [
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_MODEL",
  "ANTHROPIC_DEFAULT_SONNET_MODEL",
  "ANTHROPIC_DEFAULT_OPUS_MODEL",
  "ANTHROPIC_DEFAULT_HAIKU_MODEL",
  "ANTHROPIC_SMALL_FAST_MODEL",
] as const;

/** Model slots, all pointed at the chosen model so any slot resolves correctly. */
const MODEL_KEYS = OVERRIDE_KEYS.slice(3);

export interface Favorite {
  provider: string;
  id: string;
  note?: string;
}

export interface State {
  favorites: Favorite[];
  last: { provider: string; model: string } | null;
  port: number;
}

export function loadState(): State {
  if (!existsSync(STATE_PATH)) {
    return { favorites: [...SEED_FAVORITES], last: null, port: DEFAULT_PORT };
  }
  try {
    const raw = JSON.parse(readFileSync(STATE_PATH, "utf8"));
    return {
      favorites: Array.isArray(raw.favorites) ? raw.favorites : [...SEED_FAVORITES],
      last: raw.last ?? null,
      port: typeof raw.port === "number" ? raw.port : DEFAULT_PORT,
    };
  } catch {
    return { favorites: [...SEED_FAVORITES], last: null, port: DEFAULT_PORT };
  }
}

export function saveState(state: State): void {
  writeAtomic(STATE_PATH, JSON.stringify(state, null, 2) + "\n");
}

/** Nearest ancestor containing `.claude`, else the cwd. */
export function projectRoot(from: string = process.cwd()): string {
  let dir = resolve(from);
  while (true) {
    if (existsSync(join(dir, ".claude"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return resolve(from);
    dir = parent;
  }
}

export function settingsPath(root: string = projectRoot()): string {
  return join(root, ".claude", "settings.local.json");
}

export function readJson(path: string): any {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf8") || "{}");
  } catch {
    return {};
  }
}

function writeAtomic(path: string, contents: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = path + ".tmp";
  writeFileSync(tmp, contents);
  renameSync(tmp, path);
}

export function writeJson(path: string, data: any): void {
  writeAtomic(path, JSON.stringify(data, null, 2) + "\n");
}

/** Timestamped copy under ~/.ccswitch-backups/<project-slug>/. Returns its path. */
export function backupSettings(path: string, root: string = projectRoot()): string | null {
  if (!existsSync(path)) return null;
  const slug = root.replace(/^\//, "").replace(/\//g, "-");
  const dir = join(BACKUP_ROOT, slug);
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const dest = join(dir, `settings.local.json.bak-${stamp}`);
  copyFileSync(path, dest);
  return dest;
}

export interface ApplyOptions {
  baseUrl: string;
  token: string;
  model: string;
  root?: string;
}

/** Point a project at a third-party endpoint. */
export function applyProvider(opts: ApplyOptions): { path: string; backup: string | null } {
  const root = opts.root ?? projectRoot();
  const path = settingsPath(root);
  const backup = backupSettings(path, root);
  const data = readJson(path);
  const env = (data.env ??= {});

  env.ANTHROPIC_BASE_URL = opts.baseUrl;
  env.ANTHROPIC_AUTH_TOKEN = opts.token;
  // Empty (not absent) so a stray ANTHROPIC_API_KEY in the shell can never cause
  // silent fallback to Anthropic API billing while you are on another provider.
  env.ANTHROPIC_API_KEY = "";
  for (const key of MODEL_KEYS) env[key] = opts.model;

  writeJson(path, data);
  return { path, backup };
}

/**
 * Return a project to the Claude subscription.
 *
 * Default is overwrite-with-empty rather than delete: a *running* Claude Code
 * session picks up changed values from settings, but never un-applies keys that
 * simply vanish. `clean: true` removes them outright, for when no session is live.
 */
export function applyAnthropic(clean = false, root: string = projectRoot()): {
  path: string;
  backup: string | null;
  existed: boolean;
} {
  const path = settingsPath(root);
  const existed = existsSync(path);
  if (!existed) return { path, backup: null, existed };

  const backup = backupSettings(path, root);
  const data = readJson(path);
  const env = (data.env ??= {});

  if (clean) {
    for (const key of OVERRIDE_KEYS) delete env[key];
    if (Object.keys(env).length === 0) delete data.env;
  } else {
    env.ANTHROPIC_BASE_URL = "https://api.anthropic.com";
    env.ANTHROPIC_AUTH_TOKEN = "";
    env.ANTHROPIC_API_KEY = "";
    for (const key of MODEL_KEYS) env[key] = "";
  }

  writeJson(path, data);
  return { path, backup, existed };
}

export type Status =
  | { mode: "anthropic"; leftovers: boolean }
  | { mode: "third-party"; baseUrl: string; model: string; viaProxy: boolean };

export function readStatus(root: string = projectRoot()): Status {
  const env = readJson(settingsPath(root)).env ?? {};
  const baseUrl: string = env.ANTHROPIC_BASE_URL ?? "";
  const isLocal = /^http:\/\/127\.0\.0\.1:\d+/.test(baseUrl);
  const isAnthropic = baseUrl === "" || baseUrl.includes("api.anthropic.com");

  if (isAnthropic) {
    const leftovers = OVERRIDE_KEYS.some((k) => k in env);
    return { mode: "anthropic", leftovers };
  }
  return {
    mode: "third-party",
    baseUrl,
    model: env.ANTHROPIC_MODEL || "(no model set)",
    viaProxy: isLocal,
  };
}

/** Claude Code's transcript directory for a project path. */
export function transcriptDir(root: string = projectRoot()): string {
  const slug = root.replace(/\//g, "-");
  return join(homedir(), ".claude", "projects", slug);
}

/** Most recently modified transcript in a project, if any. */
export function newestTranscript(root: string = projectRoot()): string | null {
  const dir = transcriptDir(root);
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".jsonl"))
    .map((f) => join(dir, f));
  if (files.length === 0) return null;
  return files
    .map((f) => ({ f, m: Bun.file(f).lastModified }))
    .sort((a, b) => b.m - a.m)[0]!.f;
}
