// Run: node --import tsx tests/lead-telegram.itest.ts
// Real Postgres (in-process PGlite) + a fake Telegram Bot API behind globalThis.fetch.
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

type Sent = { method: string; body: any };
const sent: Sent[] = [];
let tgMode: "ok" | "hang" | "down" = "ok";
/** chat_id → canned failure for sendMessage */
const failFor = new Map<string, { error_code: number; description: string; parameters?: any }>();

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init?: any) => {
  const url = String(input);
  if (!url.startsWith("https://api.telegram.org/")) return realFetch(input, init);
  const method = url.split("/").pop()!;
  const body = init?.body ? JSON.parse(init.body) : {};
  if (tgMode === "hang") return new Promise(() => {});
  if (tgMode === "down") throw new TypeError("fetch failed");
  sent.push({ method, body });
  const fail = method === "sendMessage" ? failFor.get(String(body.chat_id)) : undefined;
  const payload = fail ? { ok: false, ...fail } : { ok: true, result: { message_id: sent.length } };
  return new Response(JSON.stringify(payload), { status: fail ? fail.error_code : 200, headers: { "content-type": "application/json" } });
}) as typeof fetch;

const messagesTo = (chat: string) => sent.filter((s) => s.method === "sendMessage" && String(s.body.chat_id) === chat);
const tick = (ms = 50) => new Promise((r) => setTimeout(r, ms));
let pass = 0;
const ok = (m: string) => { pass++; console.log(`  ✓ ${m}`); };

