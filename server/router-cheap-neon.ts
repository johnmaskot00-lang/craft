const ROUTER_CHEAP_BASE_URL = "https://router.cheap/v1/chat/completions";
const DEFAULT_MODELS = ["gemini-4-neon", "gpt-6.2-sol", "kimi-k3.1-pro"];
const MODEL_COOLDOWN_MS = Math.max(30_000, Number(process.env.CRAFT_GEMINI_ROUTER_COOLDOWN_MS) || 5 * 60_000);
const REQUEST_TIMEOUT_MS = Math.max(30_000, Number(process.env.CRAFT_GEMINI_ROUTER_TIMEOUT_MS) || 4 * 60_000);

type GeminiPart = Record<string, any>;
type GeminiContent = { role: "user" | "model"; parts: GeminiPart[] };
type OpenAiTool = { type: "function"; function: { name: string; description?: string; parameters: Record<string, any> } };
type ToolCall = { name: string; args: Record<string, unknown>; id?: string };

type ChatOptions = {
  contents: GeminiContent[];
  systemPrompt?: string;
  tools?: readonly any[];
  forceToolUse?: boolean;
  singleAttempt?: boolean;
  model?: string;
  timeoutMs?: number;
  streamTools?: boolean;
  temperature?: number;
  maxTokens?: number;
};

type ChatResult = {
  text: string;
  functionCalls: ToolCall[];
  modelParts: GeminiPart[];
  toolsSupported: boolean;
  model: string;
};

const cooldowns = new Map<string, number>();

export function routerCheapGeminiModels(): string[] {
  const configured = process.env.CRAFT_GEMINI_ROUTER_MODELS?.trim();
  const models = (configured ? configured.split(",") : DEFAULT_MODELS).map((v) => v.trim()).filter(Boolean);
  return Array.from(new Set(models));
}

export function resetRouterCheapGeminiCooldowns(): void {
  cooldowns.clear();
}

function modelCandidates(): string[] {
  const models = routerCheapGeminiModels();
  const now = Date.now();
  const available = models.filter((model) => (cooldowns.get(model) || 0) <= now);
  return available.length ? [...available, ...models.filter((model) => !available.includes(model))] : models;
}

function markModelDown(model: string, err: unknown): void {
  cooldowns.set(model, Date.now() + MODEL_COOLDOWN_MS);
  const message = String((err as any)?.message || err).slice(0, 200);
  console.warn(`[AGENT] Router Cheap model ${model} failed; cooling down for ${Math.round(MODEL_COOLDOWN_MS / 60_000)} min:`, message);
}

function isTerminalRequestError(err: unknown): boolean {
  const e = err as any;
  const status = Number(e?.status || e?.statusCode || 0);
  const message = String(e?.message || err || "");
  if (status === 401 || status === 403) return true;
  if ((status === 400 || status === 422) && !/tool|function|model|channel|unsupported|unavailable|not found|not available/i.test(message)) return true;
  return false;
}

function openAiTools(tools: readonly any[]): OpenAiTool[] {
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.input_schema || tool.function?.parameters || { type: "object", properties: {} },
    },
  }));
}

