#!/usr/bin/env bun
/**
 * Standalone entry point for the proxy, so the CLI can spawn it detached.
 * Run directly for debugging:
 *   bun src/proxy-server.ts --port 8787 --upstream https://openrouter.ai/api --verbose
 */

import { startProxy } from "./proxy";

const argv = Bun.argv.slice(2);
const argOf = (name: string, fallback: string): string => {
  const i = argv.indexOf(name);
  return i !== -1 && argv[i + 1] ? argv[i + 1]! : fallback;
};

const server = startProxy({
  port: Number(argOf("--port", "8787")),
  upstream: argOf("--upstream", "https://openrouter.ai/api"),
  verbose: argv.includes("--verbose"),
});

console.error(
  `[ccswitch] proxy listening on http://127.0.0.1:${server.port} ` +
    `-> ${argOf("--upstream", "https://openrouter.ai/api")}`,
);
