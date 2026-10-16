import { createHash, randomBytes } from "crypto";
import { pool } from "./db";
import { startTelegramPolling } from "./telegram-poll";

function log(message: string) {
  console.log(`[telegram] ${message}`);
}

export type TelegramBotProfile = {
  id: number | string;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
};

type PendingAuth = {
  createdAt: number;
  status: "pending" | "ready" | "consumed";
  profile?: TelegramBotProfile;
};

const PENDING_TTL_MS = 10 * 60 * 1000;
let cachedBotUsername: string | null = null;
let tableReady: Promise<void> | null = null;

async function ensureTable() {
  if (!tableReady) {
    tableReady = pool
      .query(`
        CREATE TABLE IF NOT EXISTS telegram_auth_pending (
          nonce TEXT PRIMARY KEY,
          status TEXT NOT NULL,
          profile JSONB,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `)
      .then(() => undefined)
      .catch((err) => {
        tableReady = null;
        throw err;
      });
  }
  await tableReady;
}

async function cleanupExpired() {
  await ensureTable();
  await pool.query(
    `DELETE FROM telegram_auth_pending WHERE created_at < NOW() - INTERVAL '10 minutes'`,
  );
}

export async function createTelegramBotAuthNonce(): Promise<string> {
  await cleanupExpired();
  const nonce = randomBytes(16).toString("hex");
  await pool.query(
    `INSERT INTO telegram_auth_pending (nonce, status) VALUES ($1, 'pending')`,
    [nonce],
  );
  return nonce;
}

export async function getTelegramBotAuthStatus(nonce: string): Promise<PendingAuth | undefined> {
  await ensureTable();
  const { rows } = await pool.query(
    `SELECT status, profile, EXTRACT(EPOCH FROM created_at) * 1000 AS created_ms
     FROM telegram_auth_pending WHERE nonce = $1`,
    [nonce],
  );
  if (!rows[0]) return undefined;
  const row = rows[0];
  const createdAt = Number(row.created_ms) || Date.now();
  if (Date.now() - createdAt > PENDING_TTL_MS) {
    await pool.query(`DELETE FROM telegram_auth_pending WHERE nonce = $1`, [nonce]);
    return undefined;
  }
  return {
    createdAt,
    status: row.status,
    profile: row.profile || undefined,
  };
}

export async function consumeTelegramBotAuth(nonce: string): Promise<TelegramBotProfile | null> {
  await ensureTable();
  const { rows } = await pool.query(
    `UPDATE telegram_auth_pending
     SET status = 'consumed'
     WHERE nonce = $1 AND status = 'ready'
     RETURNING profile`,
    [nonce],
  );
  if (!rows[0]?.profile) return null;
  await pool.query(`DELETE FROM telegram_auth_pending WHERE nonce = $1`, [nonce]);
  return rows[0].profile as TelegramBotProfile;
}

export async function completeTelegramBotAuth(
  nonce: string,
  profile: TelegramBotProfile,
): Promise<boolean> {
  await ensureTable();
  const { rowCount } = await pool.query(
    `UPDATE telegram_auth_pending
     SET status = 'ready', profile = $2::jsonb
     WHERE nonce = $1 AND status = 'pending'`,
    [nonce, JSON.stringify(profile)],
  );
  return (rowCount || 0) > 0;
}

function botApi(method: string, body?: Record<string, unknown>) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return Promise.resolve(null);
  // getUpdates long-poll needs a longer client timeout; everything else should fail fast
  // so boot / webhook setup never hangs on Telegram egress timeouts (ETIMEDOUT).
  const timeoutMs = method === "getUpdates" ? 35_000 : 12_000;
  return fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  })
    .then(async (res) => {
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        console.error(`Telegram API ${method} failed:`, data || res.status);
        return null;
      }
      return data.result;
    })
    .catch((err) => {
      const code = String(err?.cause?.code || err?.code || err?.name || "");
      const msg = String(err?.message || err);
      if (/ETIMEDOUT|TimeoutError|AbortError|UND_ERR|ENOTFOUND|ECONNRESET|fetch failed/i.test(`${code} ${msg}`)) {
        console.warn(`Telegram API ${method} network: ${code || msg}`.slice(0, 180));
      } else {
        console.error(`Telegram API ${method} error:`, err);
      }
      return null;
    });
}

export type BotApiResult<T = any> = {
  ok: boolean;
  result?: T;
  /** Telegram error code (403 blocked/kicked, 400 chat not found, 429 flood). 0 = network. */
  errorCode: number;
  description: string;
  /** Present on 400 when a group was upgraded to a supergroup. */
  migrateToChatId?: number;
  retryAfter?: number;
};

/**
 * Like botApi, but returns Telegram's error details instead of swallowing them, so
 * callers can react (drop a blocked chat, follow a supergroup migration). Never throws.
 */
