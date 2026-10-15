// End-to-end: backup → verify → restore into an empty DB → compare every row.
// Run: node --import tsx tests/db-backup.itest.ts
import assert from "node:assert/strict";
import pg from "pg";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

// ── in-memory S3 implementing just the commands db-backup.ts sends ──────────
class MemS3 {
  objects = new Map<string, Buffer>();
  uploads = new Map<string, Map<number, Buffer>>();
  corrupt: string | null = null;
  failGet: string | null = null; // stream errors mid-download
  failPart = 0; // UploadPart number that throws
  async send(cmd: any): Promise<any> {
    const name = cmd.constructor.name as string;
    const i = cmd.input;
    switch (name) {
      case "CreateBucketCommand":
      case "PutBucketVersioningCommand":
        return {};
      case "PutObjectCommand":
        this.objects.set(i.Key, Buffer.from(i.Body));
        return {};
      case "CreateMultipartUploadCommand": {
        const id = `u${this.uploads.size + 1}`;
        this.uploads.set(id, new Map());
        return { UploadId: id };
      }
      case "UploadPartCommand":
        if (this.failPart && i.PartNumber === this.failPart) throw new Error("simulated part upload failure");
        this.uploads.get(i.UploadId)!.set(i.PartNumber, Buffer.from(i.Body));
        return { ETag: `"e${i.PartNumber}"` };
      case "CompleteMultipartUploadCommand": {
        const parts = this.uploads.get(i.UploadId)!;
        const nums = i.MultipartUpload.Parts.map((p: any) => p.PartNumber);
        this.objects.set(i.Key, Buffer.concat(nums.map((n: number) => parts.get(n)!)));
        this.uploads.delete(i.UploadId);
        return {};
      }
      case "AbortMultipartUploadCommand":
        this.uploads.delete(i.UploadId);
        return {};
      case "GetObjectCommand": {
        let b = this.objects.get(i.Key);
        if (!b) throw Object.assign(new Error("NoSuchKey"), { name: "NoSuchKey" });
        if (this.corrupt === i.Key) b = Buffer.concat([b.subarray(0, b.length - 3), Buffer.from([1, 2, 3])]);
        const { Readable } = await import("node:stream");
        if (this.failGet === i.Key) {
          const half = b.subarray(0, Math.floor(b.length / 2));
          return { Body: new Readable({ read() { this.push(half); this.destroy(Object.assign(new Error("ECONNRESET"), { code: "ECONNRESET" })); } }) };
        }
        return { Body: Readable.from([b]) };
      }
      case "ListObjectsV2Command": {
        const keys = [...this.objects.keys()].filter((k) => k.startsWith(i.Prefix || "")).sort();
        return { Contents: keys.map((Key) => ({ Key })), IsTruncated: false };
      }
      case "DeleteObjectsCommand":
        for (const o of i.Delete.Objects) this.objects.delete(o.Key);
        return {};
      default:
        throw new Error(`MemS3: unsupported ${name}`);
    }
  }
}

async function startPg(port: number) {
  const db = await PGlite.create();
  const srv = new PGLiteSocketServer({ db, port, host: "127.0.0.1" });
  await srv.start();
  return new pg.Pool({ connectionString: `postgres://postgres@127.0.0.1:${port}/postgres`, max: 1 });
}

const SCHEMA = `
  CREATE TABLE users (id serial PRIMARY KEY, display_name text, email text, credits integer NOT NULL DEFAULT 0,
                      telegram_id text UNIQUE, created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP);
  CREATE TABLE projects (id serial PRIMARY KEY, user_id integer NOT NULL, title text NOT NULL,
                         generated_code text NOT NULL DEFAULT '', seo_config json, price numeric(12,4),
                         tags text[], blob bytea, flag boolean NOT NULL DEFAULT false, updated_at timestamptz);
  CREATE TABLE empty_table (id serial PRIMARY KEY, note text);
`;

