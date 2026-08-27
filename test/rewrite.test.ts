import { describe, expect, test } from "bun:test";
import {
  fixMessageId,
  isAnthropicId,
  REWRITE_PREFIX,
  rewriteSSEEvent,
  rewriteSSEStream,
  stripDiagnostics,
  toMsgId,
} from "../src/rewrite";

describe("toMsgId", () => {
  test("produces an Anthropic-shaped id", () => {
    const id = toMsgId("gen-1787797491-GixlheIRrzBVNWJEiQLo");
    expect(id.startsWith("msg_")).toBe(true);
    expect(id.startsWith(REWRITE_PREFIX)).toBe(true);
  });

  test("is deterministic — retries map to the same id", () => {
    expect(toMsgId("gen-abc")).toBe(toMsgId("gen-abc"));
  });

  test("distinct inputs give distinct ids", () => {
    expect(toMsgId("gen-abc")).not.toBe(toMsgId("gen-abd"));
  });
});

describe("isAnthropicId", () => {
  test.each([
    ["msg_011CeSZ1Aeu7wQerbPL9pk1a", true],
    ["gen-1787797491-Gixlhe", false],
    ["chatcmpl-9xyz", false],
    ["", false],
    [undefined, false],
    [null, false],
    [42, false],
  ])("%p -> %p", (input, expected) => {
    expect(isAnthropicId(input)).toBe(expected);
  });
});

describe("fixMessageId", () => {
  test("rewrites a foreign id on a message object", () => {
    const obj = { type: "message", id: "gen-abc", role: "assistant" };
    expect(fixMessageId(obj)).toBe(true);
    expect(obj.id.startsWith("msg_")).toBe(true);
  });

  test("leaves an already-valid id untouched", () => {
    const obj = { type: "message", id: "msg_011CeSZ1Aeu7wQerbPL9pk1a" };
    expect(fixMessageId(obj)).toBe(false);
    expect(obj.id).toBe("msg_011CeSZ1Aeu7wQerbPL9pk1a");
  });

  test("ignores objects that are not messages", () => {
    const obj = { type: "error", id: "gen-abc" };
    expect(fixMessageId(obj)).toBe(false);
    expect(obj.id).toBe("gen-abc");
  });

  test("tolerates null and undefined", () => {
    expect(fixMessageId(null)).toBe(false);
    expect(fixMessageId(undefined)).toBe(false);
  });
});

describe("stripDiagnostics", () => {
  test("removes the field when present", () => {
    const body: any = { model: "x", diagnostics: { previous_message_id: "gen-abc" } };
    expect(stripDiagnostics(body)).toBe(true);
    expect("diagnostics" in body).toBe(false);
  });

  test("leaves other fields alone", () => {
    const body: any = { model: "x", messages: [1], diagnostics: {} };
    stripDiagnostics(body);
    expect(body.model).toBe("x");
    expect(body.messages).toEqual([1]);
  });

  test("no-op when absent", () => {
    const body: any = { model: "x" };
    expect(stripDiagnostics(body)).toBe(false);
  });
});

describe("rewriteSSEEvent", () => {
  test("rewrites the id inside message_start", () => {
    const raw =
      `event: message_start\ndata: ${JSON.stringify({
        type: "message_start",
        message: { type: "message", id: "gen-xyz", role: "assistant" },
      })}\n\n`;
    const out = rewriteSSEEvent(raw);
    expect(out).not.toContain("gen-xyz");
    expect(out).toContain("msg_");
    expect(out.startsWith("event: message_start")).toBe(true);
  });

  test("passes other event types through byte-for-byte", () => {
    const raw = `event: content_block_delta\ndata: {"type":"content_block_delta"}\n\n`;
    expect(rewriteSSEEvent(raw)).toBe(raw);
  });

  test("leaves malformed JSON untouched rather than throwing", () => {
    const raw = `event: message_start\ndata: {not json\n\n`;
    expect(rewriteSSEEvent(raw)).toBe(raw);
  });
});

/** Feed a byte stream through the rewriter and collect the text out. */
async function pipe(chunks: string[]): Promise<string> {
  const encoder = new TextEncoder();
  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return await new Response(rewriteSSEStream(source)).text();
}

describe("rewriteSSEStream", () => {
  const startEvent = (id: string) =>
    `event: message_start\ndata: ${JSON.stringify({
      type: "message_start",
      message: { type: "message", id, role: "assistant" },
    })}\n\n`;

  test("rewrites ids in a whole stream", async () => {
    const out = await pipe([
      startEvent("gen-1"),
      `event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"text":"hi"}}\n\n`,
      `event: message_stop\ndata: {"type":"message_stop"}\n\n`,
    ]);
    expect(out).not.toContain("gen-1");
    expect(out).toContain("msg_");
    expect(out).toContain("content_block_delta");
    expect(out).toContain("message_stop");
  });

  test("handles an event split across chunk boundaries", async () => {
    // This is the case that corrupts naive implementations: the JSON payload is
    // cut in half by the network chunking.
    const event = startEvent("gen-split");
    const mid = Math.floor(event.length / 2);
    const out = await pipe([event.slice(0, mid), event.slice(mid)]);
    expect(out).not.toContain("gen-split");
    expect(out).toContain("msg_");
  });

  test("handles many events arriving in one chunk", async () => {
    const out = await pipe([startEvent("gen-a") + startEvent("gen-b")]);
    expect(out).not.toContain("gen-a");
    expect(out).not.toContain("gen-b");
    expect(out.match(/msg_/g)?.length).toBe(2);
  });

  test("preserves a trailing event with no final blank line", async () => {
    const out = await pipe([`event: message_stop\ndata: {"type":"message_stop"}`]);
    expect(out).toContain("message_stop");
  });

  test("passes through a stream with no message_start unchanged", async () => {
    const input = `event: ping\ndata: {"type":"ping"}\n\n`;
    expect(await pipe([input])).toBe(input);
  });

  test("does not mangle unicode split across chunks", async () => {
    const text = "héllo → 世界";
    const event = `event: content_block_delta\ndata: ${JSON.stringify({
      type: "content_block_delta",
      delta: { text },
    })}\n\n`;
    const bytes = new TextEncoder().encode(event);
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        // Split mid-multibyte-character on purpose.
        controller.enqueue(bytes.slice(0, 45));
        controller.enqueue(bytes.slice(45));
        controller.close();
      },
    });
    const out = await new Response(rewriteSSEStream(source)).text();
    expect(out).toContain(text);
  });
});
