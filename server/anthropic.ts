/**
 * Anthropic SDK client for agent V1 via router.cheap.
 *
 * Key: ROUTER_CHEAP_API_KEY (Amvera env only — never expose to the frontend).
 * Base URL: https://router.cheap (Anthropic Messages API compatible).
 * Context: 1M window via anthropic-beta header when the model supports it.
 * Default model: claude-opus-5 (override with ROUTER_CHEAP_MODEL).
 */

import Anthropic from "@anthropic-ai/sdk";
import type { MessageParam, ContentBlockParam, Tool } from "@anthropic-ai/sdk/resources/messages";
import { KieApiError } from "./kie-errors";

export const ROUTER_CHEAP_BASE_URL =
  process.env.ROUTER_CHEAP_BASE_URL?.trim() || "https://router.cheap";

/** Prefer an Amvera override; default is Claude Opus 5 via router.cheap for agent V1. */
export const ROUTER_CHEAP_MODEL =
  process.env.ROUTER_CHEAP_MODEL?.trim() || "claude-opus-5";

/**
 * Output token cap for agent V1 (create/edit via tools or stream).
 * 32k covers full multipage HTML/patches on Opus without overshooting
 * typical model max_output limits; override with ROUTER_CHEAP_MAX_TOKENS.
 */
export const ROUTER_CHEAP_MAX_TOKENS = Math.max(
  1024,
  Number(process.env.ROUTER_CHEAP_MAX_TOKENS || 32000) || 32000,
);

// Opus can legitimately spend several minutes producing a large patch/tool round.
// The SDK default timeout otherwise surfaces as the unhelpful "Request timed out".
export const ROUTER_CHEAP_TIMEOUT_MS = Math.max(
  120_000,
  Number(process.env.ROUTER_CHEAP_TIMEOUT_MS || 30 * 60 * 1000) || 30 * 60 * 1000,
);

export const KIMI_K3_MODEL = process.env.KIMI_K3_MODEL?.trim() || "kimi-k3";
export const KIMI_K3_TIMEOUT_MS = Math.max(
  30_000,
  Number(process.env.KIMI_K3_TIMEOUT_MS || 10 * 60 * 1000) || 10 * 60 * 1000,
);

const apiKey = process.env.ROUTER_CHEAP_API_KEY?.trim();
if (!apiKey) {
  console.warn(
    "ROUTER_CHEAP_API_KEY not set — Anthropic/router.cheap agent V1/Kimi will not work. Set it in Amvera env.",
  );
}

/** Server-only Anthropic client pointed at router.cheap (1M context beta). */
export const anthropic = new Anthropic({
  apiKey: apiKey || "placeholder",
  baseURL: ROUTER_CHEAP_BASE_URL,
  timeout: ROUTER_CHEAP_TIMEOUT_MS,
  defaultHeaders: {
    // Match Router Cheap's documented curl exactly.
    "x-api-key": apiKey || "placeholder",
    "anthropic-version": "2023-06-01",
    "anthropic-beta": "context-1m-2025-08-07",
  },
});

export function assertRouterCheapConfigured(): void {
  if (!process.env.ROUTER_CHEAP_API_KEY?.trim()) {
    throw new Error("ROUTER_CHEAP_API_KEY missing");
  }
}

export function isRouterCheapConfigured(): boolean {
  return Boolean(process.env.ROUTER_CHEAP_API_KEY?.trim());
}

export type AgentClaudeContent =
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "url"; url: string } }
  | { type: "image"; source: { type: "base64"; media_type: string; data: string } }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string };

export type AgentClaudeMessage = {
  role: "user" | "assistant";
  content: string | AgentClaudeContent[];
};

/** Non-streaming text generation for agent V1 (Claude via router.cheap). */
export async function routerCheapGenerateSync(opts: {
  messages: MessageParam[];
  systemPrompt: string;
  maxTokens?: number;
  model?: string;
}): Promise<string> {
  assertRouterCheapConfigured();
  // SDK requires streaming when max_tokens implies >10 min wall time
  // (expected ≈ 60min * max_tokens / 128000). Use stream→finalMessage.
  const resp = await anthropic.messages
    .stream({
      model: opts.model || ROUTER_CHEAP_MODEL,
      max_tokens: opts.maxTokens ?? ROUTER_CHEAP_MAX_TOKENS,
      system: opts.systemPrompt,
      messages: opts.messages,
    })
    .finalMessage();
  let text = "";
  for (const block of resp.content) {
    if (block.type === "text") text += block.text;
  }
  return text;
}

/** Streaming text generation for agent V1. Yields text deltas. */
export async function* routerCheapGenerateStream(opts: {
  messages: MessageParam[];
  systemPrompt: string;
  maxTokens?: number;
  model?: string;
}): AsyncGenerator<string> {
  assertRouterCheapConfigured();
  const stream = anthropic.messages.stream({
    model: opts.model || ROUTER_CHEAP_MODEL,
    max_tokens: opts.maxTokens ?? ROUTER_CHEAP_MAX_TOKENS,
    system: opts.systemPrompt,
    messages: opts.messages,
  });

  for await (const event of stream) {
    if (
      event.type === "content_block_delta" &&
      event.delta.type === "text_delta" &&
      event.delta.text
    ) {
      yield event.delta.text;
    }
  }
}


