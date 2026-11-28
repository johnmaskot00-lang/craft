import assert from "node:assert/strict";

let mode: "patch" | "write" | "invalid" | "error" | "partial" | "missing-finish" | "early-finish" = "patch";
const hits: Array<{ body: any }> = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = (async (_input: any, init?: any) => {
  const body = JSON.parse(init?.body || "{}");
  hits.push({ body });
  if (mode === "error") throw new Error("network down");

  const calls = mode === "write"
    ? [
        { id: "write-1", type: "function", function: { name: "write_page", arguments: JSON.stringify({ filename: "index.html", code: "<!doctype html><html><body><main><h1>New design</h1><p>Full page content replaced in one response.</p></main></body></html>" }) } },
        { id: "finish-1", type: "function", function: { name: "finish", arguments: JSON.stringify({ summary: "Page redesigned" }) } },
      ]
    : [{
        id: "apply-1",
        type: "function",
        function: {
          name: "apply_patch",
          arguments: JSON.stringify({ filename: "index.html", search: mode === "patch" ? "<p>Old text</p>" : "<p>Wrong</p>", replace: "<p>New text</p>" }),
        },
      }];
  if (mode === "partial" || mode === "missing-finish" || mode === "early-finish") {
    calls[0].function.arguments = JSON.stringify({ filename: "index.html", search: "<p>Old text</p>", replace: "<p>New text</p>" });
  }
  if (mode === "early-finish") {
    calls.unshift({ id: "early", type: "function", function: { name: "finish", arguments: JSON.stringify({ summary: "Edited" }) } });
  }
  if (mode === "partial") {
    calls.push(
      { id: "miss-1", type: "function", function: { name: "apply_patch", arguments: JSON.stringify({ filename: "index.html", search: "<p>Absent</p>", replace: "<p>Changed</p>" }) } },
      { id: "finish-1", type: "function", function: { name: "finish", arguments: JSON.stringify({ summary: "Two changes complete" }) } },
    );
  }
  return new Response(JSON.stringify({ choices: [{ finish_reason: "tool_calls", message: { role: "assistant", content: null, tool_calls: calls } }] }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}) as typeof fetch;

async function main() {
  process.env.ROUTER_CHEAP_API_KEY = "local-test-key";
  delete process.env.CRAFT_GEMINI_ROUTER_MODELS;
  process.env.DATABASE_URL = "postgres://localhost:5432/craft_test";
  const base = { quickPatch: true, fullRewrite: false, hasSelectedTarget: true, hasSeededSnippet: true, prompt: "Сделай текст белым" };
  const { shouldUseOneShotEdit, shouldUseSinglePassEdit } = await import("../server/edit-routing.ts");
  const { SITE_AGENT_ONESHOT_TOOLS, SITE_AGENT_SINGLE_PASS_TOOLS, runToolCallingAgent } = await import("../server/agent-runtime.ts");
  assert.equal(shouldUseOneShotEdit(base), true);
  assert.equal(shouldUseOneShotEdit({ ...base, hasSelectedTarget: false }), false);
  assert.equal(shouldUseOneShotEdit({ ...base, hasSeededSnippet: false }), false);
  assert.equal(shouldUseOneShotEdit({ ...base, fullRewrite: true }), false);
  assert.equal(shouldUseOneShotEdit({ ...base, quickPatch: false }), false);
  assert.equal(shouldUseOneShotEdit({ ...base, prompt: "Полностью переработай секцию" }), false);
  assert.equal(shouldUseOneShotEdit({ ...base, prompt: "Добавь новую анимацию и 3D сцену" }), false);
  assert.equal(shouldUseOneShotEdit({ ...base, prompt: "x".repeat(241) }), false);
  assert.equal(shouldUseSinglePassEdit({ isEditMode: true, mockupMode: false }), true);
  assert.equal(shouldUseSinglePassEdit({ isEditMode: false, mockupMode: false }), false);
  assert.equal(shouldUseSinglePassEdit({ isEditMode: true, mockupMode: true }), false);
  const { routerCheapGeminiModels } = await import("../server/router-cheap-neon.ts");
  assert.deepEqual(routerCheapGeminiModels(), ["gemini-4-neon", "gpt-6.2-sol", "kimi-k3.1-pro"]);
  assert.deepEqual(SITE_AGENT_ONESHOT_TOOLS.map((tool) => tool.name), ["apply_patch", "finish"]);
  assert.deepEqual(SITE_AGENT_SINGLE_PASS_TOOLS.map((tool) => tool.name), ["apply_patch", "write_page", "finish"]);

  const { buildSinglePassEditContext } = await import("../server/agent-runtime.ts");
  const seeded = buildSinglePassEditContext([
    { filename: "index.html", code: "<!doctype html><html><body><main>Home</main></body></html>" },
    { filename: "about.html", code: "<!doctype html><html><body><main>About</main></body></html>" },
    { filename: "assets/style.css", code: "body { color: black; }" },
  ], "about.html");
  assert.deepEqual(seeded.files, ["about.html", "assets/style.css", "index.html"]);
  assert.match(seeded.context, /FILE: about\.html[\s\S]*About/);
  assert.throws(() => buildSinglePassEditContext([], "index.html", 0), /maxTotalChars/);
  const oversized = buildSinglePassEditContext([
    { filename: "index.html", code: "x".repeat(200_001) },
    { filename: "about.html", code: "<html><body><p>Active file included</p></body></html>" },
  ], "about.html");
  assert.deepEqual(oversized.files, ["about.html"]);
  assert.match(oversized.context, /Active file included/);
  assert.doesNotMatch(oversized.context, /FILE: index\.html/);
  assert.throws(() => buildSinglePassEditContext([
    { filename: "index.html", code: "<html><body></body></html>" },
    { filename: "assets/style.css", code: "x".repeat(170_000) },
  ], "assets/style.css"), /exceeds the single-pass context budget/);

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

  mode = "write";
  hits.length = 0;
  const rewrite = await runToolCallingAgent({
    provider: "gemini",
    singlePass: true,
    maxRounds: 8,
    preReadFiles: ["index.html"],
    systemPrompt: "Rewrite from the supplied source in this response.",
    userPrompt: "Полностью переделай страницу.",
    pages: [{ filename: "index.html", code: "<!doctype html><html><body><p>Old text</p></body></html>" }],
    craftMd: "",
  });
  assert.equal(hits.length, 1, "full rewrite must be one model request");
  assert.equal(hits[0].body.tool_choice, "required");
  assert.deepEqual([...rewrite.changedFiles.keys()], ["index.html"]);
  assert.match(rewrite.changedFiles.get("index.html") || "", /New design/);
  assert.equal(rewrite.ok, true);

  hits.length = 0;
  mode = "partial";
  await assert.rejects(runToolCallingAgent({
    provider: "gemini",
    singlePass: true,
    maxRounds: 8,
    preReadFiles: ["index.html"],
    systemPrompt: "Apply both patches.",
    userPrompt: "Change two paragraphs.",
    pages: [{ filename: "index.html", code: "<!doctype html><html><body><p>Old text</p></body></html>" }],
    craftMd: "",
  }), /apply_patch|SEARCH/i, "a failed tool must invalidate the whole batch");
  assert.equal(hits.length, 1);

  const paragraphEdit = {
    provider: "gemini" as const, singlePass: true, preReadFiles: ["index.html"],
    systemPrompt: "Apply the patch, then finish.", userPrompt: "Change the paragraph.", craftMd: "",
    pages: [{ filename: "index.html", code: "<!doctype html><html><body><p>Old text</p></body></html>" }],
  };
  mode = "missing-finish";
  hits.length = 0;
  const completedBatch = await runToolCallingAgent(paragraphEdit);
  assert.match(completedBatch.changedFiles.get("index.html") || "", /<p>New text<\/p>/);
  assert.equal(hits.length, 1, "a complete tool response needs no follow-up summary call");

  mode = "early-finish";
  hits.length = 0;
  await assert.rejects(runToolCallingAgent(paragraphEdit), /finish/i, "finish must follow any mutations");
  assert.equal(hits.length, 1);

  hits.length = 0;
  mode = "invalid";
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

  hits.length = 0;
  mode = "error";
  await assert.rejects(
    runToolCallingAgent({
      provider: "claude",
      singlePass: true,
      maxRounds: 8,
      systemPrompt: "Force a failed call.",
      userPrompt: "Edit the page.",
      pages: [{ filename: "index.html", code: "<!doctype html><html><body><p>Old text</p></body></html>" }],
      craftMd: "",
    }),
    /Connection error/,
  );
  assert.equal(hits.length, 1, "single-pass Claude must not retry a failed provider call internally");
  globalThis.fetch = originalFetch;
  console.log("single-pass editor: one request, immediate mutation, and fail-fast behavior passed");
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
