import assert from "node:assert/strict";

type Hit = { url: string; body: any; headers: Headers };
const hits: Hit[] = [];
const responses: Response[] = [];

globalThis.fetch = (async (input: any, init?: any) => {
  hits.push({ url: String(input), body: init?.body ? JSON.parse(init.body) : null, headers: new Headers(init?.headers) });
  return responses.shift() || new Response("missing mocked response", { status: 500 });
}) as typeof fetch;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json" },
});

async function main() {
  process.env.ROUTER_CHEAP_API_KEY = "test-key";
  const neon = await import("../server/router-cheap-neon.ts");

  responses.push(new Response(JSON.stringify({
    choices: [{
      message: {
        role: "assistant",
        content: null,
        tool_calls: [{
          id: "call-1",
          type: "function",
          function: { name: "apply_patch", arguments: "{\"filename\":\"index.html\"}" },
        }],
      },
      finish_reason: "tool_calls",
    }],
  }), { status: 200, headers: { "Content-Type": "application/json" } }));

  const result = await neon.routerCheapGeminiChatCompletion({
    contents: [{ role: "user", parts: [{ text: "Edit the page" }] }],
    systemPrompt: "You are a site agent.",
    tools: [{ name: "apply_patch", description: "Patch a page", input_schema: { type: "object", properties: { filename: { type: "string" } }, required: ["filename"], additionalProperties: false } }],
    forceToolUse: true,
  });
  assert.equal(hits[0].url, "https://router.cheap/v1/chat/completions");
  assert.equal(hits[0].headers.get("authorization"), "Bearer test-key");
  assert.equal(hits[0].body.model, "gemini-4-neon");
  assert.equal(hits[0].body.tool_choice, "required");
  assert.equal(hits[0].body.tools[0].function.name, "apply_patch");
  assert.equal(hits[0].body.messages[0].role, "system");
  assert.equal(result.functionCalls[0].name, "apply_patch");
  assert.deepEqual(result.functionCalls[0].args, { filename: "index.html" });
  assert.equal(result.modelParts[0].functionCall.id, "call-1");

  responses.push(json({ choices: [{ message: { role: "assistant", content: "Patch applied." }, finish_reason: "stop" }] }));
  await neon.routerCheapGeminiChatCompletion({
    contents: [
      { role: "user", parts: [{ text: "Edit the page" }] },
      { role: "model", parts: result.modelParts },
      { role: "user", parts: [{ functionResponse: { id: "call-1", name: "apply_patch", response: { ok: true } } }] },
    ],
    tools: [{ name: "apply_patch", description: "Patch a page", input_schema: { type: "object", properties: { filename: { type: "string" } } } }],
  });
  assert.deepEqual(hits[1].body.messages.map((m: any) => m.role), ["user", "assistant", "tool"]);
  assert.equal(hits[1].body.messages[1].tool_calls[0].id, "call-1");
  assert.equal(hits[1].body.messages[2].tool_call_id, "call-1");
  assert.deepEqual(JSON.parse(hits[1].body.messages[2].content), { ok: true });

  const encoder = new TextEncoder();
  responses.push(new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"Neon "}}]}\n\n'));
      controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"stream"}}]}\n\n'));
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  }), { status: 200, headers: { "Content-Type": "text/event-stream" } }));
  const chunks: string[] = [];
  for await (const chunk of neon.routerCheapGeminiGenerateStream({
    contents: [{ role: "user", parts: [{ text: "Generate a site" }] }],
  })) chunks.push(chunk);
  assert.equal(chunks.join(""), "Neon stream");
  assert.equal(hits[2].body.stream, true);
  assert.equal(hits[2].body.model, "gemini-4-neon");

  responses.push(json({ error: { message: "Neon provider unavailable" } }, 503));
  responses.push(json({ error: { message: "GPT provider unavailable" } }, 503));
  responses.push(json({ choices: [{ message: { role: "assistant", content: "Kimi fallback" }, finish_reason: "stop" }] }));
  const fallback = await neon.routerCheapGeminiChatCompletion({ contents: [{ role: "user", parts: [{ text: "Keep going" }] }] });
  assert.equal(fallback.text, "Kimi fallback");
  assert.deepEqual(hits.slice(3).map((hit) => hit.body.model), ["gemini-4-neon", "gpt-6.2-sol", "kimi-k3.1-pro"]);

  responses.push(json({ choices: [{ message: { role: "assistant", content: "Still on Kimi" }, finish_reason: "stop" }] }));
  const sticky = await neon.routerCheapGeminiChatCompletion({ contents: [{ role: "user", parts: [{ text: "Another step" }] }] });
  assert.equal(sticky.text, "Still on Kimi");
  assert.deepEqual(hits.slice(6).map((hit) => hit.body.model), ["kimi-k3.1-pro"]);

  console.log("router cheap Gemini V2 adapter: tool calling, tool results, streaming, and model fallback passed");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