async function main() {
  const pgl = await PGlite.create();
  const srv = new PGLiteSocketServer({ db: pgl, port: 55461, host: "127.0.0.1" });
  await srv.start();
  process.env.DATABASE_URL = "postgres://postgres@127.0.0.1:55461/postgres";
  process.env.DB_POOL_MAX = "1";
  process.env.TELEGRAM_BOT_TOKEN = "123:test";
  process.env.TELEGRAM_BOT_USERNAME = "Craft_AI_RU_bot";
  process.env.CRAFT_LEAD_TG_PER_MIN = "20";
  process.env.CRAFT_LEAD_TG_WINDOW_MS = "1500";

  const { pool } = await import("../server/db.ts");
  await pool.query(`CREATE TABLE projects (id serial PRIMARY KEY, user_id integer NOT NULL, title text NOT NULL,
    type varchar(20) NOT NULL DEFAULT 'website', updated_at timestamp DEFAULT now())`);
  await pool.query(`INSERT INTO projects (user_id, title) VALUES (7, 'Кофейня <b>"Зерно"</b>'), (7, 'Второй сайт'), (8, 'Чужой')`);

  const lt = await import("../server/lead-telegram.ts");
  const { handleTelegramUpdate } = await import("../server/telegram-bot-auth.ts");
  await lt.ensureLeadTelegramSchema();

  // 1. link from a private chat
  const link = await lt.createLeadLink(7);
  assert.match(link.privateUrl, /^https:\/\/t\.me\/Craft_AI_RU_bot\?start=leads_[a-f0-9]{24}$/);
  assert.match(link.groupUrl, /\?startgroup=leads_/);
  assert.equal((await lt.getLeadLinkStatus(7, link.code)).status, "pending");
  assert.equal((await lt.getLeadLinkStatus(8, link.code)).status, "expired", "other users cannot read the code");
  handleTelegramUpdate({ update_id: 1, message: { chat: { id: 1001, type: "private", first_name: "Alex" }, text: `/start leads_${link.code}` } });
  await tick(300);
  const st = await lt.getLeadLinkStatus(7, link.code);
  assert.equal(st.status, "done");
  assert.equal(st.chat?.title, "Alex");
  assert.match(messagesTo("1001")[0].body.text, /Готово/);
  ok("private chat linked by one-time code");

  // 2. code is single-use; group link via /start@bot
  handleTelegramUpdate({ update_id: 2, message: { chat: { id: 1002, type: "private" }, text: `/start leads_${link.code}` } });
  await tick(300);
  assert.match(messagesTo("1002")[0].body.text, /устарела/);
  const g = await lt.createLeadLink(7);
  handleTelegramUpdate({ update_id: 3, message: { chat: { id: -500, type: "group", title: "Отдел продаж" }, text: `/start@Craft_AI_RU_bot leads_${g.code}` } });
  await tick(300);
  const targets = await lt.listLeadTargets(7);
  assert.deepEqual(targets.map((t) => [t.chatId, t.chatTitle, t.chatType]), [["1001", "Alex", "private"], ["-500", "Отдел продаж", "group"]]);
  ok("code is single-use; group linked via /start@bot");

  // 3. expired code rejected
  const old = await lt.createLeadLink(7);
  await pool.query(`UPDATE telegram_link_pending SET created_at = NOW() - interval '20 minutes' WHERE code = $1`, [old.code]);
  assert.equal(await lt.completeLeadLink(old.code, { id: 1003, type: "private" }), false);
  assert.equal((await lt.getLeadLinkStatus(7, old.code)).status, "expired");
  ok("expired code rejected");

  // 4. a lead reaches every chat, user input escaped
  sent.length = 0;
  const n = await lt.notifyLeadTelegram(1, { name: "<script>x</script> Иван", phone: "+7 999 111-22-33", email: "i@x.ru", message: "a & b", source: "contact" });
  assert.equal(n, 2);
  const msg = messagesTo("1001")[0].body;
  assert.equal(msg.parse_mode, "HTML");
  assert.ok(msg.text.includes("&lt;script&gt;x&lt;/script&gt; Иван"), "name escaped");
  assert.ok(msg.text.includes("Кофейня &lt;b&gt;\"Зерно\"&lt;/b&gt;"), "site title escaped");
  assert.ok(msg.text.includes("a &amp; b"));
  assert.ok(!msg.text.includes("<script>"));
  assert.equal(msg.reply_markup.inline_keyboard[0][0].url, "https://craft-ai.ru/leads");
  assert.equal(messagesTo("-500").length, 1);
  ok("lead posted to all chats, HTML-escaped, with button");

  // 5. per-site switch, other users' sites
  await lt.setProjectLeadNotify(1, false);
  sent.length = 0;
  assert.equal(await lt.notifyLeadTelegram(1, { name: "A", phone: "", email: "", message: "", source: "f" }), 0);
  assert.equal(await lt.notifyLeadTelegram(3, { name: "A", phone: "", email: "", message: "", source: "f" }), 0, "user 8 has no targets");
  assert.equal(sent.length, 0);
  await lt.setProjectLeadNotify(1, true);
  const projects = await lt.listProjectsLeadNotify(7);
  assert.deepEqual(projects.map((p) => p.leadNotify), [true, true]);
  ok("per-site switch respected; owners isolated");

  // 6. supergroup migration followed
  failFor.set("-500", { error_code: 400, description: "Bad Request: group chat was upgraded to a supergroup chat", parameters: { migrate_to_chat_id: -100500 } });
  sent.length = 0;
  await lt.notifyLeadTelegram(2, { name: "B", phone: "", email: "", message: "", source: "f" });
  failFor.delete("-500");
  assert.equal(messagesTo("-100500").length, 1, "resent to the supergroup");
  assert.ok((await lt.listLeadTargets(7)).some((t) => t.chatId === "-100500" && t.chatType === "supergroup"));
  assert.ok(!(await lt.listLeadTargets(7)).some((t) => t.chatId === "-500"));
  ok("group → supergroup migration followed");

  // 7. blocked bot → chat dropped; my_chat_member kick → dropped
  failFor.set("1001", { error_code: 403, description: "Forbidden: bot was blocked by the user" });
  await lt.notifyLeadTelegram(2, { name: "C", phone: "", email: "", message: "", source: "f" });
  failFor.delete("1001");
  assert.ok(!(await lt.listLeadTargets(7)).some((t) => t.chatId === "1001"), "blocked chat dropped");
  handleTelegramUpdate({ update_id: 9, my_chat_member: { chat: { id: -100500, type: "supergroup" }, new_chat_member: { status: "kicked" } } });
  await tick(300);
  assert.equal((await lt.listLeadTargets(7)).length, 0, "kicked group dropped");
  ok("blocked / kicked chats are dropped");

  // 8. rate limit: 25 leads in a burst → 20 messages, rest summarized later
  const r = await lt.createLeadLink(7);
  await lt.completeLeadLink(r.code, { id: 2001, type: "private", first_name: "R" });
  sent.length = 0;
  for (let i = 0; i < 25; i++) await lt.notifyLeadTelegram(2, { name: `L${i}`, phone: "", email: "", message: "", source: "f" });
  assert.equal(messagesTo("2001").length, 20, "capped at 20/min");
  await tick(1800);
  const summary = messagesTo("2001").slice(20);
  assert.equal(summary.length, 1, "one summary message");
  assert.match(summary[0].body.text, /ещё <b>5<\/b> заявок/);
  ok("burst capped per chat; one «ещё 5 заявок» summary after the window");

  // 9. Telegram hanging / down never throws, and intake does not wait for it
  tgMode = "down";
  assert.equal(await lt.notifyLeadTelegram(2, { name: "D", phone: "", email: "", message: "", source: "f" }), 0);
  tgMode = "hang";
  const t0 = Date.now();
  const pending = lt.notifyLeadTelegram(2, { name: "E", phone: "", email: "", message: "", source: "f" });
  // the intake route does `void notifyLeadTelegram(...)`: only the call itself must be instant
  assert.ok(Date.now() - t0 < 50, "call returns a promise immediately");
  void pending;
  tgMode = "ok";
  ok("telegram down: no throw; intake is fire-and-forget");

  // 10. test message + delete own target only
  sent.length = 0;
  assert.deepEqual(await lt.sendLeadTest(7), { sent: 1, failed: 0 });
  const [t2001] = await lt.listLeadTargets(7);
  assert.equal(await lt.deleteLeadTarget(8, t2001.id), false, "cannot delete another user's chat");
  assert.equal(await lt.deleteLeadTarget(7, t2001.id), true);
  assert.equal((await lt.listLeadTargets(7)).length, 0);
  ok("test message; delete is owner-only");

  // 11. unrelated /start payloads still fall through to the login handler
  sent.length = 0;
  handleTelegramUpdate({ update_id: 10, message: { chat: { id: 3001, type: "private" }, text: "/start leads_nothex!" } });
  await tick(300);
  assert.equal(messagesTo("3001").length, 0, "malformed code ignored");
  ok("malformed payloads ignored");

  console.log(`\nlead telegram: all ${pass} checks passed`);
  process.exit(0);
}
main().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
