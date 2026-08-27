/**
 * Self-healing: restart the proxy when a project needs one that isn't running.
 *
 * A project's settings pin an exact proxy URL (e.g. http://127.0.0.1:8788). That
 * port is empty after a reboot, a logout, or a manual kill, and every request in
 * the project would fail with a connection error until someone noticed.
 *
 * `ccswitch heal` fixes that silently. It is wired to Claude Code's SessionStart
 * hook by `ccswitch install`, so opening a session anywhere is enough — the user
 * never runs or supervises a service.
 */

import { spawn } from "node:child_process";
import { openSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { applyProvider, loadState, projectRoot, readStatus } from "./config";
import { getProvider, PROVIDERS } from "./providers";
import { proxyHealthy, proxyInfo } from "./proxy";

const LOG_PATH = join(homedir(), ".ccswitch.log");
const PORT_SCAN_RANGE = 20;

export type HealResult =
  | { action: "not-needed"; reason: string }
  | { action: "healed"; port: number; changedPort: boolean; model: string }
  | { action: "failed"; reason: string };

/** Can we bind this port right now? */
async function portFree(port: number): Promise<boolean> {
  try {
    const probe = Bun.serve({ port, hostname: "127.0.0.1", fetch: () => new Response("") });
    probe.stop(true);
    return true;
  } catch {
    return false;
  }
}

/** Launch a detached proxy and wait for it to answer. */
async function spawnProxy(port: number, upstream: string): Promise<boolean> {
  const entry = Bun.fileURLToPath(import.meta.resolve("./proxy-server.ts"));
  const fd = openSync(LOG_PATH, "a");
  const child = spawn(
    process.execPath,
    [entry, "--port", String(port), "--upstream", upstream],
    { detached: true, stdio: ["ignore", fd, fd] },
  );
  child.unref();

  for (let i = 0; i < 50; i++) {
    await Bun.sleep(100);
    if (await proxyHealthy(port)) return true;
  }
  return false;
}

/**
 * Work out which provider a project's stored auth token belongs to.
 * The token itself is never logged or compared beyond this local lookup.
 */
function providerForToken(token: string): string | null {
  for (const p of Object.values(PROVIDERS)) {
    if (token && process.env[p.keyEnv] === token) return p.id;
  }
  return null;
}

/**
 * Restore this project's proxy if it needs one and it isn't running.
 * Safe to call on every session start: it is a no-op unless there is a problem.
 */
export async function heal(root: string = projectRoot()): Promise<HealResult> {
  const status = readStatus(root);

  if (status.mode !== "third-party") {
    return { action: "not-needed", reason: "project is on the Claude subscription" };
  }
  if (!status.viaProxy) {
    return { action: "not-needed", reason: "project talks to the provider directly" };
  }

  const pinnedPort = Number(new URL(status.baseUrl).port);
  if (await proxyHealthy(pinnedPort)) {
    return { action: "not-needed", reason: "proxy already running" };
  }

  // Which provider should this proxy point at? Prefer the token actually stored in
  // the project; fall back to the last provider used.
  const state = loadState();
  const { readJson, settingsPath } = await import("./config");
  const env = readJson(settingsPath(root)).env ?? {};
  const providerId =
    providerForToken(env.ANTHROPIC_AUTH_TOKEN ?? "") ??
    state.last?.provider ??
    null;

  if (!providerId) {
    return { action: "failed", reason: "cannot tell which provider this project uses" };
  }

  const provider = getProvider(providerId);
  const token = process.env[provider.keyEnv];
  if (!token) {
    return { action: "failed", reason: `${provider.keyEnv} is not set in this environment` };
  }

  // Try the pinned port first so settings need no rewrite; otherwise scan onward.
  for (let port = pinnedPort; port < pinnedPort + PORT_SCAN_RANGE; port++) {
    const info = await proxyInfo(port);
    if (info) {
      if (info.upstream.replace(/\/$/, "") !== provider.baseUrl.replace(/\/$/, "")) continue;
    } else {
      if (!(await portFree(port))) continue;
      if (!(await spawnProxy(port, provider.baseUrl))) continue;
    }

    const changedPort = port !== pinnedPort;
    if (changedPort) {
      // The original port is taken by something else — repoint the project.
      applyProvider({
        baseUrl: `http://127.0.0.1:${port}`,
        token,
        model: status.model,
        root,
      });
      const next = loadState();
      next.port = port;
      const { saveState } = await import("./config");
      saveState(next);
    }

    return { action: "healed", port, changedPort, model: status.model };
  }

  return { action: "failed", reason: "no free port available for the proxy" };
}
