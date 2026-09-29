/**
 * Anthropic SDK client for agent V1 via router.cheap.
 *
 * Key: ROUTER_CHEAP_API_KEY (Amvera env only — never expose to the frontend).
 * Base URL: https://router.cheap (Anthropic Messages API compatible).
 * Context: 1M window via anthropic-beta header when the model supports it.
 * Default model: claude-opus-5-5 (override with ROUTER_CHEAP_MODEL);
 * auto-fallback to claude-opus-5 (ROUTER_CHEAP_FALLBACK_MODEL) when it has no channel.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { MessageParam, ContentBlockParam, Tool } from "@anthropic-ai/sdk/resources/messages";
import { KieApiError } from "./kie-errors";

export const ROUTER_CHEAP_BASE_URL =
  process.env.ROUTER_CHEAP_BASE_URL?.trim() || "https://router.cheap";

/** Prefer an Amvera override; default is Claude Opus 5.5 via router.cheap for agent V1. */
export const ROUTER_CHEAP_MODEL =
  process.env.ROUTER_CHEAP_MODEL?.trim() || "claude-opus-5-5";

/**
 * Used automatically when the primary model has no channel on router.cheap
 * (503 "no channel is currently available", 404 model_not_found, 529 overloaded).
 */
export const ROUTER_CHEAP_FALLBACK_MODEL =
  process.env.ROUTER_CHEAP_FALLBACK_MODEL?.trim() || "claude-opus-5";

const PRIMARY_COOLDOWN_MS = 5 * 60_000;
let primaryDownUntil = 0;

/** True when the router says the requested model/channel is unavailable (not a prompt error). */
export function isModelUnavailableError(err: unknown): boolean {
  const e = err as any;
  const status = Number(e?.status || e?.statusCode || 0);
  if (status === 503 || status === 404 || status === 529) return true;
  const msg = String(e?.message || e || "");
  return /no (available )?channel|model_not_found|model [^\n]{0,80}(not found|does not exist)|temporarily unavailable|overloaded/i.test(
    msg,
  );
}

/** Model that agent V1 will actually hit right now (primary unless it is cooling down). */
export function getActiveRouterCheapModel(): string {
  return Date.now() < primaryDownUntil ? ROUTER_CHEAP_FALLBACK_MODEL : ROUTER_CHEAP_MODEL;
}

function modelCandidates(explicit?: string): string[] {
  if (explicit && explicit !== ROUTER_CHEAP_MODEL) return [explicit];
  if (Date.now() < primaryDownUntil) return [ROUTER_CHEAP_FALLBACK_MODEL];
  return Array.from(new Set([ROUTER_CHEAP_MODEL, ROUTER_CHEAP_FALLBACK_MODEL]));
}

function markPrimaryDown(err: unknown): void {
  primaryDownUntil = Date.now() + PRIMARY_COOLDOWN_MS;
  const msg = String((err as any)?.message || err).slice(0, 200);
  console.warn(
    `[AGENT] ${ROUTER_CHEAP_MODEL} unavailable on router.cheap, using ${ROUTER_CHEAP_FALLBACK_MODEL} for ${PRIMARY_COOLDOWN_MS / 60_000} min:`,
    msg,
  );
}

