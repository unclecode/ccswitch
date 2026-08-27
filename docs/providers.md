# Adding a provider

Any endpoint that speaks the Anthropic Messages API works. Add an entry to
[`src/providers.ts`](../src/providers.ts):

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

That is all. The CLI picks it up automatically: `ccswitch use myprovider:some-model`,
key detection in `ccswitch providers`, and the proxy handles the rest.

Optionally add a model or two to `SEED_FAVORITES` in the same file, so new users see
something useful in the picker.

## Currently supported

| Provider | Key | Models |
|---|---|---|
| OpenRouter | `OPENROUTER_API_KEY` | https://openrouter.ai/models |
| Groq | `GROQ_API_KEY` | https://console.groq.com/docs/models |

## Referring to models

```bash
ccswitch use z-ai/glm-5.3-flash                 # uses your last provider
ccswitch use groq:moonshotai/kimi-k2-instruct   # explicit provider
```

A `provider:` prefix wins. Without one, the last provider you used applies. Model IDs
themselves often contain a slash, so only the colon separates the provider.

## Contributing

Pull requests welcome. Please run `bun test` and `bun run typecheck` before opening one.
If you are adding a provider, mention in the PR which model you actually tested with,
since not every model handles Claude Code's tool calling well.
