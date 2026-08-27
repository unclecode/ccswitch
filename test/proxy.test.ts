/**
 * End-to-end proxy tests against a fake upstream, so they run offline and in CI.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { proxyHealthy, proxyInfo, startProxy } from "../src/proxy";

/** Stand-in for a provider that returns non-Anthropic ids. */
const upstream = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  async fetch(req) {
    const url = new URL(req.url);
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};

    if (url.pathname === "/echo") {
      return Response.json({ received: body });
    }

    if (url.pathname === "/v1/messages" && (body as any)?.stream) {
      const events = [
        `event: message_start\ndata: ${JSON.stringify({
          type: "message_start",
          message: { type: "message", id: "gen-stream-1", role: "assistant" },
        })}\n\n`,
        `event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"text":"hi"}}\n\n`,
        `event: message_stop\ndata: {"type":"message_stop"}\n\n`,
      ];
      const stream = new ReadableStream({
        start(controller) {
          const encoder = new TextEncoder();
          for (const e of events) controller.enqueue(encoder.encode(e));
          controller.close();
        },
      });
      return new Response(stream, { headers: { "content-type": "text/event-stream" } });
    }

    if (url.pathname === "/v1/messages") {
      return Response.json({
        type: "message",
        id: "gen-json-1",
        role: "assistant",
        content: [{ type: "text", text: "hello" }],
      });
    }

    if (url.pathname === "/plain") {
      return new Response("just bytes", { headers: { "content-type": "text/plain" } });
    }

    if (url.pathname === "/boom") {
      return Response.json({ type: "error", error: { message: "upstream said no" } }, { status: 429 });
    }

    return new Response("not found", { status: 404 });
  },
});

const UPSTREAM_URL = `http://127.0.0.1:${upstream.port}`;
const proxy = startProxy({ port: 0, upstream: UPSTREAM_URL });
const PROXY_PORT = proxy.port as number;
const PROXY_URL = `http://127.0.0.1:${PROXY_PORT}`;

afterAll(() => {
  proxy.stop(true);
  upstream.stop(true);
});

describe("proxy", () => {
  test("health endpoint reports the upstream", async () => {
    const res = await fetch(`${PROXY_URL}/__ccswitch/health`);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.upstream).toBe(UPSTREAM_URL);
  });

  test("proxyHealthy detects a live proxy", async () => {
    expect(await proxyHealthy(PROXY_PORT)).toBe(true);
  });

  test("proxyHealthy is false for a dead port", async () => {
    expect(await proxyHealthy(1)).toBe(false);
  });

  test("health response identifies the service and upstream", async () => {
    const info = await proxyInfo(PROXY_PORT);
    expect(info).not.toBeNull();
    expect(info!.upstream).toBe(UPSTREAM_URL);
  });

  test("does not mistake an unrelated server for ccswitch", async () => {
    // A stale tool or dev server on the port must not be treated as our proxy —
    // forwarding Claude Code's traffic to it would fail confusingly.
    const impostor = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: () => Response.json({ ok: true }),
    });
    try {
      expect(await proxyInfo(impostor.port as number)).toBeNull();
      expect(await proxyHealthy(impostor.port as number)).toBe(false);
    } finally {
      impostor.stop(true);
    }
  });

  test("rewrites the id on a JSON response", async () => {
    const res = await fetch(`${PROXY_URL}/v1/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "test", messages: [] }),
    });
    const body = await res.json();
    expect(body.id.startsWith("msg_")).toBe(true);
    expect(body.id).not.toContain("gen-");
    expect(body.content[0].text).toBe("hello");
  });

  test("rewrites the id in a streaming response", async () => {
    const res = await fetch(`${PROXY_URL}/v1/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "test", messages: [], stream: true }),
    });
    const text = await res.text();
    expect(text).not.toContain("gen-stream-1");
    expect(text).toContain("msg_");
    expect(text).toContain("content_block_delta");
    expect(text).toContain("message_stop");
  });

  test("strips diagnostics from the outgoing request", async () => {
    const res = await fetch(`${PROXY_URL}/echo`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "test",
        diagnostics: { previous_message_id: "gen-whatever" },
      }),
    });
    const body = await res.json();
    expect("diagnostics" in body.received).toBe(false);
    expect(body.received.model).toBe("test");
  });

  test("passes non-JSON bodies through untouched", async () => {
    const res = await fetch(`${PROXY_URL}/plain`);
    expect(await res.text()).toBe("just bytes");
  });

  test("preserves upstream error status codes", async () => {
    const res = await fetch(`${PROXY_URL}/boom`, { method: "POST", body: "{}" });
    expect(res.status).toBe(429);
    expect((await res.json()).error.message).toBe("upstream said no");
  });

  test("returns a 502 in Anthropic error shape when upstream is unreachable", async () => {
    const orphan = startProxy({ port: 0, upstream: "http://127.0.0.1:1" });
    try {
      const res = await fetch(`http://127.0.0.1:${orphan.port}/v1/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      expect(res.status).toBe(502);
      const body = await res.json();
      expect(body.type).toBe("error");
      expect(body.error.message).toContain("ccswitch");
    } finally {
      orphan.stop(true);
    }
  });

  test("forwards the Authorization header unchanged", async () => {
    const seen: string[] = [];
    const spy = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch(req) {
        seen.push(req.headers.get("authorization") ?? "");
        return Response.json({ type: "message", id: "gen-1" });
      },
    });
    const p = startProxy({ port: 0, upstream: `http://127.0.0.1:${spy.port}` });
    try {
      await fetch(`http://127.0.0.1:${p.port}/v1/messages`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer sk-test-123" },
        body: "{}",
      });
      expect(seen[0]).toBe("Bearer sk-test-123");
    } finally {
      p.stop(true);
      spy.stop(true);
    }
  });
});