export async function botApiRaw<T = any>(method: string, body?: Record<string, unknown>): Promise<BotApiResult<T>> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return { ok: false, errorCode: 0, description: "TELEGRAM_BOT_TOKEN not set" };
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(12_000),
    });
    const data: any = await res.json().catch(() => null);
    if (res.ok && data?.ok) return { ok: true, result: data.result, errorCode: 0, description: "" };
    return {
      ok: false,
      errorCode: Number(data?.error_code || res.status || 0),
      description: String(data?.description || res.statusText || ""),
      migrateToChatId: data?.parameters?.migrate_to_chat_id,
      retryAfter: data?.parameters?.retry_after,
    };
  } catch (err: any) {
    return { ok: false, errorCode: 0, description: String(err?.message || err).slice(0, 200) };
  }
}

/**
 * Other features hook bot updates here (e.g. lead notifications handle
 * `/start leads_<code>` and my_chat_member). A hook returns true when it
 * consumed the update.
 */
type UpdateHook = (update: any) => Promise<boolean>;
const updateHooks: UpdateHook[] = [];
export function registerTelegramUpdateHook(hook: UpdateHook): void {
  updateHooks.push(hook);
}

/** Updates the bot subscribes to (webhook + polling). */
const ALLOWED_UPDATES = ["message", "my_chat_member"];

/** Operational alert to the admin (ADMIN_TELEGRAM_ID). Never throws. */
export async function notifyAdmin(text: string): Promise<boolean> {
  const chatId = (process.env.ADMIN_TELEGRAM_ID || "").trim();
  if (!chatId) {
    console.warn("[alert] ADMIN_TELEGRAM_ID not set, alert only logged:", text.slice(0, 300));
    return false;
  }
  const res = await botApi("sendMessage", { chat_id: chatId, text: text.slice(0, 4000), disable_web_page_preview: true });
  return res != null;
}

export function getBotUsernameFromEnv(): string | null {
  if (cachedBotUsername) return cachedBotUsername;
  const fromEnv = process.env.VITE_TELEGRAM_BOT_USERNAME || process.env.TELEGRAM_BOT_USERNAME;
  if (fromEnv) {
    cachedBotUsername = String(fromEnv).replace(/^@/, "");
    return cachedBotUsername;
  }
  cachedBotUsername = "Craft_AI_RU_bot";
  return cachedBotUsername;
}

export function buildTelegramBotDeepLink(nonce: string): string | null {
  const username = getBotUsernameFromEnv();
  if (!username) return null;
  return `https://t.me/${username}?start=auth_${nonce}`;
}

function webhookSecret(): string {
  const explicit = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (explicit) return explicit;
  const token = process.env.TELEGRAM_BOT_TOKEN || "dev";
  return createHash("sha256").update(`craft-ai-tg-webhook:${token}`).digest("hex").slice(0, 32);
}

export function expectedTelegramWebhookSecret(): string {
  return webhookSecret();
}

async function sendLoginConfirm(chatId: number | string) {
  await botApi("sendMessage", {
    chat_id: chatId,
    text: "✅ Вход в Craft AI подтверждён.\nВернитесь в браузер — авторизация завершится автоматически.",
    disable_web_page_preview: true,
  });
}

export function handleTelegramUpdate(update: any): void {
  void (async () => {
    try {
      for (const hook of updateHooks) {
        if (await hook(update).catch((e) => { console.error("telegram update hook error:", e); return false; })) return;
      }
      const message = update?.message || update?.edited_message;
      if (!message?.chat?.id || typeof message.text !== "string") return;

      const text: string = message.text.trim();
      const match = text.match(/^\/start(?:@\w+)?(?:\s+(.+))?$/i);
      if (!match) return;

      const payload = (match[1] || "").trim();
      if (!payload.startsWith("auth_")) return;
      const nonce = payload.slice("auth_".length);
      if (!/^[a-f0-9]{16,64}$/i.test(nonce)) return;

      const from = message.from || {};
      const profile: TelegramBotProfile = {
        id: from.id ?? message.chat.id,
        first_name: from.first_name,
        last_name: from.last_name,
        username: from.username,
      };

      const ok = await completeTelegramBotAuth(nonce, profile);
      if (ok) {
        await sendLoginConfirm(message.chat.id);
      } else {
        await botApi("sendMessage", {
          chat_id: message.chat.id,
          text: "Ссылка для входа устарела или уже использована. Вернитесь на сайт и нажмите «Войти через Telegram» ещё раз.",
        });
      }
    } catch (err) {
      console.error("handleTelegramUpdate error:", err);
    }
  })();
}

let pollingStarted = false;

/** A-record of the app host (IPv4), "" when it cannot be resolved. */
async function resolvePublicIp(base: string): Promise<string> {
  try {
    const host = new URL(base).hostname;
    const { promises: dns } = await import("dns");
    const ips = await dns.resolve4(host);
    return ips[0] || "";
  } catch {
    return "";
  }
}

