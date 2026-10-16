/**
 * New site leads → Telegram, through the Craft AI bot.
 *
 * A user links any chat (their DM or a group with the team) with a one-time code:
 * the site opens t.me/<bot>?start=leads_<code> (or ?startgroup= for groups); the bot
 * receives `/start leads_<code>` in that chat and stores it as a notify target.
 * Every new lead on the user's sites is then posted to all their targets, unless the
 * site has notifications switched off (projects.lead_notify).
 *
 * Delivery never blocks or fails the lead intake: it runs after the lead is saved,
 * fire-and-forget, with a per-chat rate limit. Chats that blocked or removed the bot
 * are dropped; group → supergroup migrations are followed.
 */
import { randomBytes } from "crypto";
import { pool } from "./db";
import {
  botApiRaw,
  getBotUsernameFromEnv,
  registerTelegramUpdateHook,
  type BotApiResult,
} from "./telegram-bot-auth";
import { redisRateLimit } from "./redis";

const LINK_TTL_MIN = 15;
const PER_CHAT_PER_MIN = Math.max(1, Number(process.env.CRAFT_LEAD_TG_PER_MIN) || 20);
/** Rate-limit window; the "…and N more" summary is sent when it ends. */
const WINDOW_MS = Math.max(50, Number(process.env.CRAFT_LEAD_TG_WINDOW_MS) || 60_000);
const APP_BASE = () => (process.env.APP_BASE_URL || "https://craft-ai.ru").replace(/\/$/, "");

export type LeadNotifyTarget = {
  id: number;
  userId: number;
  chatId: string;
  chatTitle: string;
  chatType: string;
  createdAt: Date;
};

let schemaReady: Promise<void> | null = null;
export function ensureLeadTelegramSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS lead_notify_targets (
          id serial PRIMARY KEY,
          user_id integer NOT NULL,
          chat_id text NOT NULL,
          chat_title text NOT NULL DEFAULT '',
          chat_type text NOT NULL DEFAULT 'private',
          created_at timestamptz NOT NULL DEFAULT NOW()
        )`);
      await pool.query(
        `CREATE UNIQUE INDEX IF NOT EXISTS lead_notify_targets_user_chat_uniq ON lead_notify_targets (user_id, chat_id)`,
      );
      await pool.query(`CREATE INDEX IF NOT EXISTS lead_notify_targets_chat_idx ON lead_notify_targets (chat_id)`);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS telegram_link_pending (
          code text PRIMARY KEY,
          user_id integer NOT NULL,
          status text NOT NULL DEFAULT 'pending',
          chat jsonb,
          created_at timestamptz NOT NULL DEFAULT NOW()
        )`);
      await pool.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS lead_notify boolean NOT NULL DEFAULT true`);
    })().catch((e) => {
      schemaReady = null;
      throw e;
    });
  }
  return schemaReady;
}

// ── linking ──────────────────────────────────────────────────────────────────

export async function createLeadLink(userId: number): Promise<{ code: string; privateUrl: string; groupUrl: string }> {
  await ensureLeadTelegramSchema();
  await pool.query(`DELETE FROM telegram_link_pending WHERE created_at < NOW() - interval '${LINK_TTL_MIN} minutes'`);
  // Telegram start payloads allow [A-Za-z0-9_-], max 64 chars.
  const code = randomBytes(12).toString("hex");
  await pool.query(`INSERT INTO telegram_link_pending (code, user_id) VALUES ($1, $2)`, [code, userId]);
  const bot = getBotUsernameFromEnv() || "Craft_AI_RU_bot";
  return {
    code,
    privateUrl: `https://t.me/${bot}?start=leads_${code}`,
    groupUrl: `https://t.me/${bot}?startgroup=leads_${code}`,
  };
}

export async function getLeadLinkStatus(
  userId: number,
  code: string,
): Promise<{ status: "pending" | "done" | "expired"; chat?: { title: string; type: string } }> {
  await ensureLeadTelegramSchema();
  const { rows } = await pool.query(
    `SELECT status, chat, created_at < NOW() - interval '${LINK_TTL_MIN} minutes' AS expired
       FROM telegram_link_pending WHERE code = $1 AND user_id = $2`,
    [code, userId],
  );
  const row = rows[0];
  if (!row) return { status: "expired" };
  if (row.status === "done") return { status: "done", chat: row.chat || undefined };
  return { status: row.expired ? "expired" : "pending" };
}

function chatTitleOf(chat: any): string {
  if (chat?.title) return String(chat.title).slice(0, 200);
  const name = [chat?.first_name, chat?.last_name].filter(Boolean).join(" ");
  return (name || (chat?.username ? `@${chat.username}` : "Личные сообщения")).slice(0, 200);
}

