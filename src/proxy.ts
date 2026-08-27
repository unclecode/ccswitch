/**
 * The local shim between Claude Code and a third-party Anthropic-compatible endpoint.
 *
 * Binds to 127.0.0.1 only. Your API key travels in the Authorization header exactly
 * as Claude Code sent it; ccswitch never logs, stores, or inspects it.
 */

import { fixMessageId, rewriteSSEStream, stripDiagnostics } from "./rewrite";

export interface ProxyOptions {
  port: number;
  upstream: string;
  verbose?: boolean;
}

export const HEALTH_PATH = "/__ccswitch/health";

export function startProxy(opts: ProxyOptions) {
  const upstream = opts.upstream.replace(/\/$/, "");
  const log = (msg: string) => opts.verbose && console.error(msg);

  return Bun.serve({
    port: opts.port,
    hostname: "127.0.0.1",
    // Long agent turns can hold a connection open; keep well above Bun's default.
    idleTimeout: 255,

    async fetch(req) {
      const url = new URL(req.url);

      if (url.pathname === HEALTH_PATH) {
        return Response.json({ ok: true, service: "ccswitch", upstream, port: opts.port });
      }

      const headers = new Headers(req.headers);
      headers.delete("host");
      headers.delete("content-length");

      let body: string | null = null;
      if (req.method !== "GET" && req.method !== "HEAD") {
        const raw = await req.text();
        if (raw) {
          try {
            const parsed = JSON.parse(raw);
            if (stripDiagnostics(parsed)) log("  [req] stripped diagnostics");
            body = JSON.stringify(parsed);
          } catch {
            body = raw; // not JSON, pass through verbatim
          }
        }
      }

      let res: Response;
      try {
        res = await fetch(upstream + url.pathname + url.search, {
          method: req.method,
          headers,
          body,
          redirect: "manual",
        });
      } catch (err: any) {
        const message = `ccswitch proxy: upstream request failed: ${err?.message ?? err}`;
        console.error(`[ccswitch] ${message}`);
        return Response.json(
          { type: "error", error: { type: "api_error", message } },
          { status: 502 },
        );
      }

      log(`[ccswitch] ${req.method} ${url.pathname} -> ${res.status}`);

      const outHeaders = new Headers(res.headers);
      // Body is re-encoded below, so stale framing headers must not survive.
      outHeaders.delete("content-encoding");
      outHeaders.delete("content-length");

      const contentType = res.headers.get("content-type") ?? "";

      if (contentType.includes("text/event-stream") && res.body) {
        return new Response(
          rewriteSSEStream(res.body, (id) => log(`  [sse] id -> ${id}`)),
          { status: res.status, headers: outHeaders },
        );
      }

      if (contentType.includes("application/json")) {
        const text = await res.text();
        try {
          const parsed = JSON.parse(text);
          if (fixMessageId(parsed)) log(`  [json] id -> ${parsed.id}`);
          return new Response(JSON.stringify(parsed), {
            status: res.status,
            headers: outHeaders,
          });
        } catch {
          return new Response(text, { status: res.status, headers: outHeaders });
        }
      }

      return new Response(res.body, { status: res.status, headers: outHeaders });
    },
  });
}

/**
 * Is *our* proxy serving on this port?
 *
 * The identity check matters: a stale tool or an unrelated dev server may hold the
 * port, and forwarding Claude Code's traffic to it would fail in confusing ways.
 * Returns the upstream it is bound to, so callers can detect a provider mismatch.
 */
export async function proxyInfo(
  port: number,
): Promise<{ ok: true; upstream: string } | null> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}${HEALTH_PATH}`, {
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) return null;
    const body: any = await res.json();
    if (body?.ok === true && body?.service === "ccswitch") {
      return { ok: true, upstream: String(body.upstream ?? "") };
    }
    return null;
  } catch {
    return null;
  }
}

export async function proxyHealthy(port: number): Promise<boolean> {
  return (await proxyInfo(port)) !== null;
}