function toOpenAiMessages(contents: GeminiContent[], systemPrompt = ""): any[] {
  const messages: any[] = [];
  if (systemPrompt) messages.push({ role: "system", content: systemPrompt });

  const matchedCallIds = new Set<string>();
  for (const turn of contents) {
    const role = turn.role === "model" ? "assistant" : "user";
    const textParts: string[] = [];
    const imageParts: any[] = [];
    const calls: any[] = [];
    const results: any[] = [];

    for (const part of turn.parts || []) {
      if (typeof part.text === "string" && part.text) textParts.push(part.text);
      const inline = part.inline_data || part.inlineData;
      if (inline?.data) {
        const mime = inline.mime_type || inline.mimeType;
        if (mime) imageParts.push({ type: "image_url", image_url: { url: `data:${mime};base64,${inline.data}` } });
      }
      const file = part.file_data || part.fileData;
      if (file?.file_uri || file?.fileUri) imageParts.push({ type: "image_url", image_url: { url: file.file_uri || file.fileUri } });

      const call = part.functionCall || part.function_call;
      if (call?.name) {
        calls.push({
          id: call.id || `call_${calls.length}_${call.name}`,
          type: "function",
          function: { name: call.name, arguments: JSON.stringify(call.args || call.arguments || {}) },
        });
      }

      const response = part.functionResponse || part.function_response;
      if (response?.name) {
        const explicitId = String(response.id || "");
        const previous = [...messages].reverse().find((message) => message.role === "assistant" && message.tool_calls);
        const matchIndex = previous?.tool_calls?.findIndex((candidate: any) =>
          candidate.function.name === response.name &&
          !matchedCallIds.has(String(candidate.id || "")) &&
          (!explicitId || candidate.id === explicitId),
        ) ?? -1;
        const toolCallId = explicitId || (matchIndex >= 0 ? String(previous.tool_calls[matchIndex].id || "") : "");
        if (toolCallId) matchedCallIds.add(toolCallId);
        results.push({
          role: "tool",
          tool_call_id: toolCallId,
          name: response.name,
          content: JSON.stringify(response.response ?? {}),
        });
      }
    }

    if (calls.length) messages.push({ role: "assistant", content: textParts.join("\n") || null, tool_calls: calls });
    else if (textParts.length || imageParts.length) {
      messages.push({
        role,
        content: imageParts.length
          ? [...(textParts.length ? [{ type: "text", text: textParts.join("\n") }] : []), ...imageParts]
          : textParts.join("\n"),
      });
    }
    for (const result of results) {
      if (!result.tool_call_id) {
        const previous = [...messages].reverse().find((message) => message.role === "assistant" && message.tool_calls);
        const matchIndex = previous?.tool_calls?.findIndex((call: any) => call.function.name === result.name && !call._matched) ?? -1;
        const matching = matchIndex >= 0 ? previous.tool_calls[matchIndex] : undefined;
        if (matching) {
          matching._matched = true;
          result.tool_call_id = matching.id;
        }
      }
      delete result._matched;
      messages.push(result);
    }
  }
  return messages;
}

function parseError(status: number, body: string): Error & { status: number } {
  let message = body.slice(0, 700) || `HTTP ${status}`;
  try {
    const parsed = JSON.parse(body);
    message = String(parsed?.error?.message || parsed?.message || parsed?.msg || message);
  } catch { /* keep the raw response */ }
  return Object.assign(new Error(`Router Cheap HTTP ${status}: ${message}`), { status });
}

function requireRouterCheapKey(): string {
  const key = process.env.ROUTER_CHEAP_API_KEY?.trim();
  if (!key) throw new Error("ROUTER_CHEAP_API_KEY missing — Gemini V2 Router Cheap is not configured");
  return key;
}

const MAX_EDITOR_STREAM_BYTES = 4 * 1024 * 1024;
const MAX_EDITOR_TOOL_CALLS = 64;
const invalidCompletion = (message: string, cause?: unknown) =>
  Object.assign(new Error(message, { cause }), { status: 502 });

