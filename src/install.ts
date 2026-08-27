/**
 * Installs the `/switch` slash command into Claude Code, so the tool is usable
 * from inside a session without dropping to a shell.
 */

import { mkdirSync, writeFileSync } from "node:fs";
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
