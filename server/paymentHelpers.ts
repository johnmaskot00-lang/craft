import crypto from "crypto";
import type { Request } from "express";

export function getPaymentBaseUrl(req: Request): string {
  return (
    process.env.PUBLIC_URL ||
    process.env.APP_URL ||
    process.env.APP_BASE_URL ||
    req.headers.origin ||
    (req.headers.host ? `https://${req.headers.host}` : "")
  ).replace(/\/$/, "");
}

export function buildOnePaymentUserData(orderId: number, userId: number, apiKey: string): string {
  const verifyHash = crypto.createHash("md5").update(`${orderId}:${userId}:${apiKey}`).digest("hex");
  // 1payment requires globally unique user_data (error_code 8 if reused across envs/migrations)
  return JSON.stringify({ orderId, userId, v: verifyHash, n: crypto.randomUUID() });
}
