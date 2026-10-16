// One form submit = one lead (merge of the two requests a site can fire).
// Run: node --import tsx tests/lead-dedup.itest.ts
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

async function main() {
  const pgl = await PGlite.create();
  const srv = new PGLiteSocketServer({ db: pgl, port: 55471, host: "127.0.0.1" });
  await srv.start();
  process.env.DATABASE_URL = "postgres://postgres@127.0.0.1:55471/postgres";
  process.env.DB_POOL_MAX = "1";

  const { pool } = await import("../server/db.ts");
  await pool.query(`CREATE TABLE leads (
    id serial PRIMARY KEY, project_id integer NOT NULL, name text NOT NULL DEFAULT '',
    email text NOT NULL DEFAULT '', phone text NOT NULL DEFAULT '', message text NOT NULL DEFAULT '',
    source text NOT NULL DEFAULT 'form', is_read integer NOT NULL DEFAULT 0, fingerprint text,
    created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
  const { storage } = await import("../server/storage.ts");
  const count = async (pid: number) => Number((await pool.query(`SELECT count(*)::int AS n FROM leads WHERE project_id = $1`, [pid])).rows[0].n);
  let pass = 0;
  const ok = (m: string) => { pass += 1; console.log(`  ✓ ${m}`); };
  const W = 60_000;

  // 1. the exact case from production: site handler adds "[Сьют: …]", our script sends plain text
  const a = await storage.createOrMergeLead({ projectId: 1, name: "Alex", phone: "+79167383413", message: "упукп", source: "malevich_booking" } as any, W);
  const b = await storage.createOrMergeLead({ projectId: 1, name: "Alex", phone: "+7 916 738-34-13", message: "[Сьют: Черный Квадрат (до 6 гостей)] упукп", source: "malevich_booking" } as any, W);
  assert.equal(a.merged, false);
  assert.equal(b.merged, true);
  assert.equal(b.lead.id, a.lead.id);
  assert.equal(await count(1), 1);
  assert.equal(b.lead.message, "[Сьют: Черный Квадрат (до 6 гостей)] упукп", "the fuller text wins");
  ok("double submit with different text → one lead, fuller text kept");

  // 2. order reversed: fuller text first, shorter second → still the fuller one
  const c = await storage.createOrMergeLead({ projectId: 2, name: "Ира", email: "IRA@mail.ru", message: "Хочу консультацию по тарифам" } as any, W);
  const d = await storage.createOrMergeLead({ projectId: 2, name: "Ира", email: "ira@mail.ru ", message: "Хочу" } as any, W);
  assert.equal(d.merged, true);
  assert.equal(d.lead.message, "Хочу консультацию по тарифам");
  assert.equal(await count(2), 1);
  ok("matching by email (case/space-insensitive); shorter repeat never overwrites");

  // 3. two requests racing (two API instances) → one row
  const racers = await Promise.all([1, 2, 3].map((i) =>
    storage.createOrMergeLead({ projectId: 3, name: "Пётр", phone: "8 (900) 111-22-33", message: "заявка".repeat(i) } as any, W)));
  assert.equal(await count(3), 1, "concurrent duplicates collapse to one row");
  assert.equal(racers.filter((r) => !r.merged).length, 1, "exactly one request creates the lead");
  ok("concurrent duplicates → one row, one creator (advisory lock)");

  // 4. different people on the same site are never merged
  await storage.createOrMergeLead({ projectId: 4, name: "Анна", phone: "+79000000001", message: "привет" } as any, W);
  await storage.createOrMergeLead({ projectId: 4, name: "Анна", phone: "+79000000002", message: "привет" } as any, W);
  assert.equal(await count(4), 2);
  ok("different senders stay separate leads");

  // 5. same person, same site, but later than the window → a new lead
  await pool.query(`UPDATE leads SET created_at = NOW() - interval '5 minutes' WHERE project_id = 1`);
  const e = await storage.createOrMergeLead({ projectId: 1, name: "Alex", phone: "+79167383413", message: "второй раз" } as any, W);
  assert.equal(e.merged, false);
  assert.equal(await count(1), 2);
  ok("same sender after the window → separate lead");

  // 6. same phone on a different site → separate lead
  const f = await storage.createOrMergeLead({ projectId: 5, name: "Alex", phone: "+79167383413", message: "упукп" } as any, W);
  assert.equal(f.merged, false);
  ok("same sender on another site → separate lead");

  console.log(`\nlead dedup: all ${pass} checks passed`);
  process.exit(0);
}
main().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
