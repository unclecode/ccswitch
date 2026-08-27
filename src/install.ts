/**
 * Installs the `/switch` slash command into Claude Code, so the tool is usable
 * from inside a session without dropping to a shell.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export function slashCommandPath(): string {
  return join(homedir(), ".claude", "commands", "switch.md");
}

const COMMAND_BODY = `---
description: Switch this project between your Claude subscription and another provider
argument-hint: "[model-id | back]   (no args = show favorites)"
---

Use the \`ccswitch\` CLI to change which provider serves THIS project. It edits only
this project's \`.claude/settings.local.json\`, so other projects and sessions are
never affected.

Arguments given: "$ARGUMENTS"

## Rules

- Never print or log the user's API keys. \`ccswitch\` reads them from the environment.
- If a command fails, report the error and stop rather than improvising.

## What to do

1. If the arguments are \`back\`, \`max\`, or \`anthropic\` → run \`ccswitch back\`, then
   \`ccswitch status\`. Tell the user they can keep working in this same session — no
   restart and no repair step is needed, because ccswitch's proxy keeps the transcript
   valid. Mention \`ccswitch back --clean\` as an optional later tidy-up when no session
   is running in this project.

2. If the arguments name a model (they contain \`/\` or \`:\`) → run
   \`ccswitch use <model>\`, then \`ccswitch status\`.

3. If there are no arguments → run \`ccswitch list\`, then use the AskUserQuestion tool
   to offer each favorite (label = model id, description = its note; put the one marked
   "← last used" first, labeled "(Recommended)") plus an option to switch back to the
   Claude subscription. Then act on the choice as above.

After switching to another provider, always remind the user to run \`/model\` and select
that model — otherwise the session keeps using its current model at the new provider's
price.
`;

export function installSlashCommand(): string {
  const path = slashCommandPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, COMMAND_BODY);
  return path;
}

// ── SessionStart hook ────────────────────────────────────────────────────────

/**
 * The hook keeps the proxy invisible. A project pinned to a proxy port has no
 * proxy there after a reboot, and every request in it would fail; running
 * `ccswitch heal` when a session starts repairs that before the user notices.
 *
 * It is a no-op for projects on the Claude subscription, exits non-blocking, and
 * never prints on the happy path.
 */
export const HOOK_COMMAND = "ccswitch heal --quiet";

export function settingsJsonPath(): string {
  return join(homedir(), ".claude", "settings.json");
}

function readSettings(path: string): any {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf8") || "{}");
  } catch {
    return {};
  }
}

/** True if our hook is already registered. */
export function hookInstalled(settings: any = readSettings(settingsJsonPath())): boolean {
  const entries = settings?.hooks?.SessionStart;
  if (!Array.isArray(entries)) return false;
  return entries.some((entry: any) =>
    (entry?.hooks ?? []).some((h: any) => typeof h?.command === "string" && h.command.includes("ccswitch heal")),
  );
}

/**
 * Add the SessionStart hook, preserving every other setting and any hooks the
 * user already has. Returns false if it was already present.
 */
export function installHook(): boolean {
  const path = settingsJsonPath();
  const settings = readSettings(path);
  if (hookInstalled(settings)) return false;

  settings.hooks ??= {};
  settings.hooks.SessionStart ??= [];
  settings.hooks.SessionStart.push({
    hooks: [{ type: "command", command: HOOK_COMMAND }],
  });

  mkdirSync(dirname(path), { recursive: true });
  if (existsSync(path)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    writeFileSync(`${path}.ccswitch-bak-${stamp}`, readFileSync(path));
  }
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(settings, null, 2) + "\n");
  renameSync(tmp, path);
  return true;
}

/** Remove the hook again. Returns false if it was not there. */
export function uninstallHook(): boolean {
  const path = settingsJsonPath();
  const settings = readSettings(path);
  if (!hookInstalled(settings)) return false;

  settings.hooks.SessionStart = settings.hooks.SessionStart
    .map((entry: any) => ({
      ...entry,
      hooks: (entry.hooks ?? []).filter(
        (h: any) => !(typeof h?.command === "string" && h.command.includes("ccswitch heal")),
      ),
    }))
    .filter((entry: any) => (entry.hooks ?? []).length > 0);

  if (settings.hooks.SessionStart.length === 0) delete settings.hooks.SessionStart;
  if (Object.keys(settings.hooks).length === 0) delete settings.hooks;

  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(settings, null, 2) + "\n");
  renameSync(tmp, path);
  return true;
}
