#!/usr/bin/env bun
/**
 * ccswitch, switch a project between your Claude subscription and any
 * Anthropic-compatible provider, mid-session, in both directions.
 *
 * Author: unclecode (https://github.com/unclecode)
 */

import { spawn } from "node:child_process";
import { existsSync, openSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  applyAnthropic,
  applyProvider,
  loadState,
  newestTranscript,
  projectRoot,
  readStatus,
  saveState,
  type Favorite,
  type State,
} from "./config";
import { findTranscript, fixTranscript } from "./fix";
import { PROVIDERS, getProvider, parseModelRef } from "./providers";
import { proxyHealthy, proxyInfo } from "./proxy";
import { hookInstalled, installHook, installSlashCommand, slashCommandPath, uninstallHook } from "./install";
import { heal } from "./heal";

const VERSION = "0.1.2";
const LOG_PATH = join(homedir(), ".ccswitch.log");

// ── tiny terminal helpers ────────────────────────────────────────────────────
const tty = process.stdout.isTTY;
const c = {
  dim: (s: string) => (tty ? `\x1b[2m${s}\x1b[0m` : s),
  bold: (s: string) => (tty ? `\x1b[1m${s}\x1b[0m` : s),
  green: (s: string) => (tty ? `\x1b[32m${s}\x1b[0m` : s),
  yellow: (s: string) => (tty ? `\x1b[33m${s}\x1b[0m` : s),
  red: (s: string) => (tty ? `\x1b[31m${s}\x1b[0m` : s),
  cyan: (s: string) => (tty ? `\x1b[36m${s}\x1b[0m` : s),
};

function die(msg: string): never {
  console.error(c.red("error: ") + msg);
  process.exit(1);
}

async function prompt(question: string): Promise<string> {
  process.stdout.write(question);
  for await (const line of console) return line.trim();
  return "";
}

async function confirm(question: string, defaultYes = true): Promise<boolean> {
  if (!tty) return defaultYes;
  const hint = defaultYes ? "[Y/n]" : "[y/N]";
  const answer = (await prompt(`${question} ${hint} `)).toLowerCase();
  if (!answer) return defaultYes;
  return answer.startsWith("y");
}

// ── proxy lifecycle ──────────────────────────────────────────────────────────

/** How many consecutive ports to try before giving up. */
const PORT_SCAN_RANGE = 20;

/**
 * Ensure a ccswitch proxy for `upstream` is running, and return the port it is on.
 *
 * Ports can be occupied by an unrelated process, or by a ccswitch proxy pointed at a
 * *different* provider, so we probe upward from the preferred port until we find our
 * own proxy for this upstream or a port we can claim.
 */
async function ensureProxy(
  preferredPort: number,
  upstream: string,
): Promise<number | null> {
  for (let port = preferredPort; port < preferredPort + PORT_SCAN_RANGE; port++) {
    const info = await proxyInfo(port);

    if (info) {
      // Ours already, reuse it only if it targets the same provider.
      if (info.upstream.replace(/\/$/, "") === upstream.replace(/\/$/, "")) return port;
      continue; // ours, but for another provider: leave it alone
    }

    if (!(await portFree(port))) continue; // someone else holds it

    // `import.meta.resolve` returns an object, not a string, on Bun below 1.1,
  // so build the path from the module directory instead.
  const entry = join(import.meta.dir, "proxy-server.ts");
    const fd = openSync(LOG_PATH, "a");
    const child = spawn(
      process.execPath,
      [entry, "--port", String(port), "--upstream", upstream],
      { detached: true, stdio: ["ignore", fd, fd] },
    );
    child.unref();

    for (let i = 0; i < 50; i++) {
      await Bun.sleep(100);
      if (await proxyHealthy(port)) return port;
    }
  }
  return null;
}

/** Can we bind this port right now? */
async function portFree(port: number): Promise<boolean> {
  try {
    const probe = Bun.serve({ port, hostname: "127.0.0.1", fetch: () => new Response("") });
    probe.stop(true);
    return true;
  } catch {
    return false;
  }
}

// ── commands ─────────────────────────────────────────────────────────────────

