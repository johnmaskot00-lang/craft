/**
 * Nightly logical backup of the whole Postgres database to Yandex Object Storage,
 * independent of the hosting provider's own backups (the 08.10 restore lost rows
 * and nobody noticed until users logged in).
 *
 * Format — one object per table, gzipped JSON Lines, plus a manifest:
 *   backups/<stamp>/<table>.jsonl.gz   first line {"columns":[{name,type},…]}, then one row per line
 *   backups/<stamp>/manifest.json      tables, row counts, bytes, sha256 per object
 * Rows are read through a server-side cursor in batches, gzipped as a stream and
 * uploaded in multipart parts, so memory stays bounded whatever the table size.
 *
 * Verification re-downloads every object, counts rows and checks the checksum
 * against the manifest; `restoreBackup` replays an archive into an EMPTY database
 * (tests run it end to end). A failed backup or verification alerts the admin in
 * Telegram.
 *
 * Bucket: CRAFT_BACKUP_BUCKET (default "<media bucket>-backups"), private. Keep it
 * separate from the media bucket so one bad credential or lifecycle rule cannot
 * take out both the data and its backup.
 */
import crypto from "crypto";
import { createGunzip, createGzip } from "zlib";
import { PassThrough, Readable } from "stream";
import { pipeline } from "stream/promises";
import readline from "readline";
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateBucketCommand,
  CreateMultipartUploadCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutBucketVersioningCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import pg from "pg";

export const BACKUP_PREFIX = "backups/";
const PART_BYTES = 8 * 1024 * 1024; // S3 minimum is 5MB for all but the last part
const FETCH_ROWS = Math.max(1, Number(process.env.CRAFT_BACKUP_FETCH_ROWS) || 500);
/** Target bytes per FETCH; rows of multi-MB HTML get small batches, tiny rows big ones. */
const FETCH_BYTES = Math.max(256 * 1024, Number(process.env.CRAFT_BACKUP_FETCH_BYTES) || 16 * 1024 * 1024);
const KEEP_DAYS = Math.max(3, Number(process.env.CRAFT_BACKUP_KEEP_DAYS) || 14);
/** Cap one restore INSERT so a table of multi-MB rows does not build a giant query. */
const RESTORE_BATCH_BYTES = Math.max(16 * 1024, Number(process.env.CRAFT_RESTORE_BATCH_BYTES) || 4 * 1024 * 1024);

export function backupBucket(): string {
  return (
    process.env.CRAFT_BACKUP_BUCKET ||
    `${process.env.CRAFT_MEDIA_BUCKET || "craft-ai-media"}-backups`
  );
}

export function backupsEnabled(): boolean {
  if (process.env.CRAFT_BACKUPS === "0") return false;
  return Boolean(process.env.YC_KEY_ID && process.env.YC_SECRET);
}

let client: S3Client | null = null;
export function backupS3(): S3Client {
  if (client) return client;
  client = new S3Client({
    region: "ru-central1",
    endpoint: process.env.CRAFT_BACKUP_S3_ENDPOINT || "https://storage.yandexcloud.net",
    forcePathStyle: !!process.env.CRAFT_BACKUP_S3_ENDPOINT,
    credentials: {
      accessKeyId: process.env.YC_KEY_ID || "",
      secretAccessKey: process.env.YC_SECRET || "",
    },
  });
  return client;
}

/** Allows tests to inject an in-memory S3. */
export function __setBackupS3(c: S3Client | null): void {
  client = c;
  bucketReady = false;
}

let bucketReady = false;
async function ensureBucket(s3: S3Client, bucket: string): Promise<void> {
  if (bucketReady) return;
  try {
    await s3.send(new CreateBucketCommand({ Bucket: bucket }));
    console.log(`[backup] created bucket ${bucket}`);
  } catch (err: any) {
    const name = err?.name || err?.Code || "";
    if (name !== "BucketAlreadyOwnedByYou" && name !== "BucketAlreadyExists") throw err;
  }
  // Versioning: an overwritten or deleted backup object stays recoverable.
  await s3
    .send(new PutBucketVersioningCommand({ Bucket: bucket, VersioningConfiguration: { Status: "Enabled" } }))
    .catch((e: any) => console.warn("[backup] could not enable bucket versioning:", e?.message || e));
  bucketReady = true;
}

export type TableManifest = { table: string; rows: number; bytes: number; sha256: string; key: string };
export type BackupManifest = {
  version: 1;
  stamp: string;
  startedAt: string;
  finishedAt: string;
  database: string;
  serverVersion: string;
  tables: TableManifest[];
};

