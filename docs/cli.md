# All commands

Day to day you only need `/switch` inside Claude Code. The CLI is for setup,
scripting, and recovery.

```
ccswitch                       interactive picker
ccswitch use <model>           switch this project to a model
ccswitch back                  switch back to your Claude subscription
ccswitch back --clean          also remove the emptied override keys
ccswitch status                what this project is using
ccswitch list                  your favorite models
ccswitch add <model> [note]    add a favorite
ccswitch remove <model>        remove a favorite
ccswitch fix [session-id]      repair a transcript poisoned before ccswitch
ccswitch heal                  restart this project's proxy if it stopped
ccswitch providers             supported providers and key status
ccswitch install               first run setup
ccswitch install-command       add the /switch slash command only
ccswitch uninstall-hook        remove the auto restart hook
ccswitch version
```

## Notes on a few of them

**`back` vs `back --clean`.** Plain `back` overwrites the override keys with empty
values, which a running session picks up immediately. `--clean` deletes the keys
outright, which is tidier but only applies to new sessions, so use it when no session
is running in that project.

**`fix`** never destroys anything. It writes `<transcript>.bak-<timestamp>` next to the
file before touching it, and `--dry-run` shows you the mapping without writing.

**`heal`** is safe to run any time. It does nothing unless this project points at a
proxy that is not currently running.

**`add` and `remove`.** Prefix with a provider (`groq:model-id`) to be explicit. On
`remove`, an unprefixed ID matches on the model alone, and if it is ambiguous ccswitch
tells you rather than guessing.

## Development

```bash
bun install
bun test          # 86 tests
bun run typecheck
bun src/cli.ts    # run locally
```
