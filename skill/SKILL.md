---
name: ccswitch
description: Install, configure, or use ccswitch. Switches Claude Code between the user's Claude subscription and third-party models (OpenRouter, Groq) per project, mid-session, in both directions. Use when the user wants to run Claude Code on a cheaper or different model, mentions OpenRouter/Groq with Claude Code, asks to switch providers or save on usage, or hits the `diagnostics.previous_message_id` 400 error.
---

# ccswitch

A CLI that switches a single project between the user's Claude subscription and any Anthropic-compatible provider, without breaking the running session.

## Install it

```bash
bun install -g ccswitch    # requires Bun: curl -fsSL https://bun.sh/install | bash
ccswitch install           # keys check, /switch command, auto-restart hook
```

Then make sure a provider key is exported in the user's shell profile, so Claude Code inherits it:

- OpenRouter: `export OPENROUTER_API_KEY=...`, keys at https://openrouter.ai/keys
- Groq: `export GROQ_API_KEY=...`, keys at https://console.groq.com/keys

Never print, echo, or write these keys anywhere. ccswitch reads them from the environment itself.

## Use it

```bash
ccswitch                                       # interactive picker
ccswitch use z-ai/glm-5.3-flash                # switch this project
ccswitch use groq:moonshotai/kimi-k2-instruct  # provider-prefixed
ccswitch back                                  # back to the Claude subscription
ccswitch back --clean                          # also remove the empty override keys
ccswitch status                                # what this project is using
ccswitch list / add / remove                   # manage favorite models
ccswitch fix [session-id] [--dry-run]          # repair an already-poisoned transcript
ccswitch heal                                  # restart this project's proxy if it stopped
```

Day to day the user should only need `/switch` inside Claude Code. The proxy starts on
demand and a SessionStart hook restarts it after a reboot, so there is no service to run.

**After switching to another provider, always tell the user to run `/model` and select that
model.** Otherwise the session keeps using its previous model at the new provider's price -
which can be far more expensive than intended.

Switching back needs no restart and no repair: keep working in the same session.

## What it changes

Only `<project>/.claude/settings.local.json` (the `env` block) plus ccswitch's own state in
`~/.ccswitch.json`. Other projects and sessions are unaffected. Every change is backed up to
`~/.ccswitch-backups/<project>/`. Claude credentials are never touched.

## Why it exists

Claude Code sends `diagnostics.previous_message_id` on each request; Anthropic requires it to
start with `msg_`. Third-party endpoints return their own id formats (OpenRouter: `gen-…`),
Claude Code persists them into the session transcript, and switching back then fails with a
permanent 400, surviving restarts, since the id is re-read from the transcript.

ccswitch runs a local proxy (127.0.0.1) that rewrites ids to `msg_` form before they are
written, so the problem cannot occur. `ccswitch fix` repairs transcripts damaged before
ccswitch was in use.

If the user reports that 400 error, `ccswitch fix` on that session id is the remedy.

## Troubleshooting

- **`<PROVIDER>_API_KEY is not set`**, the key must be exported in the shell that launched
  Claude Code, not only in the current one.
- **`proxy unavailable` warning**, Bun is missing or every port in range is taken. Check
  `~/.ccswitch.log`. Switching still works, but switching back will then need `ccswitch fix`.
- **Connection refused in a switched project**, the proxy is not running (e.g. after a
  reboot without the hook installed). Run `ccswitch heal`.
- **Model not found upstream**, verify the exact model id on the provider's models page; ids
  must match exactly (e.g. `z-ai/glm-5.3-flash`).
- **Tool calls misbehaving on a cheap model**, not all models handle Claude Code's tool
  calling well. Suggest a known-good one rather than debugging the model.