function stampNow(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

/** Plain user tables in `public`, biggest-risk ordering irrelevant (each table is independent). */
async function listTables(conn: pg.ClientBase): Promise<string[]> {
  const r = await conn.query(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
  );
  return r.rows.map((x: any) => String(x.tablename));
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/**
 * Multipart upload of a readable stream. Returns total bytes + sha256 of what was
 * stored. Aborts the upload on any failure so no half-object is left behind.
 */
async function uploadStream(s3: S3Client, bucket: string, key: string, body: Readable): Promise<{ bytes: number; sha256: string }> {
  const hash = crypto.createHash("sha256");
  const { UploadId } = await s3.send(
    new CreateMultipartUploadCommand({ Bucket: bucket, Key: key, ContentType: "application/gzip" }),
  );
  if (!UploadId) throw new Error(`no UploadId for ${key}`);
  const parts: { ETag: string; PartNumber: number }[] = [];
  let bytes = 0;
  let buf: Buffer[] = [];
  let bufLen = 0;
  const flush = async () => {
    if (!bufLen && parts.length) return;
    const chunk = Buffer.concat(buf, bufLen);
    buf = [];
    bufLen = 0;
    const PartNumber = parts.length + 1;
    const out = await s3.send(new UploadPartCommand({ Bucket: bucket, Key: key, UploadId, PartNumber, Body: chunk }));
    parts.push({ ETag: out.ETag || "", PartNumber });
  };
  try {
    for await (const chunk of body) {
      const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      hash.update(b);
      bytes += b.length;
      buf.push(b);
      bufLen += b.length;
      if (bufLen >= PART_BYTES) await flush();
    }
    await flush();
    await s3.send(
      new CompleteMultipartUploadCommand({ Bucket: bucket, Key: key, UploadId, MultipartUpload: { Parts: parts } }),
    );
  } catch (e) {
    await s3.send(new AbortMultipartUploadCommand({ Bucket: bucket, Key: key, UploadId })).catch(() => undefined);
    throw e;
  }
  return { bytes, sha256: hash.digest("hex") };
}

/** Dump one table through a cursor inside the caller's REPEATABLE READ transaction. */
async function dumpTable(conn: pg.ClientBase, s3: S3Client, bucket: string, stamp: string, table: string): Promise<TableManifest> {
  const key = `${BACKUP_PREFIX}${stamp}/${table}.jsonl.gz`;
  const cols = await conn.query(
    `SELECT a.attname AS name, format_type(a.atttypid, a.atttypmod) AS type
       FROM pg_attribute a
      WHERE a.attrelid = $1::regclass AND a.attnum > 0 AND NOT a.attisdropped
      ORDER BY a.attnum`,
    [`public.${quoteIdent(table)}`],
  );
  const columns = cols.rows.map((r: any) => ({ name: String(r.name), type: String(r.type) }));
  // Average row size (planner stats, no table scan) picks a batch that fits FETCH_BYTES.
  const width = await conn.query(
    `SELECT coalesce(sum(avg_width), 0)::bigint AS w FROM pg_stats WHERE schemaname = 'public' AND tablename = $1`,
    [table],
  );
  const avgRow = Math.max(64, Number(width.rows[0]?.w || 0));
  let fetchRows = Math.max(1, Math.min(FETCH_ROWS, Math.floor(FETCH_BYTES / avgRow)));
  // Every value as text: no lossy JSON round-trip for numerics, timestamps, bytea.
  const select = columns.map((c) => `${quoteIdent(c.name)}::text AS ${quoteIdent(c.name)}`).join(", ") || "1";
  const cursor = `bk_${crypto.randomBytes(4).toString("hex")}`;
  await conn.query(`DECLARE ${cursor} NO SCROLL CURSOR FOR SELECT ${select} FROM public.${quoteIdent(table)}`);

  let rows = 0;
  let aborted = false;
  // Rows → JSON lines. A generator feeding stream.pipeline: an error on either side
  // (FETCH, gzip, S3) rejects the pipeline instead of becoming an unhandled 'error'.
  async function* lines(): AsyncGenerator<string> {
    yield JSON.stringify({ columns }) + "\n";
    for (;;) {
      if (aborted) return;
      const batch = await conn.query(`FETCH ${fetchRows} FROM ${cursor}`);
      if (!batch.rows.length) return;
      let bytes = 0;
      for (const row of batch.rows) {
        const line = JSON.stringify(columns.map((c) => row[c.name] ?? null)) + "\n";
        bytes += line.length;
        rows += 1;
        yield line;
      }
      // Stats can be stale: adapt to what this batch actually weighed.
      const perRow = bytes / batch.rows.length;
      fetchRows = Math.max(1, Math.min(FETCH_ROWS, Math.floor(FETCH_BYTES / Math.max(64, perRow))));
    }
  }

  const gzip = createGzip({ level: 6 });
  const upload = uploadStream(s3, bucket, key, gzip);
  try {
    await Promise.all([
      pipeline(Readable.from(lines()), gzip),
      upload.catch((e) => {
        // Upload died: stop producing so nothing keeps using the connection.
        aborted = true;
        gzip.destroy(e);
        throw e;
      }),
    ]);
  } finally {
    // Both sides have settled here (Promise.all rejects early, so wait explicitly).
    await Promise.allSettled([upload]);
    await conn.query(`CLOSE ${cursor}`).catch(() => undefined);
  }
  const up = await upload;
  return { table, rows, bytes: up.bytes, sha256: up.sha256, key };
}

/**
 * Own connection, not the app pool: the pool sets client-side query_timeout (20s)
 * and server statement_timeout (15s) that a long FETCH would trip, and session-level
 * SETs here must not leak back into a pooled connection.
 */
async function backupConnection(): Promise<pg.Client> {
  const conn = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await conn.connect();
  await conn.query("SET statement_timeout = 0");
  await conn.query("SET idle_in_transaction_session_timeout = 0");
  await conn.query("SET lock_timeout = '30s'");
  return conn;
}

export async function runBackup(): Promise<BackupManifest> {
  const s3 = backupS3();
  const bucket = backupBucket();
  await ensureBucket(s3, bucket);
  const stamp = stampNow();
  const startedAt = new Date().toISOString();
  const conn = await backupConnection();
  const tables: TableManifest[] = [];
  let serverVersion = "";
  let database = "";
  try {
    // One snapshot for all tables: counts and foreign keys stay consistent.
    await conn.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const meta = await conn.query("SELECT current_database() AS db, version() AS v");
    database = String(meta.rows[0]?.db || "");
    serverVersion = String(meta.rows[0]?.v || "");
    for (const table of await listTables(conn)) {
      tables.push(await dumpTable(conn, s3, bucket, stamp, table));
    }
    await conn.query("COMMIT");
  } catch (e) {
    await conn.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    await conn.end().catch(() => undefined);
  }
  const manifest: BackupManifest = {
    version: 1,
    stamp,
    startedAt,
    finishedAt: new Date().toISOString(),
    database,
    serverVersion,
    tables,
  };
  // The manifest is written last: a backup without one is incomplete by definition.
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: `${BACKUP_PREFIX}${stamp}/manifest.json`,
      Body: JSON.stringify(manifest, null, 2),
      ContentType: "application/json",
    }),
  );
  return manifest;
}

