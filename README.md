# ccswitch

**Switch Claude Code between your Max subscription and OpenRouter or Groq models, inside the same chat session, and switch back without breaking anything.**

```
/switch          pick a model
   ...work...
/switch          back to your subscription, keep typing
```

---

## Why I built this

Today, 27 August, I woke up, had breakfast, and sat down to work with Claude Code as usual. Everyone right now is talking about GLM, DeepSeek, OpenRouter. So I decided to dig in again and find out whether there was a smooth way to do the thing I actually wanted: while running Claude Code, inside the same chat session, switch over to OpenRouter, pick another model, and then come back and be on my Max subscription again.

I did a lot of research. I found some solutions, but none of them really did the job the way I wanted. Either no proxy at all, or too much proxy, or a whole LiteLLM setup, this and that.

And then I hit the real problem. I could switch to OpenRouter dynamically inside the session, that part worked. But when I wanted to go back, it broke. It turns out that although OpenRouter claims their endpoint is Anthropic friendly, it is not, quite. They hand back their own message IDs. Claude Code writes those IDs into your session file, and the moment you switch back to your subscription, the Anthropic API rejects them. Your session is stuck. You have to exit, repair the session file, and come back.

So I wrote a very thin proxy to fix exactly that, and after that it just worked. It is so smooth that I cannot stop myself from sharing it with everyone who has the same wish.

Now, in the middle of a chat, I can switch wherever I want. Do the planning with a Claude model, hand the grinding work to sub agents on DeepSeek or GLM or Kimi, then come straight back. Some tasks want a cheaper model but still want the harness of Claude Code. This gives you that.

It is very simple. Install it, then there is a `/switch` command. Run it, switch back and forth, that is it. I added OpenRouter and Groq to start with, and adding a new provider is easy, so contributions are welcome.

Unclecode

---

## Install

One line. It asks before each step and installs Bun if you do not have it:

```bash
curl -fsSL https://raw.githubusercontent.com/unclecode/ccswitch/main/install.sh | bash
```

Or, if you already have [Bun](https://bun.sh):

```bash
bun install -g @unclecode/ccswitch
ccswitch install
```

Then put your provider key in your shell profile so Claude Code inherits it:

```bash
export OPENROUTER_API_KEY=...   # https://openrouter.ai/keys
export GROQ_API_KEY=...         # https://console.groq.com/keys
```

That is the whole setup. Requires [Bun](https://bun.sh).

<details>
<summary>Or just ask your coding agent to do it</summary>

> Install ccswitch from https://github.com/unclecode/ccswitch, run `ccswitch install`, and set up an OpenRouter key for me.

The repo ships an agent skill in [`skill/`](skill/) that agents follow directly.
</details>

## Use

Inside any Claude Code session, in any directory:

```
/switch          pick a model from your favorites
/model           select that model
   ...work...
/switch          choose "back", keep typing on your subscription
```

That is it. Nothing runs in the background that you have to manage. The proxy starts when it is needed and restarts itself after a reboot.

Switching changes only the directory you are in. Every other project and session stays on your subscription.

### Favorites

```bash
ccswitch list
ccswitch add groq:llama-3.3-70b-versatile "fast and cheap for refactors"
ccswitch remove llama-3.3-70b-versatile
```

The picker remembers the last model you used.

---

### Two useful notes

**Context window.** Claude Code does not know the real context size of a third party model. It shows the default, 200k. If your `/model` list has an entry ending in `[1m]`, pick that one: Claude Code then uses a 1M window for `/context` and compaction. The request itself always goes to the same model either way.

**No restart needed, with one exception.** The auto-restart hook prepares every directory the first time you start Claude Code in it. In a directory where Claude Code never ran with ccswitch installed, the first `/switch` needs one session restart. After that, never again.

## Learn more

| | |
|---|---|
| [How it works](docs/how-it-works.md) | the message ID problem, the proxy, what gets written where |
| [Adding a provider](docs/providers.md) | any Anthropic compatible endpoint, in about seven lines |
| [Troubleshooting](docs/troubleshooting.md) | broken sessions, `ccswitch fix`, `ccswitch heal`, common errors |
| [All commands](docs/cli.md) | the full CLI, for scripting and setup |

---

## License

Apache-2.0 © [unclecode](https://github.com/unclecode)

Author of [Crawl4AI](https://github.com/unclecode/crawl4ai) (78k stars) and other open source tools.
