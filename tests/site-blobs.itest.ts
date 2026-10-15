// Integration test: real Postgres (PGlite wire server) + in-memory S3 stub.
// Run: node --import tsx --import ./tests/register-stubs.mjs tests/site-blobs.itest.ts
// Needs a throwaway Postgres at DATABASE_URL (it DROPs the project tables).
import assert from "node:assert/strict";
import path from "node:path";

import { fileURLToPath, pathToFileURL } from "node:url";
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mod = (rel: string) => pathToFileURL(path.join(REPO, rel)).href;
// DATABASE_URL is set in main() (in-process PGlite) unless ITEST_EXTERNAL_DB=1.
process.env.YC_KEY_ID = "test";
process.env.YC_SECRET = "test";
process.env.CRAFT_SITE_BLOB_MIN_BYTES = "256";
process.env.CRAFT_BLOB_BACKFILL_PAUSE_MS = "250";
// PGlite serves one connection at a time.
process.env.DB_POOL_MAX = "1";

async function main() {
  // In-process Postgres (PGlite) unless a real DATABASE_URL was supplied.
  // A separate PGlite process crashes when a client disconnects, so keep it here.
  if (!process.env.ITEST_EXTERNAL_DB) {
    const { PGlite } = await import("@electric-sql/pglite");
    const { PGLiteSocketServer } = await import("@electric-sql/pglite-socket");
    const pgl = await PGlite.create();
    const srv = new PGLiteSocketServer({ db: pgl, port: 55433, host: "127.0.0.1" });
    await srv.start();
    process.env.DATABASE_URL = "postgres://postgres@127.0.0.1:55433/postgres";
  }
  const { objects, control } = await import("./media-stub.ts");
  const { db, pool } = await import(mod("server/db.ts"));
  const { sql } = await import("drizzle-orm");
  const { storage } = await import(mod("server/storage.ts"));
  const backfill = await import(mod("server/version-blob-backfill.ts"));
  const { __resetSiteBlobCache } = await import(mod("server/site-blobs.ts"));

  // Schema: drizzle-kit would do this in prod via boot ALTERs; create directly here.
  await db.execute(sql`DROP TABLE IF EXISTS projects, project_files, project_versions, project_messages, project_images, leads, object_delete_outbox CASCADE`);
  await db.execute(sql`CREATE TABLE projects (
    id serial PRIMARY KEY, user_id integer NOT NULL, title text NOT NULL, description text,
    generated_code text NOT NULL DEFAULT '', gemini_interaction_id text, published_url text,
    publish_status text NOT NULL DEFAULT 'draft', vercel_project_id text, yc_storage_pool_id integer,
    custom_domain text, preview_image text, code_bytes integer NOT NULL DEFAULT 0, code_blob_key text,
    generating_placeholder boolean NOT NULL DEFAULT false, anim_pending boolean NOT NULL DEFAULT false,
    anim_ready boolean NOT NULL DEFAULT false, anim_task_pending boolean NOT NULL DEFAULT false,
    has_scroll_jacking boolean NOT NULL DEFAULT false, type varchar(20) NOT NULL DEFAULT 'website',
    seo_config json, created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
  await db.execute(sql`CREATE TABLE project_files (id serial PRIMARY KEY, project_id integer NOT NULL,
    filename text NOT NULL, code text NOT NULL, blob_key text, code_bytes integer NOT NULL DEFAULT 0,
    created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
  await db.execute(sql`CREATE UNIQUE INDEX project_files_project_id_filename_uniq ON project_files (project_id, filename)`);
  await db.execute(sql`CREATE TABLE project_versions (id serial PRIMARY KEY, project_id integer NOT NULL,
    code text NOT NULL DEFAULT '', label text NOT NULL DEFAULT '', files json, blob_key text,
    code_bytes integer NOT NULL DEFAULT 0, has_files boolean NOT NULL DEFAULT false,
    healthy boolean NOT NULL DEFAULT true, created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
  await db.execute(sql`CREATE TABLE project_messages (id serial PRIMARY KEY, project_id integer NOT NULL, role text NOT NULL, content text NOT NULL, created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
  await db.execute(sql`CREATE TABLE project_images (id serial PRIMARY KEY, project_id integer NOT NULL, user_id integer, name text NOT NULL, url text NOT NULL, prompt text NOT NULL DEFAULT '', created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
  await db.execute(sql`CREATE TABLE leads (id serial PRIMARY KEY, project_id integer NOT NULL, is_read integer NOT NULL DEFAULT 0, created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
  await db.execute(sql`CREATE TABLE object_delete_outbox (id serial PRIMARY KEY, object_key text NOT NULL UNIQUE, attempts integer NOT NULL DEFAULT 0, next_attempt_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP, last_error text, created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP)`);

  const big = (tag: string) => `<!DOCTYPE html><html><body>${tag}${"<p>Привет мир, это сайт</p>".repeat(40)}</body></html>`;
  const rawRow = async (id: number) =>
    (await db.execute(sql`SELECT generated_code, code_blob_key, code_bytes, anim_task_pending FROM projects WHERE id = ${id}`)).rows[0] as any;
  const outbox = async () => (await db.execute(sql`SELECT object_key FROM object_delete_outbox ORDER BY id`)).rows.map((r: any) => r.object_key);
  let pass = 0;
  const ok = (name: string) => { pass++; console.log("  ✓", name); };

  // 1. create → code lives in the object store, row only has a pointer
  const v1 = big("v1");
  const p = await storage.createProject({ userId: 1, title: "A", generatedCode: v1 });
  let r = await rawRow(p.id);
  assert.equal(r.generated_code, "");
  assert.ok(r.code_blob_key?.startsWith(`sites/p${p.id}/main/`));
  assert.equal(p.generatedCode, v1, "create returns real code");
  assert.equal((await storage.getProject(p.id))!.generatedCode, v1);
  __resetSiteBlobCache();
  assert.equal((await storage.getProject(p.id))!.generatedCode, v1, "reads from store, not cache");
  ok("create offloads + getProject hydrates");

  // 2. update → new key, old key queued, flags from real HTML
  const k1 = r.code_blob_key;
  const v2 = big('v2 <div data-scroll-anim-task-id="abc"></div>');
  const upd = await storage.updateProject(p.id, { generatedCode: v2 });
  assert.equal(upd!.generatedCode, v2);
  r = await rawRow(p.id);
  assert.notEqual(r.code_blob_key, k1);
  assert.equal(r.anim_task_pending, true, "scan flag set from HTML");
  assert.deepEqual(await outbox(), [k1]);
  // Superseded site objects outlive DB backups: not deletable for ~3 weeks.
  const due = (await db.execute(sql`SELECT next_attempt_at > NOW() + interval '20 days' AS later FROM object_delete_outbox WHERE object_key = ${k1}`)).rows[0] as any;
  assert.equal(due.later, true, "site object delete is delayed past backup retention");
  await backfill.processObjectDeleteOutbox();
  assert.ok(objects.has(k1), "old object kept during grace period");
  // let the rest of the test exercise actual deletion
  await db.execute(sql`UPDATE object_delete_outbox SET next_attempt_at = NOW()`);
  assert.deepEqual(await storage.listProjectIdsWithAnimTaskId(), [p.id]);
  ok("update writes new object, queues old one, sets scan flags");

  // 3. metadata-only update keeps code and returns hydrated row
  const meta = await storage.updateProject(p.id, { title: "B" });
  assert.equal(meta!.generatedCode, v2);
  assert.equal((await rawRow(p.id)).code_blob_key, r.code_blob_key);
  // stale caller spread cannot clobber the pointer
  await storage.updateProject(p.id, { title: "C", codeBlobKey: "bogus" } as any);
  assert.equal((await rawRow(p.id)).code_blob_key, r.code_blob_key);
  ok("metadata update preserves pointer, ignores caller codeBlobKey");

  // 4. small code stays inline
  const tiny = await storage.createProject({ userId: 1, title: "T", generatedCode: "<p>hi</p>" });
  r = await rawRow(tiny.id);
  assert.equal(r.generated_code, "<p>hi</p>");
  assert.equal(r.code_blob_key, null);
  ok("tiny code stays inline");

  // 5. S3 outage → write still succeeds inline, nothing lost
  control.failPuts = true;
  const v3 = big("v3-outage");
  await storage.updateProject(p.id, { generatedCode: v3 });
  control.failPuts = false;
  r = await rawRow(p.id);
  assert.equal(r.generated_code, v3);
  assert.equal(r.code_blob_key, null);
  assert.equal((await storage.getProject(p.id))!.generatedCode, v3);
  ok("upload failure falls back to inline, no data loss");

  // 6. files: upsert offloads, overwrite queues old key, read hydrates
  const f1 = big("page1");
  await storage.upsertProjectFile({ projectId: p.id, filename: "about.html", code: f1 });
  const fr1 = (await db.execute(sql`SELECT code, blob_key FROM project_files WHERE project_id = ${p.id}`)).rows[0] as any;
  assert.equal(fr1.code, "");
  assert.ok(fr1.blob_key);
  const f2 = big("page2");
  const saved = await storage.upsertProjectFile({ projectId: p.id, filename: "about.html", code: f2 });
  assert.equal(saved.code, f2);
  assert.ok((await outbox()).includes(fr1.blob_key), "old file object queued");
  const files = await storage.getProjectFiles(p.id);
  assert.equal(files.length, 1);
  assert.equal(files[0].code, f2);
  assert.equal((await storage.getProjectFile(p.id, "about.html"))!.code, f2);
  ok("project files offload/overwrite/hydrate");

  // 7. duplicate gets its own objects
  await storage.updateProject(p.id, { generatedCode: v2 });
  const copy = await storage.duplicateProject(p.id, 1);
  assert.ok(copy);
  const cr = await rawRow(copy!.id);
  assert.ok(cr.code_blob_key?.startsWith(`sites/p${copy!.id}/`));
  assert.equal((await storage.getProject(copy!.id))!.generatedCode, v2);
  assert.equal((await storage.getProjectFiles(copy!.id))[0].code, f2);
  ok("duplicate copies into its own keys");

  // 8. delete queues every key; outbox refuses to delete a live key
  const liveCopyKey = cr.code_blob_key;
  await storage.deleteProject(p.id);
  await db.execute(sql`UPDATE object_delete_outbox SET next_attempt_at = NOW()`);
  const q = await outbox();
  assert.ok(q.some((k: string) => k.startsWith(`sites/p${p.id}/main/`)));
  assert.ok(q.some((k: string) => k.startsWith(`sites/p${p.id}/files/`)));
  await db.execute(sql`INSERT INTO object_delete_outbox (object_key) VALUES (${liveCopyKey})`);
  await backfill.processObjectDeleteOutbox();
  await backfill.processObjectDeleteOutbox();
  assert.ok(objects.has(liveCopyKey), "live object survived outbox");
  const kept = (await db.execute(sql`SELECT last_error FROM object_delete_outbox WHERE object_key = ${liveCopyKey}`)).rows[0] as any;
  assert.equal(kept?.last_error, "still referenced", "live key stays queued for retry, not dropped");
  assert.equal((await storage.getProject(copy!.id))!.generatedCode, v2);
  assert.ok(![...objects.keys()].some((k) => k.startsWith(`sites/p${p.id}/`)), "deleted project's objects gone");
  ok("delete queues all keys; outbox never deletes a live object");

  // 9. backfill moves legacy inline rows, CAS loses to a concurrent edit
  const legacy = big("legacy");
  const ins = await db.execute(sql`INSERT INTO projects (user_id, title, generated_code) VALUES (1, 'L', ${legacy}) RETURNING id`);
  const lid = (ins.rows[0] as any).id;
  await db.execute(sql`INSERT INTO project_files (project_id, filename, code) VALUES (${lid}, 'x.html', ${legacy})`);
  const stats = await backfill.backfillSiteBlobs();
  assert.ok(stats.projects >= 1 && stats.files >= 1);
  assert.equal((await rawRow(lid)).generated_code, "");
  __resetSiteBlobCache();
  assert.equal((await storage.getProject(lid))!.generatedCode, legacy);
  assert.equal((await storage.getProjectFiles(lid))[0].code, legacy);
  ok("backfill moves inline sites + pages");

  const race = big("race-original");
  const ins2 = await db.execute(sql`INSERT INTO projects (user_id, title, generated_code) VALUES (1, 'R', ${race}) RETURNING id`);
  const rid = (ins2.rows[0] as any).id;
  const edited = big("race-edited-during-upload");
  control.beforePut = async () => {
    await db.execute(sql`UPDATE projects SET generated_code = ${edited} WHERE id = ${rid}`);
  };
  await backfill.backfillSiteBlobs();
  control.beforePut = null;
  const rr = await rawRow(rid);
  assert.equal(rr.generated_code, edited, "concurrent edit kept");
  assert.equal(rr.code_blob_key, null);
  ok("backfill CAS never overwrites a concurrent edit");

  // 10. scan-flag backfill for legacy inline rows
  const ins3 = await db.execute(sql`INSERT INTO projects (user_id, title, generated_code) VALUES (1, 'K', '<div data-scroll-anim-task-id="z"></div>') RETURNING id`);
  const kid = (ins3.rows[0] as any).id;
  await backfill.backfillProjectScanFlags();
  assert.equal((await rawRow(kid)).anim_task_pending, true);
  ok("scan flag backfill");

  // 11. rollback lever: inline everything back, rows readable without Object Storage
  const inl = await backfill.inlineSiteBlobs();
  assert.equal(inl.failed, 0);
  const left = (await db.execute(sql`SELECT count(*)::int AS n FROM projects WHERE code_blob_key IS NOT NULL`)).rows[0] as any;
  assert.equal(left.n, 0);
  assert.equal((await rawRow(copy!.id)).generated_code, v2, "inline code restored in the row");
  ok("inlineSiteBlobs restores rows for rollback");

  console.log(`\nall ${pass} checks passed`);
  await pool.end();
  process.exit(0);
}

main().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
