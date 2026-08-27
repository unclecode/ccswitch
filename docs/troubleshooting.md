# Troubleshooting

## A session fails with `previous_message_id`

```
API Error: 400 diagnostics.previous_message_id: must be the `id` from a prior
/v1/messages response (starts with `msg_`)
```

This happens to sessions that talked to a provider *without* the proxy, either before
you installed ccswitch or while it was running in degraded mode. Repair the transcript:

```bash
ccswitch fix                    # newest transcript in this project
ccswitch fix <session-id>       # a specific session
ccswitch fix <session-id> --dry-run
```

It backs up first, rewrites the foreign IDs, and the session resumes normally with its
context intact. The session ID is shown by `/status` inside Claude Code.

Exiting and resuming on its own will not fix this, because the bad ID is read back from
the transcript file every time. See [how it works](how-it-works.md).

## Connection refused in a switched project

The proxy is not running, usually after a reboot when the auto restart hook is not
installed. Fix it:

```bash
ccswitch heal
```

To make this automatic, run `ccswitch install` and accept the auto restart step.

## `<PROVIDER>_API_KEY is not set`

The key has to be exported in the shell that launched Claude Code, not only in the
terminal where you ran ccswitch. Put it in your shell profile:

```bash
echo 'export OPENROUTER_API_KEY=...' >> ~/.zshrc
```

## `proxy unavailable` warning

Bun is missing, or every port in the scan range is occupied. Check `~/.ccswitch.log`.
Switching still works in this state, but switching back will then need `ccswitch fix`,
which is exactly what the warning says.

## The model is not what I expected, and it cost more than expected

Your session's `/model` choice overrides the model in settings. After switching, run
`/model` and select the model you switched to. Otherwise the session keeps sending its
previous model name to the new provider, which may serve it at a much higher price.

## Tool calls behave strangely on a cheap model

Not every model handles Claude Code's tool calling well. This is a property of the
model, not of ccswitch. Try a known good one, for example `z-ai/glm-5.3-flash` or
`moonshotai/kimi-k3`.

## I want to undo everything

```bash
ccswitch back --clean      # in each switched project, when no session is running there
ccswitch uninstall-hook    # remove the SessionStart hook
rm ~/.claude/commands/switch.md
bun remove -g @unclecode/ccswitch
```

Backups of every settings change stay in `~/.ccswitch-backups/`.