async function withModelFallback<T>(explicit: string | undefined, fn: (model: string) => Promise<T>): Promise<T> {
  const candidates = modelCandidates(explicit);
  let lastErr: unknown;
  for (let i = 0; i < candidates.length; i++) {
    const model = candidates[i];
    try {
      return await fn(model);
    } catch (err) {
      lastErr = err;
      const hasNext = i < candidates.length - 1;
      if (model === ROUTER_CHEAP_MODEL && hasNext && isModelUnavailableError(err)) {
        markPrimaryDown(err);
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

/**
 * Output token cap for agent V1 (create/edit via tools or stream).
 * 32k covers full multipage HTML/patches on Opus without overshooting
 * typical model max_output limits; override with ROUTER_CHEAP_MAX_TOKENS.
 */
export const ROUTER_CHEAP_MAX_TOKENS = Math.max(
  1024,
  Number(process.env.ROUTER_CHEAP_MAX_TOKENS || 32000) || 32000,
);

/**
 * Tool rounds use a lower cap so the Anthropic SDK can use non-streaming
 * (avoids router.cheap "stream ended without producing a Message").
 * Non-streaming is allowed when expected wall time < ~10 min ≈ max_tokens ≲ 20k.
 */
export const ROUTER_CHEAP_TOOLS_MAX_TOKENS = Math.max(
  2048,
  Math.min(
    20000,
    Number(process.env.ROUTER_CHEAP_TOOLS_MAX_TOKENS || 12288) || 12288,
  ),
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
  const resp = await withModelFallback(opts.model, (model) =>
    anthropic.messages
      .stream({
        model,
        max_tokens: opts.maxTokens ?? ROUTER_CHEAP_MAX_TOKENS,
        system: opts.systemPrompt,
        messages: opts.messages,
      })
      .finalMessage(),
  );
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
  const candidates = modelCandidates(opts.model);
  for (let i = 0; i < candidates.length; i++) {
    const model = candidates[i];
    let yielded = false;
    try {
      const stream = anthropic.messages.stream({
        model,
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
          yielded = true;
          yield event.delta.text;
        }
      }
      return;
    } catch (err) {
      // Only switch models before any text reached the caller.
      const hasNext = i < candidates.length - 1;
      if (!yielded && model === ROUTER_CHEAP_MODEL && hasNext && isModelUnavailableError(err)) {
        markPrimaryDown(err);
        continue;
      }
      throw err;
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
  /** Prefer non-streaming (more reliable through router.cheap for tool rounds). */
  preferNonStreaming?: boolean;
}): Promise<RouterCheapToolRoundResult> {
  assertRouterCheapConfigured();

  const maxTokens = opts.maxTokens ?? ROUTER_CHEAP_TOOLS_MAX_TOKENS;
  // SDK blocks non-streaming when max_tokens implies >10 min; stay under that.
  const canNonStream = maxTokens <= 20000;
  const preferNonStream = opts.preferNonStreaming !== false && canNonStream;

  const buildRequest = (model: string) => ({
    model,
    max_tokens: maxTokens,
    system: opts.systemPrompt,
    messages: opts.messages,
    tools: opts.tools as Tool[],
    tool_choice: (opts.forceToolUse ? { type: "any" } : { type: "auto" }) as
      | { type: "any" }
      | { type: "auto" },
  });

  const toResult = (resp: { content: Anthropic.Messages.ContentBlock[]; stop_reason: string | null }): RouterCheapToolRoundResult => {
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
  };

  const runOnce = async (model: string): Promise<RouterCheapToolRoundResult> => {
    const requestBody = buildRequest(model);
    if (preferNonStream) {
      try {
        const resp = await anthropic.messages.create(requestBody);
        return toResult(resp);
      } catch (nonStreamErr: any) {
        const nsMsg = String(nonStreamErr?.message || nonStreamErr);
        // Fall through to streaming if router/SDK insists.
        if (!/streaming is required|non-streaming|timeout/i.test(nsMsg)) {
          throw nonStreamErr;
        }
        console.warn("[AGENT] Claude non-stream tools rejected, falling back to stream:", nsMsg.slice(0, 160));
      }
    }
    const resp = await anthropic.messages.stream(requestBody).finalMessage();
    return toResult(resp);
  };

  try {
    return await withModelFallback(opts.model, runOnce);
  } catch (err: any) {
    const status = Number(err?.status || err?.statusCode || 0);
    const msg = String(err?.message || err);
    // Tools rejected by the router → signal multipage stream fallback.
    // Don't treat "Streaming is required…" / empty-stream / missing channel as a tools rejection.
    if (
      (status === 400 || status === 422 || /tool/i.test(msg)) &&
      !isModelUnavailableError(err) &&
      !/streaming is required/i.test(msg) &&
      !/stream ended without producing/i.test(msg)
    ) {
      console.warn("[AGENT] Claude tools rejected by router.cheap:", status, msg.slice(0, 300));
      return { content: [], stop_reason: "tools_unsupported", toolsSupported: false };
    }
    // Router dropped the SSE mid-flight (common on long tool rounds / write_page).
    if (/stream ended without producing|without producing a message/i.test(msg)) {
      throw new KieApiError(
        `Claude stream ended without assistant message (router.cheap).`,
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