async function getObjectStream(s3: S3Client, bucket: string, key: string): Promise<Readable> {
  const out = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  return out.Body as Readable;
}

/** Stream a table archive: yields the header once, then row arrays. Checks sha256. */
async function* readTableArchive(s3: S3Client, bucket: string, t: TableManifest): AsyncGenerator<{ columns?: { name: string; type: string }[]; row?: (string | null)[] }> {
  const raw = await getObjectStream(s3, bucket, t.key);
  const hash = crypto.createHash("sha256");
  let bytes = 0;
  const counted = new PassThrough();
  counted.on("data", (b: Buffer) => { hash.update(b); bytes += b.length; });
  const out = new PassThrough();
  // pipeline forwards an error from any stage (network reset, bad gzip) to `out`,
  // which ends the readline loop below with that error instead of hanging.
  const piping = pipeline(raw, counted, createGunzip(), out);
  piping.catch(() => undefined);
  const lines = readline.createInterface({ input: out, crlfDelay: Infinity });
  const failed = new Promise<never>((_, reject) => out.once("error", reject));
  failed.catch(() => undefined);
  let first = true;
  try {
    for await (const line of lines) {
      if (!line) continue;
      const parsed = JSON.parse(line);
      if (first) {
        first = false;
        yield { columns: parsed.columns };
      } else {
        yield { row: parsed };
      }
    }
    await Promise.race([piping, failed]);
  } finally {
    lines.close();
    raw.destroy();
  }
  const sha = hash.digest("hex");
  if (sha !== t.sha256 || bytes !== t.bytes) {
    throw new Error(`${t.table}: checksum mismatch (sha ${sha.slice(0, 12)} vs ${t.sha256.slice(0, 12)}, ${bytes} vs ${t.bytes} bytes)`);
  }
}