/** One log line with Telegram's view of delivery: backlog, last error, target IP. */
export async function logWebhookHealth(): Promise<any> {
  const info = await botApi("getWebhookInfo");
  if (!info) return null;
  const lastErr = info.last_error_date
    ? `${new Date(info.last_error_date * 1000).toISOString()} ${String(info.last_error_message || "").slice(0, 160)}`
    : "none";
  log(`webhook health: pending=${info.pending_update_count ?? 0} ip=${info.ip_address || "?"} last_error=${lastErr}`);
  return info;
}

let watchTimer: NodeJS.Timeout | null = null;
/**
 * Every 5 minutes: if our IP changed or Telegram reports a backlog with a recent
 * delivery error, re-register the webhook (pinned to the current IP) right away.
 */
function startWebhookWatch(base: string): void {
  if (watchTimer) return;
  watchTimer = setInterval(async () => {
    try {
      const info = await botApi("getWebhookInfo");
      if (!info) return;
      const current = (process.env.TELEGRAM_WEBHOOK_IP || (await resolvePublicIp(base))).trim();
      const ipMoved = !!current && !!info.ip_address && info.ip_address !== current;
      const recentError = info.last_error_date && Date.now() / 1000 - info.last_error_date < 600;
      if (ipMoved || (recentError && (info.pending_update_count ?? 0) > 0)) {
        log(`webhook watch: re-registering (ip ${info.ip_address} → ${current || "dns"}, pending=${info.pending_update_count})`);
        watchTimer && clearInterval(watchTimer);
        watchTimer = null;
        await ensureTelegramBotAuthIngress();
      }
    } catch (e: any) {
      console.warn("[telegram] webhook watch:", e?.message || e);
    }
  }, 5 * 60_000);
  watchTimer.unref?.();
}

async function pollUpdatesLoop() {
  let offset = 0;
  while (pollingStarted) {
    const result = await botApi("getUpdates", {
      offset,
      timeout: 25,
      allowed_updates: ALLOWED_UPDATES,
    });
    if (!Array.isArray(result)) {
      await new Promise((r) => setTimeout(r, 3000));
      continue;
    }
    for (const update of result) {
      if (typeof update?.update_id === "number") {
        offset = update.update_id + 1;
      }
      handleTelegramUpdate(update);
    }
  }
}

export async function ensureTelegramBotAuthIngress(): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    log("bot auth skipped: TELEGRAM_BOT_TOKEN not set");
    return;
  }

  try {
    await ensureTable();
  } catch (err) {
    console.error("[telegram] failed to ensure pending table:", err);
  }

  const me = await botApi("getMe");
  if (me?.username) {
    cachedBotUsername = String(me.username).replace(/^@/, "");
    log(`bot username: @${cachedBotUsername}`);
  }

  // Default: pull updates (outgoing long-poll). Telegram's incoming webhook
  // requests time out on the current host, which delayed /start by 1-2 minutes.
  // TELEGRAM_MODE=webhook restores push delivery.
  if ((process.env.TELEGRAM_MODE || "polling").toLowerCase() !== "webhook") {
    startTelegramPolling(botApi, handleTelegramUpdate, ALLOWED_UPDATES, log);
    return;
  }

  const base = (process.env.APP_BASE_URL || "https://craft-ai.ru").replace(/\/$/, "");
  const secret = webhookSecret();
  const webhookUrl = `${base}/api/auth/telegram/webhook`;

  // Telegram's view before we re-register: shows why earlier deliveries lagged.
  await logWebhookHealth();
  // Pin delivery to our current public IP: after the 10.2026 region move Telegram
  // kept retrying a stale DNS answer and updates arrived ~1-2 min late.
  const ipAddress = (process.env.TELEGRAM_WEBHOOK_IP || (await resolvePublicIp(base))).trim();
  let set: unknown = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    set = await botApi("setWebhook", {
      url: webhookUrl,
      secret_token: secret,
      allowed_updates: ALLOWED_UPDATES,
      drop_pending_updates: false,
      max_connections: 40,
      ...(ipAddress ? { ip_address: ipAddress } : {}),
    });
    if (set) break;
    await new Promise((r) => setTimeout(r, 800 * attempt));
  }

  if (set) {
    log(`webhook set: ${webhookUrl}${ipAddress ? ` (ip ${ipAddress})` : ""}`);
    pollingStarted = false;
    void logWebhookHealth();
    startWebhookWatch(base);
    return;
  }

  const allowPolling =
    process.env.TELEGRAM_ALLOW_POLLING === "1" || process.env.NODE_ENV !== "production";
  if (!allowPolling) {
    log("webhook failed — not starting getUpdates polling in production (set TELEGRAM_ALLOW_POLLING=1 to enable)");
    return;
  }

  log("webhook failed — falling back to getUpdates polling");
  await botApi("deleteWebhook", { drop_pending_updates: false });
  if (!pollingStarted) {
    pollingStarted = true;
    void pollUpdatesLoop();
  }
}