/** OpenAI-compatible Kimi K3 fallback on the same router. */
export async function kimiK3GenerateSync(opts: {
  messages: MessageParam[];
  systemPrompt: string;
  maxTokens?: number;
}): Promise<string> {
  const key = process.env.ROUTER_CHEAP_API_KEY?.trim();
  if (!key) throw new Error("ROUTER_CHEAP_API_KEY missing — Kimi fallback unavailable");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), KIMI_K3_TIMEOUT_MS);
  timer.unref?.();
  try {
    const messages = [
      ...(opts.systemPrompt ? [{ role: "system", content: opts.systemPrompt }] : []),
      ...opts.messages.map((m: any) => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: typeof m.content === "string"
          ? m.content
          : (m.content || []).map((c: any) => {
              if (c.type === "text" || c.type === "input_text") return { type: "text", text: c.text || "" };
              if (c.type === "image" && c.source?.type === "url") return { type: "image_url", image_url: { url: c.source.url } };
              if (c.type === "input_image" && c.image_url) return { type: "image_url", image_url: { url: c.image_url } };
              if (c.type === "image" && c.source?.type === "base64") return { type: "image_url", image_url: { url: `data:${c.source.media_type};base64,${c.source.data}` } };
              if (c.type === "input_image_inline") return { type: "image_url", image_url: { url: `data:${c.mime_type};base64,${c.base64}` } };
              return { type: "text", text: "" };
            }),
      })),
    ];
    const resp = await fetch(`${ROUTER_CHEAP_BASE_URL.replace(/\/$/, "")}/v1/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: KIMI_K3_MODEL, messages, temperature: 0.2, max_tokens: opts.maxTokens ?? ROUTER_CHEAP_MAX_TOKENS }),
      signal: controller.signal,
    });
    const raw = await resp.text();
    let data: any = null;
    try { data = JSON.parse(raw); } catch { /* handled below */ }
    if (!resp.ok) throw new Error(`Kimi K3 HTTP ${resp.status}: ${raw.slice(0, 500)}`);
    const text = data?.choices?.[0]?.message?.content;
    if (typeof text !== "string" || !text.trim()) throw new Error("Kimi K3 returned an empty response");
    return text;
  } finally {
    clearTimeout(timer);
  }
}

export type RouterCheapToolRoundResult = {
  content: Array<
    | { type: "text"; text: string }
    | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  >;
  stop_reason: string;
  toolsSupported: boolean;
};

/** One tool-calling round for agent V1 (Claude Messages tools via Anthropic SDK). */
export async function routerCheapToolsRound(opts: {
  messages: MessageParam[];
  systemPrompt: string;
  tools: readonly Tool[] | readonly any[];
  maxTokens?: number;
  model?: string;
  /** Force at least one tool call (Replit oneshot: apply_patch+finish in one round). */
  forceToolUse?: boolean;
}): Promise<RouterCheapToolRoundResult> {
  assertRouterCheapConfigured();

  try {
    // Must stream: non-streaming is blocked by the SDK when max_tokens is high
    // (see calculateNonstreamingTimeout). finalMessage() still returns full tool_use.
    const resp = await anthropic.messages
      .stream({
        model: opts.model || ROUTER_CHEAP_MODEL,
        max_tokens: opts.maxTokens ?? ROUTER_CHEAP_MAX_TOKENS,
        system: opts.systemPrompt,
        messages: opts.messages,
        tools: opts.tools as Tool[],
        tool_choice: opts.forceToolUse ? { type: "any" } : { type: "auto" },
      })
      .finalMessage();

    const content: RouterCheapToolRoundResult["content"] = [];
    for (const block of resp.content) {
      if (block.type === "text" && block.text) {
        content.push({ type: "text", text: block.text });
      } else if (block.type === "tool_use") {
        const input =
          block.input && typeof block.input === "object"
            ? (block.input as Record<string, unknown>)
            : {};
        content.push({
          type: "tool_use",
          id: block.id,
          name: block.name,
          input,
        });
      }
    }

    return {
      content,
      stop_reason: resp.stop_reason || "end_turn",
      toolsSupported: true,
    };
  } catch (err: any) {
    const status = Number(err?.status || err?.statusCode || 0);
    const msg = String(err?.message || err);
    // Tools rejected by the router → signal multipage stream fallback.
    // Don't treat "Streaming is required…" as a tools rejection.
    if (
      (status === 400 || status === 422 || /tool/i.test(msg)) &&
      !/streaming is required/i.test(msg) &&
      !/stream ended without producing/i.test(msg)
    ) {
      console.warn("[AGENT] Claude tools rejected by router.cheap:", status, msg.slice(0, 300));
      return { content: [], stop_reason: "tools_unsupported", toolsSupported: false };
    }
    // Router dropped the SSE mid-flight (common on long tool rounds / write_page).
    if (/stream ended without producing|without producing a message/i.test(msg)) {
      throw new KieApiError(
        `Claude stream ended without assistant message (router.cheap). Retry or use Gemini.`,
        { source: "http", cause: err },
      );
    }
    if (/request timed out|timed?\s*out|timeout of \d+ms/i.test(msg)) {
      throw new KieApiError(`Claude tools request timed out (router.cheap).`, {
        source: "http",
        cause: err,
      });
    }
    throw err;
  }
}

export type { MessageParam, ContentBlockParam, Tool };