export async function readManifest(stamp: string): Promise<BackupManifest> {
  const s3 = backupS3();
  const body = await getObjectStream(s3, backupBucket(), `${BACKUP_PREFIX}${stamp}/manifest.json`);
  const chunks: Buffer[] = [];
  for await (const c of body) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export type VerifyResult = { ok: boolean; problems: string[]; tables: number; rows: number };

/**
 * Re-download every table, verify checksum and row count, and compare against the
 * live database. The live count may only have grown since the backup; a table that
 * shrank sharply is reported — that is exactly how the incomplete 08.10 restore
 * would have shown up.
 */
export async function verifyBackup(manifest: BackupManifest, pool?: pg.Pool): Promise<VerifyResult> {
  const s3 = backupS3();
  const bucket = backupBucket();
  const problems: string[] = [];
  let rows = 0;
  for (const t of manifest.tables) {
    try {
      let n = 0;
      for await (const item of readTableArchive(s3, bucket, t)) if (item.row) n += 1;
      if (n !== t.rows) problems.push(`${t.table}: archive has ${n} rows, manifest says ${t.rows}`);
      rows += n;
    } catch (e: any) {
      problems.push(`${t.table}: ${e?.message || e}`);
    }
  }
  if (pool) {
    for (const t of manifest.tables) {
      if (t.rows < 20) continue;
      try {
        const r = await pool.query(`SELECT count(*)::bigint AS n FROM public.${quoteIdent(t.table)}`);
        const live = Number(r.rows[0]?.n || 0);
        // Retention jobs legitimately delete sessions / jobs / messages; core tables must not shrink.
        const core = ["users", "projects", "credit_transactions", "payment_orders", "project_files"];
        if (core.includes(t.table) && live < t.rows * 0.9) {
          problems.push(`${t.table}: live database has ${live} rows, backup had ${t.rows}`);
        }
      } catch {
        /* table may have been dropped on purpose */
      }
    }
  }
  return { ok: problems.length === 0, problems, tables: manifest.tables.length, rows };
}

/**
 * Replay an archive into a database whose tables already exist and are EMPTY
 * (create them by booting the app once, or with drizzle-kit push). Refuses to touch
 * a table that has rows. Sequences are advanced past the restored ids.
 */
export async function restoreBackup(
  manifest: BackupManifest,
  opts: { tables?: string[]; connectionString?: string } = {},
): Promise<{ table: string; rows: number }[]> {
  const s3 = backupS3();
  const bucket = backupBucket();
  const only = opts.tables ? new Set(opts.tables) : null;
  const conn = new pg.Client({ connectionString: opts.connectionString || process.env.DATABASE_URL });
  await conn.connect();
  const done: { table: string; rows: number }[] = [];
  try {
    await conn.query("SET statement_timeout = 0");
    for (const t of manifest.tables) {
      if (only && !only.has(t.table)) continue;
      const exists = await conn.query(`SELECT to_regclass($1) AS r`, [`public.${quoteIdent(t.table)}`]);
      if (!exists.rows[0]?.r) {
        console.warn(`[restore] skipping ${t.table}: table does not exist in target`);
        continue;
      }
      const has = await conn.query(`SELECT 1 FROM public.${quoteIdent(t.table)} LIMIT 1`);
      if (has.rows.length) throw new Error(`refusing to restore into non-empty table ${t.table}`);
      const live = await conn.query(
        `SELECT a.attname AS name FROM pg_attribute a
          WHERE a.attrelid = $1::regclass AND a.attnum > 0 AND NOT a.attisdropped`,
        [`public.${quoteIdent(t.table)}`],
      );
      const liveCols = new Set(live.rows.map((r: any) => String(r.name)));
      let columns: { name: string; type: string }[] = [];
      let keep: number[] = [];
      let batch: (string | null)[][] = [];
      let batchBytes = 0;
      let count = 0;
      const flush = async () => {
        if (!batch.length) return;
        const names = keep.map((i) => quoteIdent(columns[i].name)).join(", ");
        // Text values are cast back by Postgres to the column type.
        const values: (string | null)[] = [];
        const tuples = batch.map((row) => {
          const ph = keep.map((i) => {
            values.push(row[i]);
            return `$${values.length}::${columns[i].type}`;
          });
          return `(${ph.join(", ")})`;
        });
        await conn.query(`INSERT INTO public.${quoteIdent(t.table)} (${names}) VALUES ${tuples.join(", ")}`, values);
        batch = [];
        batchBytes = 0;
      };
      await conn.query("BEGIN");
      try {
        for await (const item of readTableArchive(s3, bucket, t)) {
          if (item.columns) {
            columns = item.columns;
            keep = columns.map((c, i) => (liveCols.has(c.name) ? i : -1)).filter((i) => i >= 0);
            continue;
          }
          const row = item.row!;
          // A row bigger than one batch goes alone; otherwise flush before it overflows.
          let rowBytes = 0;
          for (const i of keep) rowBytes += (row[i]?.length ?? 0) * 2;
          if (batch.length && batchBytes + rowBytes > RESTORE_BATCH_BYTES) await flush();
          batch.push(row);
          batchBytes += rowBytes;
          count += 1;
          // Stay well under Postgres' 65535 bind-parameter limit.
          if (batch.length * Math.max(1, keep.length) >= 20000) await flush();
        }
        await flush();
        // Move serial sequences past the restored ids.
        const seqs = await conn.query(
          `SELECT a.attname AS col, pg_get_serial_sequence($1, a.attname) AS seq
             FROM pg_attribute a
            WHERE a.attrelid = $1::regclass AND a.attnum > 0 AND NOT a.attisdropped`,
          [`public.${quoteIdent(t.table)}`],
        );
        for (const s of seqs.rows as Array<{ col: string; seq: string | null }>) {
          if (!s.seq) continue;
          await conn.query(
            `SELECT setval($1, GREATEST((SELECT coalesce(max(${quoteIdent(s.col)}), 0) FROM public.${quoteIdent(t.table)}), 1))`,
            [s.seq],
          );
        }
        await conn.query("COMMIT");
      } catch (e) {
        await conn.query("ROLLBACK").catch(() => undefined);
        throw e;
      }
      if (count !== t.rows) throw new Error(`${t.table}: restored ${count} rows, manifest says ${t.rows}`);
      done.push({ table: t.table, rows: count });
    }
  } finally {
    await conn.end().catch(() => undefined);
  }
  return done;
}

/** Stamps of complete backups (those with a manifest), newest first. */
export async function listBackups(): Promise<string[]> {
  const s3 = backupS3();
  const bucket = backupBucket();
  const stamps: string[] = [];
  let token: string | undefined;
  do {
    const out = await s3.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: BACKUP_PREFIX, ContinuationToken: token }),
    );
    for (const o of out.Contents || []) {
      const m = (o.Key || "").match(/^backups\/([^/]+)\/manifest\.json$/);
      if (m) stamps.push(m[1]);
    }
    token = out.IsTruncated ? out.NextContinuationToken : undefined;
  } while (token);
  return stamps.sort().reverse();
}

