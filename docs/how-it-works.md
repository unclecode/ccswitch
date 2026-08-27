# How it works

## The problem

Claude Code lets you point it at any Anthropic compatible endpoint by setting `ANTHROPIC_BASE_URL`, so running it against OpenRouter or Groq models looks easy. It is, until you switch back.

Then every message fails, permanently:

```
API Error: 400 diagnostics.previous_message_id: must be the `id` from a prior
/v1/messages response (starts with `msg_`)
```

Exiting does not help. Resuming does not help. The session is dead.

### Why

Claude Code uses Anthropic's cache diagnosis beta. On every request it sends the previous response's `id` in a `diagnostics.previous_message_id` field, and the Anthropic API rejects any value that does not start with `msg_`.

Third party endpoints return their own ID formats. OpenRouter returns `gen-...`. Claude Code stores whatever it receives in the session transcript on disk. So once you switch that project back to your subscription, the next request carries a foreign ID and gets rejected.

The reason restarting does not save you is that the ID is read back from the transcript file on every resume. It is not stuck in memory, it is written down.

This is a known issue. It was [closed upstream as "not planned"](https://github.com/anthropics/claude-code/issues/59520), with "exit and lose your session" as the only documented answer.

## The fix

```
Claude Code  ──►  127.0.0.1:8787  ──►  OpenRouter / Groq
                  (ccswitch proxy)
                   gen-abc123  ──►  msg_01px...
                   strips the Anthropic only `diagnostics` field from requests
```

The proxy normalises response IDs before they ever reach your transcript, so nothing invalid is written down and there is nothing to break. It also drops the `diagnostics` field on the way out, since third party endpoints have no use for it. That removes the failure at the source rather than patching it afterwards.

### Why rewriting IDs is safe

IDs are mapped deterministically, `sha1(original)` becomes `msg_01px...`, so the same upstream ID always produces the same value across retries and reconnects. The field is used only for prompt cache diagnostics and never affects your conversation. The original upstream ID is still preserved in the transcript's `requestId`.

## Design notes

**Per project.** Only `<project>/.claude/settings.local.json` is touched. Your other projects and sessions stay on your subscription.

**Both directions, live.** Claude Code re-reads its settings mid session, so a switch applies to your very next message. No restart.

**The proxy is local.** It binds to `127.0.0.1` only. Your API key passes through in the Authorization header exactly as Claude Code sent it, and is never logged, stored, or inspected.

**Self healing.** A project pins an exact proxy port, and that port is empty after a reboot. A `SessionStart` hook runs `ccswitch heal`, which restarts the proxy, or repoints the project if the port has since been taken. It is a silent no-op for projects on your subscription. Remove it any time with `ccswitch uninstall-hook`.

**Never silently degraded.** If Bun is missing or no port is free, ccswitch tells you plainly that it is running without the proxy, and warns that switching back will then need `ccswitch fix`.

**`ANTHROPIC_API_KEY` is blanked** while you are on another provider, so a stray key sitting in your environment cannot cause surprise Anthropic API billing.

**Everything is backed up.** Every settings change is copied to `~/.ccswitch-backups/<project>/` with a timestamp first.

## Files it touches

| Path | What |
|---|---|
| `<project>/.claude/settings.local.json` | the provider override, per project |
| `~/.ccswitch.json` | favorites, last used model, proxy port |
| `~/.ccswitch-backups/` | timestamped settings backups |
| `~/.ccswitch.log` | proxy log |
| `~/.claude/commands/switch.md` | the `/switch` command, opt in |
| `~/.claude/settings.json` | one `SessionStart` hook, opt in, backed up first |

Nothing else. Your Claude credentials are never read or modified.