/** Consume a link code from a chat. Returns false for unknown / used / expired codes. */
export async function completeLeadLink(code: string, chat: any): Promise<boolean> {
  await ensureLeadTelegramSchema();
  const title = chatTitleOf(chat);
  const type = String(chat?.type || "private");
  const { rows } = await pool.query(
    `UPDATE telegram_link_pending
        SET status = 'done', chat = $2::jsonb
      WHERE code = $1 AND status = 'pending'
        AND created_at >= NOW() - interval '${LINK_TTL_MIN} minutes'
      RETURNING user_id`,
    [code, JSON.stringify({ title, type })],
  );
  const userId = rows[0]?.user_id;
  if (!userId) return false;
  await pool.query(
    `INSERT INTO lead_notify_targets (user_id, chat_id, chat_title, chat_type)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, chat_id) DO UPDATE SET chat_title = EXCLUDED.chat_title, chat_type = EXCLUDED.chat_type`,
    [userId, String(chat.id), title, type],
  );
  return true;
}

export async function listLeadTargets(userId: number): Promise<LeadNotifyTarget[]> {
  await ensureLeadTelegramSchema();
  const { rows } = await pool.query(
    `SELECT id, user_id AS "userId", chat_id AS "chatId", chat_title AS "chatTitle",
            chat_type AS "chatType", created_at AS "createdAt"
       FROM lead_notify_targets WHERE user_id = $1 ORDER BY id`,
    [userId],
  );
  return rows;
}

export async function deleteLeadTarget(userId: number, targetId: number): Promise<boolean> {
  await ensureLeadTelegramSchema();
  const { rows } = await pool.query(
    `DELETE FROM lead_notify_targets WHERE id = $1 AND user_id = $2 RETURNING chat_id`,
    [targetId, userId],
  );
  const chatId = rows[0]?.chat_id;
  if (chatId) {
    void botApiRaw("sendMessage", { chat_id: chatId, text: "Уведомления о заявках Craft AI отключены для этого чата." });
  }
  return !!chatId;
}

async function dropChat(chatId: string, reason: string): Promise<void> {
  const { rowCount } = await pool.query(`DELETE FROM lead_notify_targets WHERE chat_id = $1`, [chatId]);
  if (rowCount) console.log(`[lead-telegram] dropped chat ${chatId} (${reason})`);
}

// ── sending ─────────────────────────────────────────────────────────────────

export function escapeHtml(s: string): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export type LeadForMessage = {
  name: string;
  email: string;
  phone: string;
  message: string;
  source: string;
  createdAt?: Date | string | null;
};

