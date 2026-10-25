// Post-restore repair: indexes rebuilt, lagging sequences pushed past MAX(id).
// Run: node --import tsx tests/db-repair.itest.ts
import assert from "node:assert/strict";
import pg from "pg";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

async function main() {
  const pgl = await PGlite.create();
  const srv = new PGLiteSocketServer({ db: pgl, port: 55481, host: "127.0.0.1" });
  await srv.start();
  process.env.DATABASE_URL = "postgres://postgres@127.0.0.1:55481/postgres";
  let pass = 0;
  const ok = (m: string) => { pass += 1; console.log(`  ✓ ${m}`); };

  // PGlite serves one connection at a time: set up with a short-lived client.
  const setup = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await setup.connect();
  await setup.query(`CREATE TABLE users (id serial PRIMARY KEY, email text UNIQUE, display_name text NOT NULL)`);
  await setup.query(`INSERT INTO users (id, email, display_name) VALUES (1,'a@x','A'),(312,'b@x','B')`);
  await setup.query(`CREATE TABLE notes (id serial PRIMARY KEY, body text)`);
  await setup.query(`INSERT INTO notes (body) VALUES ('n1'),('n2')`);
  await setup.end();

  const { repairDatabase } = await import("../server/db-repair.ts");
  const report = await repairDatabase(() => {});
  assert.equal(report.failed.length, 0, JSON.stringify(report.failed));
  for (const n of ["public.users_pkey", "public.users_email_key", "public.notes_pkey"]) {
    assert.ok(report.reindexed.includes(n), `${n} rebuilt: ${report.reindexed.join(",")}`);
  }
  ok("every index rebuilt");

  assert.ok(report.sequences.includes("public.users_id_seq"), "users sequence moved");
  assert.ok(!report.sequences.includes("public.notes_id_seq"), "healthy sequence untouched");
  ok("only the lagging sequence was moved");

  const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const r = await c.query(`INSERT INTO users (email, display_name) VALUES ('new@x','N') RETURNING id`);
  assert.equal(r.rows[0].id, 313);
  const n = await c.query(`INSERT INTO notes (body) VALUES ('n3') RETURNING id`);
  assert.equal(n.rows[0].id, 3);
  await c.end();
  ok("signup insert works after repair (id 313), other tables keep their numbering");

  const again = await repairDatabase(() => {});
  assert.equal(again.failed.length, 0, JSON.stringify(again.failed));
  assert.equal(again.sequences.length, 0);
  ok("second run is a no-op for sequences");

  await srv.stop();
  console.log(`db repair: all ${pass} checks passed`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
