/**
 * User-to-user referral program for Craft AI.
 *
 * Link: https://craft-ai.ru/r/<CODE> (also ?ref=<CODE>)
 * Reward: 20% of every paid tariff's tokens credited to the referrer.
 */
import type { Request, Response } from "express";

export const REFERRAL_COOKIE = "craft_ref";
export const REFERRAL_STORAGE_KEY = "craft_ref";
export const REFERRAL_RATE = 0.2;
export const REFERRAL_COOKIE_MAX_AGE_SEC = 30 * 24 * 60 * 60; // 30 days
export const PUBLIC_SITE_ORIGIN = (
  process.env.PUBLIC_URL ||
  process.env.APP_BASE_URL ||
  "https://craft-ai.ru"
).replace(/\/$/, "");

export function normalizeReferralCode(raw: unknown): string | null {
  const code = String(raw || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  if (code.length < 4 || code.length > 16) return null;
  return code;
}

/** Read referral code from body, query, or cookie (first wins). */
export function extractReferralCode(req: Request): string | null {
  const fromBody = normalizeReferralCode((req.body as any)?.ref ?? (req.body as any)?.referralCode);
  if (fromBody) return fromBody;
  const fromQuery = normalizeReferralCode(req.query?.ref ?? req.query?.referral);
  if (fromQuery) return fromQuery;
  return readCookie(req, REFERRAL_COOKIE);
}

export function readCookie(req: Request, name: string): string | null {
  const header = String(req.headers.cookie || "");
  if (!header) return null;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    if (k !== name) continue;
    try {
      return normalizeReferralCode(decodeURIComponent(part.slice(idx + 1).trim()));
    } catch {
      return normalizeReferralCode(part.slice(idx + 1).trim());
    }
  }
  return null;
}

export function setReferralCookie(res: Response, code: string): void {
  const normalized = normalizeReferralCode(code);
  if (!normalized) return;
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `${REFERRAL_COOKIE}=${encodeURIComponent(normalized)}; Path=/; Max-Age=${REFERRAL_COOKIE_MAX_AGE_SEC}; SameSite=Lax${secure}`,
  );
}

export function clearReferralCookie(res: Response): void {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `${REFERRAL_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax${secure}`,
  );
}

export function referralShareUrl(code: string): string {
  return `${PUBLIC_SITE_ORIGIN}/r/${encodeURIComponent(code)}`;
}

export function referralBonusTokens(purchasedTokens: number): number {
  const n = Math.floor(Number(purchasedTokens) || 0);
  if (n <= 0) return 0;
  return Math.floor(n * REFERRAL_RATE);
}