async function cmdUse(ref: string | undefined, state: State): Promise<void> {
  let provider: string;
  let model: string;

  if (ref) {
    ({ provider, model } = parseModelRef(ref, state.last?.provider));
  } else if (state.last) {
    ({ provider, model } = state.last);
  } else {
    die("no model given and none remembered. Try: ccswitch (picker) or ccswitch use <model>");
  }

  const p = getProvider(provider);
  const token = process.env[p.keyEnv];
  if (!token) {
    die(
      `${p.keyEnv} is not set.\n` +
        `  Get a key: ${p.keysUrl}\n` +
        `  Then:      export ${p.keyEnv}=...   (in the shell you launch Claude Code from)`,
    );
  }

  const proxyPort = await ensureProxy(state.port, p.baseUrl);
  const viaProxy = proxyPort !== null;
  const baseUrl = viaProxy ? `http://127.0.0.1:${proxyPort}` : p.baseUrl;
  if (viaProxy && proxyPort !== state.port) state.port = proxyPort;

  // Note whether this switch creates the project folder, so the user is told.
  const root = projectRoot();
  const isNewProject = !existsSync(join(root, ".claude"));

  const { backup } = applyProvider({ baseUrl, token, model });

  state.last = { provider, model };
  saveState(state);

  console.log(`${c.green("→")} ${c.bold(model)} ${c.dim(`(${p.label})`)}`);
  console.log(`  ${c.dim("project:")} ${root}${isNewProject ? c.dim("  (created .claude here)") : ""}`);
  if (viaProxy) {
    console.log(`  ${c.dim("route:  ")} ${baseUrl} ${c.green("· id-rewriting proxy on")}`);
  } else {
    console.log(`  ${c.dim("route:  ")} ${baseUrl} ${c.yellow("· proxy unavailable")}`);
    console.log(
      c.yellow(`  warning: without the proxy, switching back may wedge this session.`) +
        `\n  ${c.dim(`See ${LOG_PATH}. Recover with: ccswitch fix`)}`,
    );
  }
  if (backup) console.log(`  ${c.dim("backup: ")} ${backup}`);
  console.log();
  console.log(`  ${c.bold("Next:")} run ${c.cyan("/model")} in Claude Code and pick ${c.bold(model)}`);
  console.log(`  ${c.dim("otherwise the session keeps using its current model at that provider's price")}`);
}

function cmdBack(state: State, clean: boolean): void {
  const { backup, existed } = applyAnthropic(clean);
  if (!existed) {
    console.log(`${c.green("→")} already on your Claude subscription ${c.dim("(no project override)")}`);
    return;
  }
  console.log(`${c.green("→")} ${c.bold("Claude subscription")}`);
  console.log(`  ${c.dim("project:")} ${projectRoot()}`);
  if (backup) console.log(`  ${c.dim("backup: ")} ${backup}`);
  console.log();
  console.log(`  ${c.dim("Keep working in the same session, no restart, no repair needed.")}`);
}

async function cmdStatus(state: State): Promise<void> {
  const status = readStatus();
  console.log(`${c.dim("project:")} ${projectRoot()}`);

  if (status.mode === "anthropic") {
    console.log(`${c.dim("using:  ")} ${c.bold("Claude subscription")}`);
    if (status.leftovers) {
      console.log(c.dim("        (empty override keys remain; `ccswitch back --clean` removes them)"));
    }
  } else {
    console.log(`${c.dim("using:  ")} ${c.bold(status.model)}`);
    console.log(`${c.dim("route:  ")} ${status.baseUrl}`);
    if (status.viaProxy) {
      const port = Number(new URL(status.baseUrl).port);
      const up = await proxyHealthy(port);
      console.log(
        `${c.dim("proxy:  ")} ` +
          (up ? c.green("running") : c.red("NOT RUNNING, re-run `ccswitch use` to restart it")),
      );
    }
  }
}

function printFavorites(state: State): void {
  if (state.favorites.length === 0) {
    console.log(c.dim("no favorites yet, add one with: ccswitch add <provider>:<model> [note]"));
    return;
  }
  const width = Math.max(...state.favorites.map((f) => f.id.length));
  for (const f of state.favorites) {
    const isLast = state.last?.model === f.id && state.last?.provider === f.provider;
    const marker = isLast ? c.green(" ←") : "";
    const label = PROVIDERS[f.provider]?.label ?? f.provider;
    console.log(
      `  ${c.bold(f.id.padEnd(width))}  ${c.dim(`[${label}]`)} ${c.dim(f.note ?? "")}${marker}`,
    );
  }
}

async function cmdPick(state: State): Promise<void> {
  const status = readStatus();
  console.log(c.bold("ccswitch") + c.dim(` · ${projectRoot()}`));
  console.log(
    c.dim("currently: ") +
      (status.mode === "anthropic" ? "Claude subscription" : status.model),
  );
  console.log();

  const items = state.favorites;
  items.forEach((f, i) => {
    const isLast = state.last?.model === f.id && state.last?.provider === f.provider;
    const label = PROVIDERS[f.provider]?.label ?? f.provider;
    console.log(
      `  ${c.bold(String(i + 1))}. ${f.id} ${c.dim(`[${label}]`)}` +
        (isLast ? c.green("  ← last used") : ""),
    );
    if (f.note) console.log(`     ${c.dim(f.note)}`);
  });
  console.log(`  ${c.bold("0")}. ${c.cyan("Claude subscription")} ${c.dim("(switch back)")}`);
  console.log();

  const answer = await prompt("choose: ");
  if (!answer) return;

  if (answer === "0") {
    cmdBack(state, false);
    return;
  }
  const index = Number(answer) - 1;
  if (!Number.isInteger(index) || index < 0 || index >= items.length) {
    die(`'${answer}' is not one of the choices`);
  }
  const chosen = items[index]!;
  await cmdUse(`${chosen.provider}:${chosen.id}`, state);
}