/** Delete backups older than KEEP_DAYS, always keeping the newest 3. */
export async function pruneBackups(): Promise<number> {
  const s3 = backupS3();
  const bucket = backupBucket();
  const stamps = await listBackups();
  const cutoff = Date.now() - KEEP_DAYS * 86400_000;
  const old = stamps.slice(3).filter((st) => {
    const iso = st.replace(/^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/, "$1T$2:$3:$4.$5Z");
    const t = Date.parse(iso);
    return Number.isFinite(t) && t < cutoff;
  });
  let removed = 0;
  for (const st of old) {
    const keys: { Key: string }[] = [];
    let token: string | undefined;
    do {
      const out = await s3.send(
        new ListObjectsV2Command({ Bucket: bucket, Prefix: `${BACKUP_PREFIX}${st}/`, ContinuationToken: token }),
      );
      for (const o of out.Contents || []) if (o.Key) keys.push({ Key: o.Key });
      token = out.IsTruncated ? out.NextContinuationToken : undefined;
    } while (token);
    for (let i = 0; i < keys.length; i += 1000) {
      await s3.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: keys.slice(i, i + 1000) } }));
    }
    removed += 1;
  }
  return removed;
}

export function summarizeManifest(m: BackupManifest): string {
  const totalRows = m.tables.reduce((s, t) => s + t.rows, 0);
  const totalMb = m.tables.reduce((s, t) => s + t.bytes, 0) / 1048576;
  const pick = (name: string) => m.tables.find((t) => t.table === name)?.rows ?? 0;
  return `${m.tables.length} таблиц, ${totalRows} строк, ${totalMb.toFixed(1)} МБ (users=${pick("users")}, projects=${pick("projects")})`;
}
