import assert from "node:assert/strict";

const hits: Array<{ body: any }> = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = (async (_input: any, init?: any) => {
  const body = JSON.parse(init?.body || "{}");
  hits.push({ body });
  const call = {
    id: "apply-1",
    type: "function",
    function: {
      name: "apply_patch",
      arguments: JSON.stringify({ filename: "index.html", search: "<p>Old text</p>", replace: "<p>New text</p>" }),
    },
  };
  return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: null, tool_calls: [call] } }] }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}) as typeof fetch;

async function main() {
  process.env.ROUTER_CHEAP_API_KEY = "local-test-key";
  process.env.DATABASE_URL = "postgres://localhost:5432/craft_test";
  const base = { quickPatch: true, fullRewrite: false, hasSelectedTarget: true, hasSeededSnippet: true, prompt: "Сделай текст белым" };
  const { shouldUseOneShotEdit } = await import("../server/edit-routing.ts");
  const { SITE_AGENT_ONESHOT_TOOLS, runToolCallingAgent } = await import("../server/agent-runtime.ts");
  assert.equal(shouldUseOneShotEdit(base), true);
  assert.equal(shouldUseOneShotEdit({ ...base, hasSelectedTarget: false }), false);
  assert.equal(shouldUseOneShotEdit({ ...base, hasSeededSnippet: false }), false);
  assert.equal(shouldUseOneShotEdit({ ...base, fullRewrite: true }), false);
  assert.equal(shouldUseOneShotEdit({ ...base, quickPatch: false }), false);
  assert.equal(shouldUseOneShotEdit({ ...base, prompt: "Полностью переработай секцию" }), false);
  assert.equal(shouldUseOneShotEdit({ ...base, prompt: "Добавь новую анимацию и 3D сцену" }), false);
  assert.equal(shouldUseOneShotEdit({ ...base, prompt: "x".repeat(241) }), false);
  assert.deepEqual(SITE_AGENT_ONESHOT_TOOLS.map((tool) => tool.name), ["apply_patch", "finish"]);

  const statuses: string[] = [];
  const result = await runToolCallingAgent({
    provider: "gemini",
    oneShot: true,
    maxRounds: 1,
    tools: SITE_AGENT_ONESHOT_TOOLS,
    preReadFiles: ["index.html"],
    systemPrompt: "Apply the exact patch in one call.",
    userPrompt: "Replace the selected text.",
    pages: [{ filename: "index.html", code: "<!doctype html><html><body><p>Old text</p></body></html>" }],
    craftMd: "",
    onStatus: (status) => statuses.push(status),
  });
  assert.equal(hits.length, 1, "one-shot agent must make exactly one model request");
  assert.equal(hits[0].body.tool_choice, "required", "one-shot must force a tool call");
  assert.equal(result.changedFiles.get("index.html"), "<!doctype html><html><body><p>New text</p></body></html>");
  assert.ok(statuses.includes("Gemini правит… (1 запрос)"));

  hits.length = 0;
  globalThis.fetch = (async (_input: any, init?: any) => {
    const body = JSON.parse(init?.body || "{}");
    hits.push({ body });
    const call = {
      id: "invalid-apply",
      type: "function",
      function: {
        name: "apply_patch",
        arguments: JSON.stringify({ filename: "index.html", search: "<p>Wrong</p>", replace: "<p>New text</p>" }),
      },
    };
    return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: null, tool_calls: [call] } }] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  const failedPatch = await runToolCallingAgent({
    provider: "gemini",
    oneShot: true,
    maxRounds: 1,
    tools: SITE_AGENT_ONESHOT_TOOLS,
    preReadFiles: ["index.html"],
    systemPrompt: "Apply the patch.",
    userPrompt: "Replace text.",
    pages: [{ filename: "index.html", code: "<!doctype html><html><body><p>Old text</p></body></html>" }],
    craftMd: "",
  });
  assert.equal(hits.length, 1, "a failed patch is surfaced after one round for the caller's safe escalation path");
  assert.equal(failedPatch.changedFiles.size, 0, "a failed patch must never be reported as applied");
  assert.equal(failedPatch.ok, false);

  globalThis.fetch = originalFetch;
  console.log("one-shot editor: applied patch and failed patch reporting passed");
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
