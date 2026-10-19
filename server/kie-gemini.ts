/**
 * Shared KIE Gemini endpoints + one automatic retry on flaky provider errors.
 *
 * Model: Gemini 3.8 Flash — https://docs.kie.ai/market/gemini/gemini-3-8-flash
 *   POST https://api.kie.ai/gemini/v1/models/gemini-3-8-flash:streamGenerateContent
 *   POST https://api.kie.ai/gemini/v1/models/gemini-3-8-flash:generateContent
 *
 * KIE marks 3.8 Flash "chat only — not yet adapted for agent use". When KIE rejects
 * the model (unknown model / tools refused), calls switch to the fallback for a
 * cooldown and then try the primary again (see `noteKieGeminiModelFailure`).
 */

export const KIE_GEMINI_MODEL =
  (process.env.CRAFT_GEMINI_MODEL || "gemini-3-8-flash").trim() || "gemini-3-8-flash";
export const KIE_GEMINI_FALLBACK_MODEL =
  (process.env.CRAFT_GEMINI_FALLBACK_MODEL || "gemini-3-7-flash").trim() || "gemini-3-7-flash";
const FALLBACK_COOLDOWN_MS = Math.max(60_000, Number(process.env.CRAFT_GEMINI_FALLBACK_COOLDOWN_MS) || 10 * 60_000);

let primaryBlockedUntil = 0;

/** Model to use right now: the primary, or the fallback during a cooldown. */
export function activeKieGeminiModel(): string {
  if (KIE_GEMINI_MODEL === KIE_GEMINI_FALLBACK_MODEL) return KIE_GEMINI_MODEL;
  return Date.now() < primaryBlockedUntil ? KIE_GEMINI_FALLBACK_MODEL : KIE_GEMINI_MODEL;
}

/**
 * True for errors that mean "this model cannot serve the request" (as opposed to
 * a flaky provider), so switching models helps where a plain retry would not.
 */
export function isKieGeminiModelError(status: number, message: string): boolean {
  const m = String(message || "").toLowerCase();
  if (status === 404) return true;
  if (/model[^a-z]{0,20}(not (found|exist|support)|unknown|unavailable|invalid)|unsupported model|no such model|not yet adapted/.test(m)) return true;
  if ((status === 400 || status === 422) && /tool|function/.test(m)) return true;
  return false;
}

/**
 * Report a failure of `model`. Returns true when the caller should retry with
 * the fallback model (primary failed with a model error).
 */
export function noteKieGeminiModelFailure(model: string, status: number, message: string): boolean {
  if (model !== KIE_GEMINI_MODEL || model === KIE_GEMINI_FALLBACK_MODEL) return false;
  if (!isKieGeminiModelError(status, message)) return false;
  const first = Date.now() >= primaryBlockedUntil;
  primaryBlockedUntil = Date.now() + FALLBACK_COOLDOWN_MS;
  if (first) {
    console.warn(
      `[kie-gemini] ${model} rejected (${status}: ${String(message).slice(0, 160)}) — using ${KIE_GEMINI_FALLBACK_MODEL} for ${Math.round(FALLBACK_COOLDOWN_MS / 60000)} min`,
    );
  }
  return true;
}

/** Total attempts for a single Gemini call (1 primary + 1 retry by default). */
export const KIE_GEMINI_ATTEMPTS = Math.max(
  1,
  Math.min(4, Number(process.env.CRAFT_GEMINI_ATTEMPTS) || 2),
);

export function kieGeminiSyncUrl(model: string = KIE_GEMINI_MODEL): string {
  return `https://api.kie.ai/gemini/v1/models/${model}:generateContent`;
}

export function kieGeminiStreamUrl(model: string = KIE_GEMINI_MODEL): string {
  return `https://api.kie.ai/gemini/v1/models/${model}:streamGenerateContent`;
}

/** Primary-model URLs (kept for logs/back-compat); requests use the *Url() of activeKieGeminiModel(). */
export const KIE_GEMINI_SYNC_URL = kieGeminiSyncUrl();
export const KIE_GEMINI_STREAM_URL = kieGeminiStreamUrl();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** True when a second KIE request is worth trying (~5% flaky provider failures). */
export function isRetryableKieGeminiError(err: unknown): boolean {
  const e = err as any;
  const status = Number(e?.status || e?.statusCode || 0);
  if (status === 400 || status === 401 || status === 403 || status === 422) {
    return false;
  }
  // 404 can be a transient gateway miss on a newly published model path.
  if (status === 429 || status >= 500 || status === 404) return true;

  const msg = String(e?.message || e || "");
  if (
    /invalid api key|unauthorized|forbidden|validation|tool|function/i.test(msg) &&
    status > 0 &&
    status < 500 &&
    status !== 404
  ) {
    return false;
  }
  if (/aborted|AbortError|timed out|timeout/i.test(msg)) return true;
  if (/fetch failed|network|econnreset|etimedout|econnrefused|socket|UND_ERR/i.test(msg)) return true;
  if (
    /Empty (?:KIE|Gemini)|provider error|internal error|bad gateway|service unavailable|rate limit|not found/i.test(
      msg,
    )
  ) {
    return true;
  }
  if (/\b5\d\d\b|\b429\b|\b404\b/i.test(msg)) return true;
  if (e?.confirmedKieFailure === true && !(status >= 400 && status < 500 && status !== 429 && status !== 404)) {
    return true;
  }
  return false;
}

export async function withKieGeminiRetry<T>(
  label: string,
  fn: (attempt: number, model: string) => Promise<T>,
  opts?: {
    attempts?: number;
    shouldRetry?: (err: unknown, attempt: number) => boolean;
  },
): Promise<T> {
  const attempts = opts?.attempts ?? KIE_GEMINI_ATTEMPTS;
  let lastErr: unknown;
  let switchedModel = false;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const model = activeKieGeminiModel();
    try {
      return await fn(attempt, model);
    } catch (err) {
      lastErr = err;
      const e = err as any;
      const status = Number(e?.status || e?.statusCode || 0) || Number(String(e?.message || "").match(/\b([45]\d\d)\b/)?.[1] || 0);
      // Model rejected: one extra try on the fallback, not counted as a retry.
      if (!switchedModel && noteKieGeminiModelFailure(model, status, String(e?.message || err))) {
        switchedModel = true;
        attempt -= 1;
        continue;
      }
      const retry =
        attempt < attempts &&
        (opts?.shouldRetry?.(err, attempt) ?? isRetryableKieGeminiError(err));
      if (!retry) break;
      const delay = attempt * 1200;
      console.warn(
        `[${label}] KIE Gemini error (attempt ${attempt}/${attempts}), retry in ${delay}ms:`,
        String((err as any)?.message || err).slice(0, 220),
      );
      await sleep(delay);
    }
  }
  throw lastErr;
}
