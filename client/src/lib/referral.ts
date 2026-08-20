/** Client-side referral capture for https://craft-ai.ru/?ref= / /r/:code */

export const REFERRAL_STORAGE_KEY = "craft_ref";
export const REFERRAL_COOKIE = "craft_ref";
const MAX_AGE_SEC = 30 * 24 * 60 * 60;

export function normalizeReferralCode(raw: unknown): string | null {
  const code = String(raw || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  if (code.length < 4 || code.length > 16) return null;
  return code;
}

export function getStoredReferralCode(): string | null {
  try {
    const fromLs = normalizeReferralCode(localStorage.getItem(REFERRAL_STORAGE_KEY));
    if (fromLs) return fromLs;
  } catch {
    /* ignore */
  }
  try {
    const match = document.cookie.match(new RegExp(`(?:^|; )${REFERRAL_COOKIE}=([^;]*)`));
    if (match) return normalizeReferralCode(decodeURIComponent(match[1]));
  } catch {
    /* ignore */
  }
  return null;
}

export function storeReferralCode(raw: unknown): string | null {
  const code = normalizeReferralCode(raw);
  if (!code) return null;
  try {
    localStorage.setItem(REFERRAL_STORAGE_KEY, code);
  } catch {
    /* ignore */
  }
  try {
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${REFERRAL_COOKIE}=${encodeURIComponent(code)}; Path=/; Max-Age=${MAX_AGE_SEC}; SameSite=Lax${secure}`;
  } catch {
    /* ignore */
  }
  return code;
}

/** Capture ?ref= from the current URL (keeps path, strips only ref params). */
export function captureReferralFromUrl(search = window.location.search): string | null {
  try {
    const params = new URLSearchParams(search);
    const code = storeReferralCode(params.get("ref") || params.get("referral"));
    if (!code) return null;
    if (params.has("ref") || params.has("referral")) {
      params.delete("ref");
      params.delete("referral");
      const qs = params.toString();
      const next = `${window.location.pathname}${qs ? `?${qs}` : ""}${window.location.hash || ""}`;
      window.history.replaceState({}, "", next);
    }
    return code;
  } catch {
    return null;
  }
}