/** Assemble one OpenAI-compatible response without exposing partial tool calls. */
async function readToolStream(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) throw invalidCompletion("Router Cheap returned an empty tool stream");
  const decoder = new TextDecoder();
  const toolCalls = new Map<number, { id: string; type: string; function: { name: string; arguments: string } }>();
  let buffer = "";
  let text = "";
  let finishReason: string | undefined;
  let bytes = 0;
  let done = false;
  const readLine = (line: string) => {
    if (!line.startsWith("data:")) return;
    const value = line.slice(5).trim();
    if (value === "[DONE]") { done = true; return; }
    let event;
    try { event = JSON.parse(value); }
    catch { throw invalidCompletion("Router Cheap returned a malformed tool event"); }
    if (event?.error) throw parseError(Number(event.error.code) || 502, value);
    const choice = event?.choices?.[0];
    if (!choice) return; // Provider metadata and usage events.
    if (choice.finish_reason != null) finishReason = choice.finish_reason;
    const delta = choice.delta;
    if (delta?.refusal) throw Object.assign(new Error("Router Cheap refused the request"), { status: 403 });
    if (typeof delta?.content === "string") text += delta.content;
    if (delta?.tool_calls != null && !Array.isArray(delta.tool_calls)) {
      throw invalidCompletion("Router Cheap returned an invalid tool delta");
    }
    for (const part of delta?.tool_calls ?? []) {
      const index = part?.index;
      if (!Number.isInteger(index) || index < 0 || index >= MAX_EDITOR_TOOL_CALLS) {
        throw invalidCompletion("Router Cheap returned an invalid tool index");
      }
      const call = toolCalls.get(index) ?? { id: "", type: "function", function: { name: "", arguments: "" } };
      if (typeof part.id === "string") call.id = part.id;
      if (typeof part.type === "string") call.type = part.type;
      if (typeof part.function?.name === "string") call.function.name += part.function.name;
      if (typeof part.function?.arguments === "string") call.function.arguments += part.function.arguments;
      toolCalls.set(index, call);
    }
  };
  try {
    while (!done) {
      const chunk = await reader.read().catch((cause) => {
        throw invalidCompletion("Router Cheap tool stream was interrupted", cause);
      });
      if (chunk.done) {
        readLine(buffer + decoder.decode());
        break;
      }
      bytes += chunk.value.byteLength;
      if (bytes > MAX_EDITOR_STREAM_BYTES) throw invalidCompletion("Router Cheap tool stream exceeded its size limit");
      buffer += decoder.decode(chunk.value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        readLine(line);
        if (done) break;
      }
    }
    if (!done || !finishReason) throw invalidCompletion("Router Cheap tool stream ended before completion");
    const ordered = [...toolCalls.entries()].sort(([a], [b]) => a - b);
    if (ordered.some(([index], position) => index !== position)) {
      throw invalidCompletion("Router Cheap returned an incomplete tool list");
    }
    return { choices: [{ finish_reason: finishReason, message: { content: text, tool_calls: ordered.map(([, call]) => call) } }] };
  } finally {
    void reader.cancel().catch(() => undefined);
  }
}