export function formatLeadMessage(lead: LeadForMessage, siteTitle: string): string {
  const line = (label: string, v: string, max = 300) => (v ? `<b>${label}:</b> ${escapeHtml(v.slice(0, max))}\n` : "");
  const at = new Date(lead.createdAt || Date.now()).toLocaleString("ru-RU", {
    timeZone: "Europe/Moscow",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  return (
    `🔔 <b>Новая заявка — ${escapeHtml(siteTitle.slice(0, 120))}</b>\n\n` +
    line("Имя", lead.name, 100) +
    line("Телефон", lead.phone, 40) +
    line("Email", lead.email, 254) +
    line("Сообщение", lead.message, 1500) +
    `\n<i>Форма: ${escapeHtml((lead.source || "form").slice(0, 100))} · ${at} МСК</i>`
  );
}

/** Per-chat counter used when Redis is not available. */
const localWindows = new Map<string, { start: number; n: number }>();
async function allowSend(chatId: string): Promise<boolean> {
  const viaRedis = await redisRateLimit("lead-tg", chatId, PER_CHAT_PER_MIN, WINDOW_MS);
  if (viaRedis) return viaRedis.ok;
  const now = Date.now();
  const w = localWindows.get(chatId);
  if (!w || now - w.start >= WINDOW_MS) {
    localWindows.set(chatId, { start: now, n: 1 });
    return true;
  }
  w.n += 1;
  return w.n <= PER_CHAT_PER_MIN;
}

/** Leads suppressed by the rate limit, per chat — summarized once the window frees up. */
const suppressed = new Map<string, { n: number; timer: NodeJS.Timeout }>();
function noteSuppressed(chatId: string): void {
  const cur = suppressed.get(chatId);
  if (cur) {
    cur.n += 1;
    return;
  }
  const timer = setTimeout(() => {
    const entry = suppressed.get(chatId);
    suppressed.delete(chatId);
    if (!entry?.n) return;
    void sendToChat(chatId, `…и ещё <b>${entry.n}</b> ${plural(entry.n)} за последнюю минуту. Все заявки — в Craft AI.`);
  }, WINDOW_MS);
  timer.unref?.();
  suppressed.set(chatId, { n: 1, timer });
}

function plural(n: number): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return "заявка";
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return "заявки";
  return "заявок";
}

/** Send one message; follows supergroup migration, drops chats that removed the bot. */
async function sendToChat(chatId: string, html: string): Promise<BotApiResult> {
  const body = (id: string) => ({
    chat_id: id,
    text: html,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    reply_markup: { inline_keyboard: [[{ text: "Открыть в Craft AI", url: `${APP_BASE()}/leads` }]] },
  });
  let res = await botApiRaw("sendMessage", body(chatId));
  if (!res.ok && res.migrateToChatId) {
    const next = String(res.migrateToChatId);
    await pool
      .query(
        `UPDATE lead_notify_targets t SET chat_id = $2, chat_type = 'supergroup'
          WHERE chat_id = $1
            AND NOT EXISTS (SELECT 1 FROM lead_notify_targets o WHERE o.user_id = t.user_id AND o.chat_id = $2)`,
        [chatId, next],
      )
      .catch((e) => console.warn("[lead-telegram] migrate chat:", e?.message || e));
    await pool.query(`DELETE FROM lead_notify_targets WHERE chat_id = $1`, [chatId]).catch(() => undefined);
    console.log(`[lead-telegram] chat ${chatId} migrated to ${next}`);
    res = await botApiRaw("sendMessage", body(next));
  }
  if (!res.ok) {
    const d = res.description.toLowerCase();
    if (res.errorCode === 403 || (res.errorCode === 400 && /chat not found|group chat was deleted|bot was kicked/.test(d))) {
      await dropChat(chatId, res.description);
    } else {
      console.warn(`[lead-telegram] send to ${chatId} failed: ${res.errorCode} ${res.description}`.slice(0, 240));
    }
  }
  return res;
}

/**
 * Post a new lead to every chat linked by the site owner. Never throws; callers
 * fire-and-forget it after the lead is saved.
 */
export async function notifyLeadTelegram(projectId: number, lead: LeadForMessage): Promise<number> {
  try {
    if (!process.env.TELEGRAM_BOT_TOKEN) return 0;
    await ensureLeadTelegramSchema();
    const { rows } = await pool.query(
      `SELECT p.title, t.chat_id
         FROM projects p
         JOIN lead_notify_targets t ON t.user_id = p.user_id
        WHERE p.id = $1 AND p.lead_notify`,
      [projectId],
    );
    if (!rows.length) return 0;
    const html = formatLeadMessage(lead, String(rows[0].title || "Сайт"));
    let sent = 0;
    await Promise.all(
      rows.map(async (r: any) => {
        const chatId = String(r.chat_id);
        if (!(await allowSend(chatId))) {
          noteSuppressed(chatId);
          return;
        }
        if ((await sendToChat(chatId, html)).ok) sent += 1;
      }),
    );
    return sent;
  } catch (e: any) {
    console.warn(`[lead-telegram] notify for project ${projectId} failed:`, e?.message || e);
    return 0;
  }
}

/** "Test" button: one sample message to each of the user's chats. */
export async function sendLeadTest(userId: number): Promise<{ sent: number; failed: number }> {
  const targets = await listLeadTargets(userId);
  const html = formatLeadMessage(
    { name: "Иван (тест)", phone: "+7 900 000-00-00", email: "test@example.ru", message: "Это тестовая заявка — так будут выглядеть новые заявки с ваших сайтов.", source: "test" },
    "Ваш сайт",
  );
  let sent = 0;
  for (const t of targets) if ((await sendToChat(t.chatId, html)).ok) sent += 1;
  return { sent, failed: targets.length - sent };
}

export async function setProjectLeadNotify(projectId: number, enabled: boolean): Promise<void> {
  await ensureLeadTelegramSchema();
  await pool.query(`UPDATE projects SET lead_notify = $2 WHERE id = $1`, [projectId, enabled]);
}

export async function listProjectsLeadNotify(userId: number): Promise<Array<{ id: number; title: string; leadNotify: boolean }>> {
  await ensureLeadTelegramSchema();
  const { rows } = await pool.query(
    `SELECT id, title, lead_notify AS "leadNotify" FROM projects
      WHERE user_id = $1
      ORDER BY updated_at DESC NULLS LAST, id DESC`,
    [userId],
  );
  return rows;
}

// ── bot updates ──────────────────────────────────────────────────────────────

/** `/start leads_<code>` (DM or group) and bot removal (my_chat_member). */
export async function handleLeadTelegramUpdate(update: any): Promise<boolean> {
  const member = update?.my_chat_member;
  if (member?.chat?.id) {
    const status = member.new_chat_member?.status;
    if (status === "left" || status === "kicked") await dropChat(String(member.chat.id), `bot ${status}`);
    return true;
  }
  const message = update?.message;
  const text = typeof message?.text === "string" ? message.text.trim() : "";
  const m = text.match(/^\/start(?:@\w+)?\s+leads_([a-f0-9]{16,64})$/i);
  if (!m || !message?.chat?.id) return false;
  const ok = await completeLeadLink(m[1].toLowerCase(), message.chat);
  await botApiRaw("sendMessage", {
    chat_id: message.chat.id,
    text: ok
      ? "✅ Готово! Новые заявки с ваших сайтов Craft AI будут приходить в этот чат."
      : "Ссылка устарела или уже использована. Откройте «Лиды» в Craft AI и нажмите «Подключить Telegram» ещё раз.",
  });
  return true;
}

registerTelegramUpdateHook(handleLeadTelegramUpdate);
