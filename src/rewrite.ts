/**
 * The core of ccswitch: making a third-party response look like an Anthropic one.
 *
 * Background
 * ----------
 * Claude Code uses Anthropic's cache-diagnosis beta. On each request it sends
 * `diagnostics.previous_message_id`, the `id` of the previous assistant response.
 * The Anthropic API rejects any value that does not start with `msg_`.
 *
 * Third-party Anthropic-compatible endpoints return their own id formats
 * (OpenRouter: `gen-...`). Claude Code persists whatever it receives into the
 * session transcript. The moment you switch that project back to Anthropic, the
 * next request carries a foreign id and fails:
 *
 *     400 diagnostics.previous_message_id: must be the `id` from a prior
 *     /v1/messages response (starts with `msg_`)
 *
 * The failure is permanent: the id is re-read from the transcript on every resume,
 * so restarting does not help. (Upstream: anthropics/claude-code#59520, closed as
 * "not planned".)
 *
 * The fix is to normalise ids on the way in, so nothing invalid is ever written to
 * disk in the first place.
 */

import { createHash } from "node:crypto";

/** Prefix marking an id as rewritten by ccswitch, handy when debugging transcripts. */
export const REWRITE_PREFIX = "msg_01px";

/**
 * Map any id to a deterministic `msg_`-shaped one.
 * Deterministic (not random) so the same upstream id always maps to the same value:
 * retries and reconnects stay consistent, and the mapping is reproducible offline.
 */
export function toMsgId(originalId: string): string {
  const digest = createHash("sha1").update(originalId).digest("hex").slice(0, 20);
  return REWRITE_PREFIX + digest;
}

/** True if the id is already in Anthropic's format and needs no rewriting. */
export function isAnthropicId(id: unknown): boolean {
  return typeof id === "string" && id.startsWith("msg_");
}

/**
 * Rewrite `id` on an Anthropic-shaped message object, in place.
 * Returns true if a change was made.
 */
export function fixMessageId(obj: any): boolean {
  if (
    obj &&
    obj.type === "message" &&
    typeof obj.id === "string" &&
    !isAnthropicId(obj.id)
  ) {
    obj.id = toMsgId(obj.id);
    return true;
  }
  return false;
}

/**
 * Strip Anthropic-only cache telemetry from an outgoing request body.
 * Third-party endpoints have no use for it, and removing it eliminates the
 * failure mode at the source rather than patching it downstream.
 * Returns true if the field was present.
 */
export function stripDiagnostics(body: any): boolean {
  if (body && typeof body === "object" && "diagnostics" in body) {
    delete body.diagnostics;
    return true;
  }
  return false;
}

/**
 * Rewrite a single SSE event's payload if it is a `message_start` carrying an id.
 * Input and output are the raw event text (including trailing blank line).
 * Anything unrecognised passes through byte-for-byte.
 */
export function rewriteSSEEvent(raw: string): string {
  if (!raw.includes("message_start")) return raw;
  return raw.replace(/^data: (.*)$/m, (whole, payload: string) => {
    try {
      const parsed = JSON.parse(payload);
      if (parsed?.type === "message_start" && fixMessageId(parsed.message)) {
        return "data: " + JSON.stringify(parsed);
      }
    } catch {
      // Not JSON we understand, leave the event exactly as it came.
    }
    return whole;
  });
}

/**
 * Transform an SSE byte stream, rewriting ids inside `message_start` events.
 *
 * Events are separated by a blank line. We buffer until at least one complete
 * event is available so that a network chunk boundary can never split an event
 * mid-JSON, which would otherwise corrupt the stream.
 */
export function rewriteSSEStream(
  upstream: ReadableStream<Uint8Array>,
  onRewrite?: (id: string) => void,
): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";

  const handle = (event: string): string => {
    const out = rewriteSSEEvent(event);
    if (out !== event && onRewrite) {
      const m = out.match(/"id":"(msg_[a-z0-9]+)"/);
      if (m) onRewrite(m[1]!);
    }
    return out;
  };

  return new ReadableStream({
    async start(controller) {
      const reader = upstream.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          let sep: number;
          while ((sep = buffer.indexOf("\n\n")) !== -1) {
            const event = buffer.slice(0, sep + 2);
            buffer = buffer.slice(sep + 2);
            controller.enqueue(encoder.encode(handle(event)));
          }
        }
        if (buffer) controller.enqueue(encoder.encode(handle(buffer)));
        controller.close();
      } catch (err) {
        controller.error(err);
      } finally {
        reader.releaseLock();
      }
    },
  });
}