function cmdAdd(ref: string | undefined, note: string, state: State): void {
  if (!ref) die("usage: ccswitch add <provider>:<model> [note]");
  const { provider, model } = parseModelRef(ref, state.last?.provider);
  getProvider(provider); // validates

  const existing = state.favorites.findIndex(
    (f) => f.id === model && f.provider === provider,
  );
  const entry: Favorite = { provider, id: model, ...(note ? { note } : {}) };
  if (existing >= 0) state.favorites[existing] = entry;
  else state.favorites.push(entry);

  saveState(state);
  console.log(`${c.green("added")} ${c.bold(model)} ${c.dim(`[${getProvider(provider).label}]`)}`);
}

function cmdRemove(ref: string | undefined, state: State): void {
  if (!ref) die("usage: ccswitch remove <model>");

  // An unprefixed id should remove the obvious match regardless of provider -
  // requiring the prefix only to delete something is needless friction.
  const explicit = ref.includes(":");
  const { provider, model } = parseModelRef(ref, state.last?.provider);

  const matches = state.favorites.filter((f) =>
    explicit ? f.id === model && f.provider === provider : f.id === model,
  );

  if (matches.length === 0) die(`'${model}' is not in your favorites`);
  if (matches.length > 1) {
    const options = matches.map((f) => `${f.provider}:${f.id}`).join(", ");
    die(`'${model}' matches several favorites, be specific: ${options}`);
  }

  const target = matches[0]!;
  state.favorites = state.favorites.filter((f) => f !== target);
  saveState(state);
  console.log(`${c.green("removed")} ${target.id} ${c.dim(`[${target.provider}]`)}`);
}

function cmdFix(sessionId: string | undefined, dryRun: boolean): void {
  let path: string;
  if (sessionId) {
    try {
      path = findTranscript(sessionId);
    } catch (err: any) {
      die(err.message);
    }
  } else {
    const newest = newestTranscript();
    if (!newest) die("no transcript found for this project; pass a session id explicitly");
    path = newest;
    console.log(c.dim(`using newest transcript: ${path}`));
  }

  const result = fixTranscript(path, dryRun);
  if (result.patched === 0) {
    console.log(`${c.green("clean")}, no foreign ids in this transcript`);
    return;
  }
  console.log(
    `${result.patched} entries across ${Object.keys(result.mapping).length} distinct ids`,
  );
  for (const [from, to] of Object.entries(result.mapping)) {
    console.log(`  ${c.dim(from)} → ${to}`);
  }
  if (dryRun) {
    console.log(c.yellow("dry run, nothing written"));
  } else {
    console.log(`${c.dim("backup:")} ${result.backup}`);
    console.log(c.green("patched") + ", resume the session and it will work");
  }
}

function cmdProviders(): void {
  for (const p of Object.values(PROVIDERS)) {
    const has = Boolean(process.env[p.keyEnv]);
    console.log(
      `  ${c.bold(p.id.padEnd(12))} ${p.label.padEnd(12)} ` +
        (has ? c.green(`${p.keyEnv} set`) : c.dim(`${p.keyEnv} missing`)),
    );
    console.log(`  ${" ".repeat(12)} ${c.dim(p.modelsUrl)}`);
  }
}

async function cmdInstall(state: State): Promise<void> {
  console.log(c.bold("ccswitch setup"));
  console.log();

  // 1. Provider keys
  const configured = Object.values(PROVIDERS).filter((p) => process.env[p.keyEnv]);
  if (configured.length === 0) {
    console.log(c.yellow("No provider API keys found in your environment."));
    for (const p of Object.values(PROVIDERS)) {
      console.log(`  ${p.label}: export ${p.keyEnv}=...   ${c.dim(p.keysUrl)}`);
    }
    console.log(c.dim("  Add one to your shell profile, then re-run this."));
  } else {
    for (const p of configured) {
      console.log(`  ${c.green("✓")} ${p.label} ${c.dim(`(${p.keyEnv} set)`)}`);
    }
  }
  console.log();

  // 2. Slash command, default yes
  if (await confirm("Add the /switch slash command to Claude Code?", true)) {
    installSlashCommand();
    console.log(`  ${c.green("✓")} ${slashCommandPath()}`);
    console.log(`  ${c.dim("use it inside Claude Code as: /switch")}`);
  } else {
    console.log(c.dim("  skipped, add it later with: ccswitch install-command"));
  }
  console.log();

  // 3. Self-healing hook, default yes
  if (hookInstalled()) {
    console.log(`  ${c.green("✓")} auto-restart hook already installed`);
  } else if (
    await confirm("Auto-restart the proxy when a session opens? (recommended)", true)
  ) {
    installHook();
    console.log(`  ${c.green("✓")} SessionStart hook added to ~/.claude/settings.json`);
    console.log(`  ${c.dim("keeps switched projects working after a reboot, with nothing to run")}`);
  } else {
    console.log(c.dim("  skipped, after a reboot, run `ccswitch heal` in a switched project"));
  }
  console.log();

  console.log(`${c.bold("Ready.")} Try: ${c.cyan("ccswitch")} ${c.dim("(picker)")} or ${c.cyan("ccswitch status")}`);
  saveState(state);
}