async function requestJson(model: string, options: ChatOptions): Promise<ChatResult> {
  const key = requireRouterCheapKey();

  const body: Record<string, any> = {
    model,
    messages: toOpenAiMessages(options.contents, options.systemPrompt),
    temperature: options.temperature ?? 0.2,
    max_tokens: options.maxTokens ?? 32_000,
    ...(options.streamTools ? { stream: true } : {}),
  };
  if (options.tools?.length) {
    body.tools = openAiTools(options.tools);
    body.tool_choice = options.forceToolUse ? "required" : "auto";
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? REQUEST_TIMEOUT_MS);
  timer.unref?.();
  try {
    const response = await fetch(ROUTER_CHEAP_BASE_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
      ...(options.singleAttempt ? { redirect: "error" } : {}),
    });
    if (!response.ok) throw parseError(response.status, await response.text());

    const isEventStream = /^text\/event-stream\b/i.test(response.headers.get("content-type") || "");
    const data = options.streamTools && isEventStream
      ? await readToolStream(response)
      : await response.json().catch((err) => {
          if (controller.signal.aborted) throw err;
          throw invalidCompletion("Router Cheap returned invalid JSON");
        });
    if (data?.error) throw parseError(Number(data.error.code) || 502, JSON.stringify(data));
    const choice = data?.choices?.[0];
    const message = choice?.message;
    if (!message || typeof message !== "object") throw invalidCompletion("Router Cheap returned an empty completion");
    if (options.singleAttempt && !["tool_calls", "stop", "function_call"].includes(choice.finish_reason)) {
      throw new Error("Router Cheap did not complete the tool response");
    }
    if (options.singleAttempt && message.tool_calls != null && !Array.isArray(message.tool_calls)) {
      throw new Error("Router Cheap returned an invalid tool list");
    }

    const functionCalls: ToolCall[] = [];
    const modelParts: GeminiPart[] = [];
    if (typeof message.content === "string" && message.content) modelParts.push({ text: message.content });
    for (const call of message.tool_calls || []) {
      const name = String(call?.function?.name || "");
      if (options.singleAttempt && (call?.type !== "function" || typeof call.function?.name !== "string" || !name.trim())) {
        throw new Error("Router Cheap returned an invalid tool call");
      }
      if (!name) continue;
      let args: Record<string, unknown> = {};
      try {
        const parsed = JSON.parse(String(call.function.arguments || "{}"));
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) args = parsed;
        else if (options.singleAttempt) throw new Error("Invalid arguments");
      } catch {
        if (options.singleAttempt) throw new Error("Router Cheap returned invalid tool arguments");
        // Legacy agent can correct malformed arguments in another round.
      }
      const id = String(call.id || "");
      functionCalls.push({ name, args, id });
      modelParts.push({ functionCall: { id, name, args } });
    }
    return { text: typeof message.content === "string" ? message.content : "", functionCalls, modelParts, toolsSupported: true, model };
  } finally {
    clearTimeout(timer);
  }
}

export async function routerCheapGeminiChatCompletion(options: ChatOptions): Promise<ChatResult> {
  requireRouterCheapKey();
  if (options.singleAttempt) {
    const model = options.model ?? routerCheapGeminiModels()[0];
    if (!model) throw new Error("Router Cheap: no editor model configured");
    return requestJson(model, options);
  }
  let lastError: unknown;
  for (const model of modelCandidates()) {
    try {
      return await requestJson(model, options);
    } catch (err) {
      lastError = err;
      if (isTerminalRequestError(err)) throw err;
      markModelDown(model, err);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function* streamModel(model: string, options: Omit<ChatOptions, "tools" | "forceToolUse">): AsyncGenerator<string> {
  const key = requireRouterCheapKey();
  const body = {
    model,
    messages: toOpenAiMessages(options.contents, options.systemPrompt),
    temperature: options.temperature ?? 0.7,
    max_tokens: options.maxTokens ?? 32_000,
    stream: true,
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  timer.unref?.();
  let text = "";
  try {
    const response = await fetch(ROUTER_CHEAP_BASE_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) throw parseError(response.status, await response.text());
    if (!response.body) throw new Error("Router Cheap returned an empty stream");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let done = false;
    while (!done) {
      const next = await reader.read();
      if (next.done) break;
      buffer += decoder.decode(next.value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const value = trimmed.slice(5).trim();
        if (value === "[DONE]") { done = true; break; }
        let event: any;
        try { event = JSON.parse(value); } catch { continue; }
        if (event?.error) throw new Error(String(event.error.message || event.error));
        const delta = event?.choices?.[0]?.delta?.content;
        if (typeof delta === "string" && delta) text += delta;
      }
    }
    if (!text.trim()) throw new Error("Router Cheap returned an empty stream completion");
    yield text;
  } catch (err) {
    if (isTerminalRequestError(err)) throw err;
    markModelDown(model, err);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export async function* routerCheapGeminiGenerateStream(options: Omit<ChatOptions, "tools" | "forceToolUse">): AsyncGenerator<string> {
  requireRouterCheapKey();
  const models = modelCandidates();
  let lastError: unknown;
  for (const model of models) {
    try {
      yield* streamModel(model, options);
      return;
    } catch (err) {
      lastError = err;
      if (isTerminalRequestError(err)) throw err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
