/**
 * YooKassa (ЮKassa) payment API client for Craft AI top-ups + 54-FZ receipts.
 * Docs: https://yookassa.ru/developers/api
 *
 * Env:
 *   YOOKASSA_SHOP_ID
 *   YOOKASSA_SECRET_KEY
 *   YOOKASSA_VAT_CODE          (default 1 = без НДС)
 *   YOOKASSA_TAX_SYSTEM_CODE   (default 2 = УСН/АУСН «доходы»)
 *
 * АУСН (АвтоУСН): в API ЮKassa нет отдельного кода. По разъяснениям ФНС для касс
 * передают УСН того же объекта налогообложения:
 *   АУСН «доходы»            → tax_system_code=2
 *   АУСН «доходы − расходы»  → tax_system_code=3
 * НДС при АУСН обычно не применяется → vat_code=1.
 */

import crypto from "crypto";

const API_BASE = "https://api.yookassa.ru/v3";

export function isYooKassaConfigured(): boolean {
  return Boolean(
    process.env.YOOKASSA_SHOP_ID?.trim() && process.env.YOOKASSA_SECRET_KEY?.trim(),
  );
}

function authHeader(): string {
  const shopId = process.env.YOOKASSA_SHOP_ID!.trim();
  const secret = process.env.YOOKASSA_SECRET_KEY!.trim();
  return "Basic " + Buffer.from(`${shopId}:${secret}`).toString("base64");
}

function vatCode(): number {
  const n = Number(process.env.YOOKASSA_VAT_CODE || 1);
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

function taxSystemCode(): number {
  // Default 2 = УСН/АУСН «доходы» (отдельного кода АУСН в ЮKassa нет).
  const n = Number(process.env.YOOKASSA_TAX_SYSTEM_CODE || 2);
  return Number.isFinite(n) && n >= 1 ? n : 2;
}

function rubAmount(value: number): { value: string; currency: "RUB" } {
  return { value: Number(value).toFixed(2), currency: "RUB" };
}

async function yooFetch<T = any>(
  method: string,
  path: string,
  body?: unknown,
  idempotenceKey?: string,
): Promise<T> {
  const headers: Record<string, string> = {
    Authorization: authHeader(),
    "Content-Type": "application/json",
  };
  if (idempotenceKey) headers["Idempotence-Key"] = idempotenceKey;

  const resp = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = (await resp.json().catch(() => ({}))) as any;
  if (!resp.ok) {
    const desc = data?.description || data?.code || resp.statusText;
    const param = data?.parameter ? ` (${data.parameter})` : "";
    throw new Error(`YooKassa ${method} ${path}: ${resp.status} ${desc}${param}`);
  }
  return data as T;
}

export type YooPayment = {
  id: string;
  status: string;
  paid?: boolean;
  amount?: { value: string; currency: string };
  confirmation?: { type: string; confirmation_url?: string };
  metadata?: Record<string, string>;
  test?: boolean;
  cancellation_details?: { party?: string; reason?: string };
};

export function buildPaymentReceipt(opts: {
  customerEmail: string;
  description: string;
  amountRub: number;
}) {
  const email = opts.customerEmail.trim();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Для чека нужен корректный email покупателя");
  }
  const desc = opts.description.slice(0, 128);
  return {
    customer: { email },
    tax_system_code: taxSystemCode(),
    items: [
      {
        description: desc,
        quantity: "1.00",
        amount: rubAmount(opts.amountRub),
        vat_code: vatCode(),
        payment_mode: "full_payment",
        payment_subject: "service",
      },
    ],
  };
}

export async function createYooPayment(opts: {
  amountRub: number;
  description: string;
  returnUrl: string;
  craftOrderId: number;
  craftUserId: number;
  customerEmail: string;
  idempotenceKey?: string;
}): Promise<YooPayment> {
  if (!isYooKassaConfigured()) {
    throw new Error("YOOKASSA_SHOP_ID / YOOKASSA_SECRET_KEY missing");
  }
  const receipt = buildPaymentReceipt({
    customerEmail: opts.customerEmail,
    description: opts.description,
    amountRub: opts.amountRub,
  });

  const body = {
    amount: rubAmount(opts.amountRub),
    capture: true,
    confirmation: {
      type: "redirect",
      return_url: opts.returnUrl,
    },
    description: opts.description.slice(0, 128),
    metadata: {
      craft_order_id: String(opts.craftOrderId),
      craft_user_id: String(opts.craftUserId),
    },
    receipt,
  };

  return yooFetch<YooPayment>(
    "POST",
    "/payments",
    body,
    opts.idempotenceKey || crypto.randomUUID(),
  );
}

export async function getYooPayment(paymentId: string): Promise<YooPayment> {
  return yooFetch<YooPayment>("GET", `/payments/${encodeURIComponent(paymentId)}`);
}

export async function captureYooPayment(
  paymentId: string,
  amountRub?: number,
): Promise<YooPayment> {
  const body =
    amountRub != null
      ? { amount: rubAmount(amountRub) }
      : {};
  return yooFetch<YooPayment>(
    "POST",
    `/payments/${encodeURIComponent(paymentId)}/capture`,
    body,
    crypto.randomUUID(),
  );
}

export function parseAmountRub(payment: YooPayment): number | null {
  const v = payment.amount?.value;
  if (v == null) return null;
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? n : null;
}

export function craftOrderIdFromPayment(payment: YooPayment): number | null {
  const raw = payment.metadata?.craft_order_id;
  if (!raw) return null;
  const n = parseInt(String(raw), 10);
  return Number.isFinite(n) ? n : null;
}