async function cmdHeal(quiet: boolean): Promise<void> {
  const result = await heal();

  if (quiet) {
    // Runs from the SessionStart hook: silent unless it actually did something,
    // and never non-zero, so a problem here can never block a session starting.
    if (result.action === "healed") {
      console.log(
        `ccswitch: restarted the ${result.model} proxy on port ${result.port}` +
          (result.changedPort ? " (port changed; project settings updated)" : ""),
      );
    }
    return;
  }

  switch (result.action) {
    case "not-needed":
      console.log(`${c.green("ok")} ${c.dim(result.reason)}`);
      break;
    case "healed":
      console.log(`${c.green("healed")} proxy for ${c.bold(result.model)} on port ${result.port}`);
      if (result.changedPort) console.log(c.dim("  port was taken; project settings updated"));
      break;
    case "failed":
      console.log(`${c.red("failed")} ${result.reason}`);
      break;
  }
}

function usage(): void {
  console.log(`${c.bold("ccswitch")} ${c.dim(`v${VERSION}`)}, switch Claude Code between your subscription and any provider

${c.bold("USAGE")}
  ccswitch                       interactive picker
  ccswitch use <model>           switch this project to a model
  ccswitch back [--clean]        switch back to your Claude subscription
  ccswitch status                what this project is using
  ccswitch list                  your favorite models
  ccswitch add <model> [note]    add a favorite
  ccswitch remove <model>        remove a favorite
  ccswitch fix [session-id]      repair a transcript poisoned before ccswitch
  ccswitch providers             supported providers and key status
  ccswitch install                first-run setup (keys, /switch command, auto-restart)
  ccswitch install-command       add the /switch slash command only
  ccswitch heal                  restart this project's proxy if it stopped
  ccswitch uninstall-hook        remove the auto-restart hook

${c.bold("MODELS")}
  Prefix with a provider, or omit it to use the last one:
    ccswitch use z-ai/glm-5.3-flash
    ccswitch use groq:moonshotai/kimi-k2-instruct

${c.bold("NOTES")}
  Changes apply to the current project only (.claude/settings.local.json).
  Switching works mid-session, both directions, no restart.

${c.dim("by unclecode · https://github.com/unclecode/ccswitch")}`);
}

// ── entry ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const flags = new Set(argv.filter((a) => a.startsWith("--")));
  const args = argv.filter((a) => !a.startsWith("--"));
  const [command, ...rest] = args;
  const state = loadState();

  switch (command) {
    case undefined:
      await cmdPick(state);
      break;
    case "use":
      await cmdUse(rest[0], state);
      break;
    case "back":
    case "max":
      cmdBack(state, flags.has("--clean"));
      break;
    case "status":
      await cmdStatus(state);
      break;
    case "list":
    case "favorites":
      printFavorites(state);
      break;
    case "add":
      cmdAdd(rest[0], rest.slice(1).join(" "), state);
      break;
    case "remove":
    case "rm":
      cmdRemove(rest[0], state);
      break;
    case "fix":
      cmdFix(rest[0], flags.has("--dry-run"));
      break;
    case "providers":
      cmdProviders();
      break;
    case "heal":
      await cmdHeal(flags.has("--quiet"));
      break;
    case "install":
    case "setup":
      await cmdInstall(state);
      break;
    case "uninstall-hook":
      console.log(uninstallHook() ? c.green("hook removed") : c.dim("hook was not installed"));
      break;
    case "install-command":
      installSlashCommand();
      console.log(`${c.green("installed")} ${slashCommandPath()}`);
      break;
    case "version":
    case "--version":
      console.log(VERSION);
      break;
    case "help":
      usage();
      break;
    default:
      // Bare model reference: `ccswitch z-ai/glm-5.3-flash`
      if (command.includes("/") || command.includes(":")) {
        await cmdUse(command, state);
      } else {
        console.error(c.red(`unknown command '${command}'`));
        console.log();
        usage();
        process.exit(1);
      }
  }
}

main().catch((err) => die(err?.message ?? String(err)));
