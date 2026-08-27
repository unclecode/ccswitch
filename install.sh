#!/usr/bin/env bash
#
# ccswitch installer.
#
#   curl -fsSL https://raw.githubusercontent.com/unclecode/ccswitch/main/install.sh | bash
#
# What it does, in order, asking before each install step:
#   1. Checks for Bun. Offers to install it if missing.
#   2. Installs @unclecode/ccswitch globally with Bun.
#   3. Runs `ccswitch install` (slash command + auto-restart hook, each asks).
#   4. Prints how to set your provider API key.
#
# It never touches your Claude login and never reads or stores API keys.

set -euo pipefail

say()  { printf '%s\n' "$*"; }
bold() { printf '\033[1m%s\033[0m\n' "$*"; }
err()  { printf '\033[31merror:\033[0m %s\n' "$*" >&2; }

# When piped into bash, stdin is the script itself, so questions must read
# from the terminal directly.
ask() {
  local prompt="$1" answer=""
  if [ -t 0 ]; then
    read -r -p "$prompt [Y/n] " answer || answer=""
  elif { true < /dev/tty; } 2>/dev/null; then
    read -r -p "$prompt [Y/n] " answer < /dev/tty || answer=""
  else
    say "$prompt [Y/n]  (no terminal; assuming yes)"
  fi
  case "$answer" in
    n*|N*) return 1 ;;
    *)     return 0 ;;
  esac
}

bold "ccswitch installer"
say ""

# ---- 1. Bun ----------------------------------------------------------------
find_bun() {
  if command -v bun >/dev/null 2>&1; then command -v bun; return; fi
  if [ -x "$HOME/.bun/bin/bun" ]; then echo "$HOME/.bun/bin/bun"; return; fi
  return 1
}

BUN="$(find_bun || true)"
if [ -z "$BUN" ]; then
  say "ccswitch runs on Bun, which is not installed."
  if ask "Install Bun now (official installer, bun.sh)?"; then
    curl -fsSL https://bun.sh/install | bash
    BUN="$(find_bun || true)"
    if [ -z "$BUN" ]; then
      err "Bun installation did not complete. Install it manually, then re-run this script."
      exit 1
    fi
  else
    err "cannot continue without Bun."
    exit 1
  fi
fi
say "using Bun: $BUN ($("$BUN" --version))"
say ""

# ---- 2. the package ---------------------------------------------------------
if ask "Install ccswitch globally?"; then
  "$BUN" install -g @unclecode/ccswitch
else
  err "nothing installed."
  exit 1
fi

CCSWITCH="$HOME/.bun/bin/ccswitch"
if [ ! -x "$CCSWITCH" ]; then
  CCSWITCH="$(command -v ccswitch || true)"
fi
if [ -z "$CCSWITCH" ]; then
  err "ccswitch installed but not found on PATH. Open a new terminal and run: ccswitch install"
  exit 1
fi
say ""

# ---- 3. setup ---------------------------------------------------------------
# `ccswitch install` asks its own questions; give it the terminal.
# Run through $BUN explicitly: the shebang needs bun on PATH, which a shell
# that just installed Bun does not have yet.
if { true < /dev/tty; } 2>/dev/null; then
  "$BUN" "$CCSWITCH" install < /dev/tty
else
  "$BUN" "$CCSWITCH" install
fi
say ""

# ---- 4. PATH + key hints -----------------------------------------------------
if ! command -v ccswitch >/dev/null 2>&1; then
  say "Add Bun's bin folder to your PATH (new terminals may already have it):"
  say '  export PATH="$HOME/.bun/bin:$PATH"'
  say ""
fi

bold "Done."
say "Inside any Claude Code session, type /switch to change provider."
say "Docs: https://github.com/unclecode/ccswitch"
