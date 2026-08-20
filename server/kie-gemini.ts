/**
 * Shared KIE Gemini endpoints + one automatic retry on flaky provider errors.
 *
 * Model: Gemini 3 Flash (v1beta) — https://docs.kie.ai/market/gemini/gemini-3-flash-v1beta
 * Path shape matches existing Craft usage:
 *   https://api.kie.ai/gemini/v1/models/<model>:generateContent
 *   https://api.kie.ai/gemini/v1/models/<model>:streamGenerateContent
 */

export const KIE_GEMINI_MODEL =
  (process.env.CRAFT_GEMINI_MODEL || "gemini-3-flash-v1beta").trim() || "gemini-3-flash-v1beta";

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

export const KIE_GEMINI_SYNC_URL = kieGeminiSyncUrl();
export const KIE_GEMINI_STREAM_URL = kieGeminiStreamUrl();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** True when a second KIE request is worth trying (~5% flaky provider failures). */
export function isRetryableKieGeminiError(err: unknown): boolean {
  const e = err as any;
  const status = Number(e?.status || e?.statusCode || 0);
  if (status === 400 || status === 401 || status === 403 || status === 404 || status === 422) {
    return false;
  }
  if (status === 429 || status >= 500) return true;

  const msg = String(e?.message || e || "");
  if (/invalid api key|unauthorized|forbidden|not found|validation|tool|function/i.test(msg) && status > 0 && status < 500) {
    return false;
  }
  if (/aborted|AbortError|timed out|timeout/i.test(msg)) return true;
  if (/fetch failed|network|econnreset|etimedout|econnrefused|socket|UND_ERR/i.test(msg)) return true;
  if (/Empty (?:KIE|Gemini)|provider error|internal error|bad gateway|service unavailable|rate limit/i.test(msg)) {
    return true;
  }
  if (/\b5\d\d\b|\b429\b/i.test(msg)) return true;
  if (e?.confirmedKieFailure === true && !(status >= 400 && status < 500 && status !== 429)) {
    return true;
  }
  return false;
}

export async function withKieGeminiRetry<T>(
  label: string,
  fn: (attempt: number) => Promise<T>,
  opts?: {
    attempts?: number;
    shouldRetry?: (err: unknown, attempt: number) => boolean;
  },
): Promise<T> {
  const attempts = opts?.attempts ?? KIE_GEMINI_ATTEMPTS;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastErr = err;
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
