// Run: node --import tsx tests/kie-gemini-model.itest.ts
// Gemini 3.8 Flash everywhere, with a sticky fallback to 3.7 when KIE rejects 3.8.
import assert from "node:assert/strict";

type Hit = { url: string; body: any };
const hits: Hit[] = [];
/** model id → canned reply */
const reply = new Map<string, () => Response>();
const ok = (text: string) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), { status: 200 });
globalThis.fetch = (async (input: any, init?: any) => {
  const url = String(input);
  hits.push({ url, body: init?.body ? JSON.parse(init.body) : null });
  const model = url.match(/models\/([^:]+):/)?.[1] || "";
  return (reply.get(model) || (() => ok(`hi from ${model}`)))();
}) as typeof fetch;

async function main() {
  process.env.KIE_API_KEY = "test";
  process.env.CRAFT_GEMINI_ATTEMPTS = "2";
  const kg = await import("../server/kie-gemini.ts");
  const { gemini } = await import("../server/gemini.ts");
  let pass = 0;
  const done = (m: string) => { pass++; console.log("  ✓", m); };

  assert.equal(kg.KIE_GEMINI_MODEL, "gemini-3-8-flash");
  assert.equal(kg.KIE_GEMINI_FALLBACK_MODEL, "gemini-3-7-flash");
  assert.equal(kg.activeKieGeminiModel(), "gemini-3-8-flash");
  assert.equal(kg.KIE_GEMINI_SYNC_URL, "https://api.kie.ai/gemini/v1/models/gemini-3-8-flash:generateContent");
  assert.equal(kg.KIE_GEMINI_STREAM_URL, "https://api.kie.ai/gemini/v1/models/gemini-3-8-flash:streamGenerateContent");
  done("default model is gemini-3-8-flash (KIE URLs)");

  // Vision adapter: Google-SDK shape in, KIE format out, text back.
  const r = await gemini.models.generateContent({
    model: "ignored",
    contents: [{ role: "user", parts: [{ text: "q" }, { inlineData: { data: "QUJD", mimeType: "image/png" } }] }],
  });
  assert.equal(r.text, "hi from gemini-3-8-flash");
  assert.match(hits.at(-1)!.url, /gemini-3-8-flash:generateContent$/);
  assert.deepEqual(hits.at(-1)!.body.contents[0].parts, [{ text: "q" }, { inline_data: { mime_type: "image/png", data: "QUJD" } }]);
  done("vision calls go through KIE 3.8 with inline_data");

  // Transient errors are retried on the SAME model (no needless downgrade).
  let flaky = 1;
  reply.set("gemini-3-8-flash", () => (flaky-- > 0 ? new Response("bad gateway", { status: 502 }) : ok("recovered")));
  assert.equal((await gemini.models.generateContent({ contents: "x" })).text, "recovered");
  assert.equal(kg.activeKieGeminiModel(), "gemini-3-8-flash");
  done("502 retried on 3.8, model unchanged");

  // KIE rejects 3.8 (HTTP 200 + {code,msg}, as KIE does) → 3.7 serves, and stays for the cooldown.
  reply.set("gemini-3-8-flash", () => new Response(JSON.stringify({ code: 404, msg: "model not found" }), { status: 200 }));
  hits.length = 0;
  assert.equal((await gemini.models.generateContent({ contents: "x" })).text, "hi from gemini-3-7-flash");
  assert.deepEqual(hits.map((h) => h.url.match(/models\/([^:]+)/)![1]), ["gemini-3-8-flash", "gemini-3-7-flash"]);
  assert.equal(kg.activeKieGeminiModel(), "gemini-3-7-flash");
  hits.length = 0;
  await gemini.models.generateContent({ contents: "y" });
  assert.deepEqual(hits.map((h) => h.url.match(/models\/([^:]+)/)![1]), ["gemini-3-7-flash"], "no repeated 3.8 attempt during cooldown");
  done("model rejection → fallback 3.7, sticky for the cooldown");

  // Classification: auth / quota errors never trigger a model switch.
  assert.equal(kg.isKieGeminiModelError(401, "Invalid API key"), false);
  assert.equal(kg.isKieGeminiModelError(429, "rate limit"), false);
  assert.equal(kg.isKieGeminiModelError(500, "internal error"), false);
  assert.equal(kg.isKieGeminiModelError(400, "tools are not supported for this model"), true);
  assert.equal(kg.isKieGeminiModelError(404, "Not Found"), true);
  done("only model/tool rejections switch models");

  console.log(`\nkie gemini model: all ${pass} checks passed`);
  process.exit(0);
}
main().catch((e) => { console.error("FAILED:", e); process.exit(1); });