async function main() {
  process.env.YC_KEY_ID = "k";
  process.env.YC_SECRET = "s";
  process.env.CRAFT_BACKUP_FETCH_ROWS = "50"; // force many cursor batches
  // PGlite crashes on wire messages over ~64KB; real Postgres uses the 4MB default.
  process.env.CRAFT_RESTORE_BATCH_BYTES = "40000";
  const bk = await import("../server/db-backup.ts");
  const s3 = new MemS3();
  bk.__setBackupS3(s3 as any);

  const SRC = "postgres://postgres@127.0.0.1:55441/postgres";
  const DST = "postgres://postgres@127.0.0.1:55442/postgres";
  const FRESH = "postgres://postgres@127.0.0.1:55443/postgres";
  process.env.DATABASE_URL = SRC; // runBackup opens its own connection from DATABASE_URL
  const src = await startPg(55441);
  console.log("  … pg up");
  for (const stmt of SCHEMA.split(";").map((x) => x.trim()).filter(Boolean)) await src.query(stmt);
  console.log("  … schema");
  // awkward values: quotes, newlines, cyrillic, emoji, JSON, arrays, NULLs, bytea, numerics
  for (let n = 1; n <= 260; n++) {
    await src.query(
      `INSERT INTO users (display_name, email, credits, telegram_id) VALUES ($1, $2, $3, $4)`,
      [n % 7 === 0 ? null : `Пользователь "${n}"\n'кавычки' 🚀`, n % 3 ? `u${n}@x.ru` : null, n * 10, n % 5 ? `tg${n}` : null],
    );
  }
  await src.query(`DELETE FROM users WHERE id IN (50, 51)`); // gaps in ids must survive
  // PGlite's socket server crashes on a single wire message over ~64KB, so the
  // "large" value stays below that. Multipart streaming is exercised below via
  // PART_BYTES-sized output regardless (many rows → many parts).
  const big = "<html>" + "Сайт ".repeat(5000) + "</html>";
  for (let n = 1; n <= 120; n++) {
    await src.query(
      `INSERT INTO projects (user_id, title, generated_code, seo_config, price, tags, blob, flag, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [n, `Проект ${n}`, n === 3 ? big : `<p>${n}</p>`, n % 2 ? JSON.stringify({ h1: `Заголовок ${n}`, list: [1, 2, n] }) : null,
       n % 4 ? `${n}.1234` : null, n % 3 ? [`a${n}`, "б в", 'q"x'] : null, n % 2 ? Buffer.from([0, 255, n % 256]) : null,
       n % 2 === 0, n % 6 ? new Date(Date.UTC(2026, 9, n % 28 + 1, 12, 30, 15, 123)) : null],
    );
  }

  const dump = async (pool: pg.Pool, t: string) =>
    (await pool.query(`SELECT * FROM ${t} ORDER BY id`)).rows.map((r) =>
      JSON.stringify(r, (_k, v) => (v instanceof Buffer ? `\\x${v.toString("hex")}` : v)),
    );

  const snapshot = { users: await dump(src, "users"), projects: await dump(src, "projects") };

  // 1. backup
  const manifest = await bk.runBackup();
  const byName = Object.fromEntries(manifest.tables.map((t) => [t.table, t]));
  assert.equal(byName.users.rows, 258);
  assert.equal(byName.projects.rows, 120);
  assert.equal(byName.empty_table.rows, 0);
  assert.ok(s3.objects.has(`backups/${manifest.stamp}/manifest.json`));
  console.log("  ✓ backup:", bk.summarizeManifest(manifest));

  // 2. verify
  const v = await bk.verifyBackup(manifest, src);
  assert.deepEqual(v.problems, []);
  assert.equal(v.rows, 378);
  console.log("  ✓ verify: checksums + row counts match");

  // 3. verify catches corruption and a shrunken live table
  s3.corrupt = byName.projects.key;
  const bad = await bk.verifyBackup(manifest, src);
  assert.ok(bad.problems.some((p) => p.includes("projects")), "corruption detected");
  s3.corrupt = null;
  await src.query(`DELETE FROM users WHERE id > 100`);
  const shrunk = await bk.verifyBackup(manifest, src);
  assert.ok(shrunk.problems.some((p) => p.startsWith("users: live database has")), "lost rows detected");
  console.log("  ✓ verify detects corrupted archive and lost live rows");

  // 3b. failures reject cleanly — no uncaught stream error, no hang
  let uncaught: unknown = null;
  const onUncaught = (e: unknown) => { uncaught = e; };
  process.on("uncaughtException", onUncaught);
  s3.failGet = byName.users.key;
  const t0 = Date.now();
  const dl = await bk.verifyBackup(manifest);
  assert.ok(dl.problems.some((p) => p.startsWith("users:") && /ECONNRESET/.test(p)), `download failure reported: ${dl.problems}`);
  assert.ok(Date.now() - t0 < 10_000, "verify did not hang");
  s3.failGet = null;
  // Part 1 always exists (the header line), so failing it exercises the abort path.
  s3.failPart = 1;
  await assert.rejects(() => bk.runBackup(), /simulated part upload failure/);
  s3.failPart = 0;
  await new Promise((r) => setTimeout(r, 300));
  process.off("uncaughtException", onUncaught);
  assert.equal(uncaught, null, `no uncaught exception: ${uncaught}`);
  assert.equal(s3.uploads.size, 0, "failed multipart upload aborted");
  // the source DB is still usable after the aborted dump
  assert.ok((await src.query("SELECT count(*)::int AS n FROM users")).rows[0].n > 0);
  console.log("  ✓ download / upload failures reject cleanly (no crash, no hang, upload aborted)");

  // 4. restore into a fresh, empty database and compare everything
  const dst = await startPg(55442);
  await dst.query(SCHEMA);
  const restored = await bk.restoreBackup(manifest, { connectionString: DST });
  assert.deepEqual(Object.fromEntries(restored.map((r) => [r.table, r.rows])), { empty_table: 0, projects: 120, users: 258 });
  const srcFresh = await startPg(55443); // pristine copy for comparison (src was mutated above)
  await srcFresh.query(SCHEMA);
  await bk.restoreBackup(manifest, { connectionString: FRESH });
  for (const t of ["users", "projects"] as const) {
    assert.deepEqual(await dump(dst, t), snapshot[t], `${t}: restored rows differ from backup-time rows`);
  }
  // compare against what src held at backup time: re-derive from the backup-time rows
  const projA = await dump(dst, "projects");
  const p3 = (await dst.query(`SELECT generated_code FROM projects WHERE id = 3`)).rows[0].generated_code;
  assert.equal(p3, big, "large text intact");
  const u7 = (await dst.query(`SELECT display_name, email FROM users WHERE id = 7`)).rows[0];
  assert.equal(u7.display_name, null);
  const u1 = (await dst.query(`SELECT display_name FROM users WHERE id = 1`)).rows[0].display_name;
  assert.equal(u1, `Пользователь "1"\n'кавычки' 🚀`);
  const pj = (await dst.query(`SELECT seo_config, tags, blob, price, updated_at FROM projects WHERE id = 1`)).rows[0];
  assert.deepEqual(pj.seo_config, { h1: "Заголовок 1", list: [1, 2, 1] });
  assert.deepEqual(pj.tags, ["a1", "б в", 'q"x']);
  assert.equal(pj.blob.toString("hex"), "00ff01");
  assert.equal(pj.price, "1.1234");
  assert.equal(new Date(pj.updated_at).toISOString(), "2026-10-02T12:30:15.123Z");
  assert.equal((await dst.query(`SELECT count(*)::int AS n FROM users WHERE id IN (50,51)`)).rows[0].n, 0, "gaps kept");
  assert.equal(projA.length, 120);
  console.log("  ✓ restore: all rows, types, NULLs, gaps, bytea, json, arrays intact");

  // 5. sequences moved past restored ids
  const ins = await dst.query(`INSERT INTO users (display_name) VALUES ('new') RETURNING id`);
  assert.equal(ins.rows[0].id, 261);
  console.log("  ✓ sequences advanced (next id 261)");

  // 6. restore refuses a non-empty target
  await assert.rejects(() => bk.restoreBackup(manifest, { connectionString: DST }), /non-empty table/);
  console.log("  ✓ restore refuses to overwrite data");

  // 7. listing + pruning keeps the newest 3
  const stamps: string[] = [];
  process.env.DATABASE_URL = FRESH;
  for (let k = 0; k < 5; k++) {
    await new Promise((r) => setTimeout(r, 5));
    stamps.push((await bk.runBackup()).stamp);
  }
  assert.equal((await bk.listBackups()).length, 6);
  process.env.CRAFT_BACKUP_KEEP_DAYS = "3";
  const removed = await bk.pruneBackups();
  assert.equal(removed, 0, "recent backups are never pruned");
  console.log("  ✓ list + prune (recent kept)");

  console.log("\ndb backup: all checks passed");
  process.exit(0);
}
main().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
