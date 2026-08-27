# ccswitch

**Use Claude Code with your Max subscription *and* any OpenRouter or Groq model — switching per project, mid-session, in both directions, without breaking your session.**

```bash
ccswitch use z-ai/glm-5.3-flash   # cheap model for the grind
ccswitch back                     # back to your subscription, keep typing
```

No restart. No lost context. No wedged sessions.

---

## The problem this solves

Claude Code lets you point it at any Anthropic-compatible endpoint with `ANTHROPIC_BASE_URL`, so running it on OpenRouter or Groq models looks easy. It is — until you switch back.

Then every message fails, permanently:

```
API Error: 400 diagnostics.previous_message_id: must be the `id` from a prior
/v1/messages response (starts with `msg_`)
```

Exiting doesn't help. Resuming doesn't help. The session is dead.

**Why:** Claude Code uses Anthropic's cache-diagnosis beta, sending the previous response's `id` on every request. Anthropic requires `msg_...`; OpenRouter returns `gen-...`. Claude Code writes whatever it receives into the session transcript, so once you switch back, it keeps replaying a foreign id that the API rejects — and it re-reads that id from disk on every resume.

This is a known issue, [closed upstream as "not planned"](https://github.com/anthropics/claude-code/issues/59520), with "exit and lose your session" as the only documented answer.

**The fix:** ccswitch runs a tiny local proxy that normalises response ids before they ever reach your transcript. Nothing invalid gets persisted, so there is nothing to break.

---

## Install

```bash
bun install -g ccswitch
ccswitch install
```

`ccswitch install` checks your provider keys and offers to add the `/switch` slash command (default yes).

Requires [Bun](https://bun.sh) (`curl -fsSL https://bun.sh/install | bash`).

<details>
<summary>Or point your coding agent at it</summary>

Paste this to Claude Code, Cursor, or any coding agent:

> Install ccswitch from https://github.com/unclecode/ccswitch, run `ccswitch install`, and set up an OpenRouter key for me.

The repo ships an agent skill in [`skill/`](skill/) that agents can follow directly.
</details>

### Get a provider key

```bash
export OPENROUTER_API_KEY=...   # https://openrouter.ai/keys
export GROQ_API_KEY=...         # https://console.groq.com/keys
```

Put it in your shell profile so Claude Code inherits it.

---

## Use

```bash
ccswitch                              # interactive picker
ccswitch use z-ai/glm-5.3-flash       # switch this project to a model
ccswitch use groq:moonshotai/kimi-k2-instruct
ccswitch back                         # back to your Claude subscription
ccswitch status                       # what is this project using?
```

Inside Claude Code, `/switch` does the same thing without leaving the session.

After switching, run `/model` and pick the model you switched to — otherwise the session keeps using its previous model at the new provider's prices.

### Favorites

```bash
ccswitch list
ccswitch add groq:llama-3.3-70b-versatile "fast and cheap for refactors"
ccswitch remove llama-3.3-70b-versatile
```

The picker shows your favorites with the last-used one marked.

### Repairing an already-broken session

If a session was wedged *before* you had ccswitch (or by another tool):

```bash
ccswitch fix                    # newest transcript in this project
ccswitch fix <session-id>       # a specific one
ccswitch fix <session-id> --dry-run
```

It rewrites the foreign ids, backs up first, and the session resumes normally with its context intact.

---

## How it works

```
Claude Code  ──►  127.0.0.1:8787  ──►  OpenRouter / Groq
                  (ccswitch proxy)
                   • gen-abc123  ──►  msg_01px…
                   • strips Anthropic-only `diagnostics` from requests
```

- **Per project.** Only `<project>/.claude/settings.local.json` is touched. Your other projects and sessions stay on the subscription.
- **Both directions, live.** Claude Code re-reads settings mid-session, so switching applies to your very next message.
- **The proxy is local.** Binds to `127.0.0.1` only. Your API key passes through in the header exactly as sent — never logged, stored, or inspected.
- **Never silently degraded.** If Bun or the proxy is unavailable, ccswitch says so and warns that switching back will need `ccswitch fix`.
- **`ANTHROPIC_API_KEY` is blanked** while on another provider, so a stray key in your environment can't cause surprise Anthropic API billing.
- **Every settings change is backed up** to `~/.ccswitch-backups/<project>/`.

### Why the id rewrite is safe

Ids are mapped deterministically (`sha1(original)` → `msg_01px…`), so the same upstream id always yields the same value across retries. The field is used only for prompt-cache diagnostics — it never affects your conversation. The original request id is preserved in the transcript's `requestId`.

---

## Adding a provider

Any Anthropic-compatible endpoint works. Add it to [`src/providers.ts`](src/providers.ts):

```ts
myprovider: {
  id: "myprovider",
  label: "My Provider",
  baseUrl: "https://api.example.com/anthropic",
  keyEnv: "MYPROVIDER_API_KEY",
  keysUrl: "https://example.com/keys",
  modelsUrl: "https://example.com/models",
},
```

PRs welcome.

---

## Files it touches

| Path | What |
|---|---|
| `<project>/.claude/settings.local.json` | the provider override (per project) |
| `~/.ccswitch.json` | favorites, last-used model, proxy port |
| `~/.ccswitch-backups/` | timestamped settings backups |
| `~/.ccswitch.log` | proxy log |
| `~/.claude/commands/switch.md` | the `/switch` command (opt-in) |

Nothing else. Your Claude credentials are never read or modified.

---

## Development

```bash
bun install
bun test          # 68 tests
bun run typecheck
bun src/cli.ts    # run locally
```

---

## License

Apache-2.0 © [unclecode](https://github.com/unclecode)

Author of [Crawl4AI](https://github.com/unclecode/crawl4ai) (78k★) and other open-source tools.
