/**
 * Small Gemini client for one-shot vision prompts (scroll-animation concept,
 * motion prompt, head-turn direction).
 *
 * These used to call Google's API directly with `gemini-2.5-flash`. They now go
 * through KIE like every other Gemini call, so the whole app runs on one model
 * (KIE_GEMINI_MODEL, gemini-3-8-flash, with the 3.7 fallback). The shape mirrors
 * `@google/genai` (`gemini.models.generateContent` → `{ text, candidates }`), so
 * callers did not change. The `model` field callers pass is ignored on purpose.
 */
import { GoogleGenAI } from "@google/genai";
import { withKieGeminiRetry, kieGeminiSyncUrl } from "./kie-gemini";

type Part = { text?: string; inlineData?: { data: string; mimeType: string } };
type Content = { role?: string; parts: Part[] };

type GenerateRequest = {
  model?: string;
  contents: Content[] | string;
  config?: { abortSignal?: AbortSignal; systemInstruction?: string };
};

type GenerateResult = { text: string; candidates: any[] };

function toKieContents(contents: Content[] | string): any[] {
  if (typeof contents === "string") return [{ role: "user", parts: [{ text: contents }] }];
  return contents.map((c) => ({
    role: c.role === "model" ? "model" : "user",
    parts: c.parts.map((p) =>
      p.inlineData ? { inline_data: { mime_type: p.inlineData.mimeType, data: p.inlineData.data } } : { text: p.text ?? "" },
    ),
  }));
}

async function generateContent(req: GenerateRequest): Promise<GenerateResult> {
  const key = process.env.KIE_API_KEY;
  if (!key) throw new Error("KIE_API_KEY missing — Gemini vision calls go through KIE");
  const body: any = { stream: false, contents: toKieContents(req.contents) };
  if (req.config?.systemInstruction) body.systemInstruction = { parts: [{ text: req.config.systemInstruction }] };
  return withKieGeminiRetry("VISION", async (_attempt, model) => {
    const resp = await fetch(kieGeminiSyncUrl(model), {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
      signal: req.config?.abortSignal,
    });
    if (!resp.ok) {
      const err: any = new Error(`KIE Gemini ${resp.status}: ${(await resp.text().catch(() => "")).slice(0, 300)}`);
      err.status = resp.status;
      throw err;
    }
    const data: any = await resp.json();
    // KIE reports provider errors as HTTP 200 with {code, msg}.
    const code = Number(data?.code);
    if (Number.isFinite(code) && code !== 200 && code !== 0 && !data?.candidates) {
      const err: any = new Error(`KIE Gemini ${code}: ${String(data?.msg || data?.message || "error").slice(0, 300)}`);
      err.status = code >= 400 && code < 600 ? code : 502;
      throw err;
    }
    const candidates = Array.isArray(data?.candidates) ? data.candidates : [];
    const text = (candidates[0]?.content?.parts || []).map((p: any) => p?.text || "").join("");
    return { text, candidates };
  });
}

export const gemini = { models: { generateContent } };

/**
 * Google's own SDK, kept only for Deep Research (`interactions` + the
 * `deep-research-pro` agent). That is a Google agent, not a chat model, so it
 * has no KIE / gemini-3-8-flash equivalent and stays on GEMINI_API_KEY.
 */
export const googleGenAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "placeholder" });
