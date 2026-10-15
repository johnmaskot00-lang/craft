/**
 * One-way migration of existing version snapshots from Postgres into Object Storage.
 *
 * Runs slowly in the background: biggest rows first (they free the most disk),
 * a few per batch so neither the 1.8GB heap nor the database gets a spike.
 * Safe to run repeatedly — already-offloaded rows are skipped.
 */
import { sql } from "drizzle-orm";
import { db } from "./db";
import { deriveProjectContentMeta, extractPreviewImage } from "./site-preview-image";
import { SITE_BLOB_PREFIX, putSiteBlob, siteBlobsEnabled, siteCodeKey, siteFileKey } from "./site-blobs";
import {
  putVersionBlob,
  versionBlobKey,
  versionBlobsEnabled,
  payloadBytes,
  isHealthySnapshot,
  type VersionPayload,
} from "./version-blobs";

type Row = {
  id: number;
  projectId: number;
  code: string | null;
  files: { filename: string; code: string }[] | null;
};

const BATCH_SIZE = Math.max(1, Math.min(10, Number(process.env.CRAFT_BLOB_BACKFILL_BATCH) || 3));
const BATCH_PAUSE_MS = Math.max(250, Number(process.env.CRAFT_BLOB_BACKFILL_PAUSE_MS) || 3000);
const MIN_BYTES = Math.max(4096, Number(process.env.CRAFT_VERSION_BLOB_MIN_BYTES) || 32768);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function nextBatch(): Promise<Row[]> {
  const res = await db.execute(sql`
    SELECT id, project_id AS "projectId", code, files
    FROM project_versions
    WHERE blob_key IS NULL
      AND octet_length(coalesce(code, '')) >= ${MIN_BYTES}
    ORDER BY octet_length(coalesce(code, '')) DESC
    LIMIT ${BATCH_SIZE}
  `);
  return res.rows as Row[];
}

/** Retry durable Object Storage deletions without blocking user requests. */
export async function processObjectDeleteOutbox(): Promise<void> {
  try {
    const rows = await db.execute(sql`
      SELECT id, object_key AS "objectKey", attempts
      FROM object_delete_outbox
      WHERE next_attempt_at <= CURRENT_TIMESTAMP
      ORDER BY id
      LIMIT 20
    `);
    for (const row of rows.rows as Array<{ id: number; objectKey: string; attempts: number }>) {
      try {
        // Last line of defence: never delete a site object a row still points at.
        if (row.objectKey.startsWith(SITE_BLOB_PREFIX)) {
          const live = await db.execute(sql`
            SELECT 1 FROM projects WHERE code_blob_key = ${row.objectKey}
            UNION ALL
            SELECT 1 FROM project_files WHERE blob_key = ${row.objectKey}
            LIMIT 1
          `);
          if (live.rows.length) {
            // Probably queued just before its row was removed (deleteProject); retry later.
            await db.execute(sql`
              UPDATE object_delete_outbox
              SET attempts = attempts + 1, next_attempt_at = CURRENT_TIMESTAMP + interval '1 hour',
                  last_error = 'still referenced'
              WHERE id = ${row.id}
            `);
            continue;
          }
        }
        const { ycMediaDelete } = await import("./yc-media-bucket");
        await ycMediaDelete(row.objectKey);
        await db.execute(sql`DELETE FROM object_delete_outbox WHERE id = ${row.id}`);
      } catch (e: any) {
        const attempts = Number(row.attempts || 0) + 1;
        const delay = Math.min(24 * 60 * 60, 30 * Math.pow(2, Math.min(attempts, 10)));
        await db.execute(sql`
          UPDATE object_delete_outbox
          SET attempts = ${attempts}, next_attempt_at = CURRENT_TIMESTAMP + (${delay} || ' seconds')::interval, last_error = ${String(e?.message || e).slice(0, 500)}
          WHERE id = ${row.id}
        `);
      }
    }
  } catch (e: any) {
    console.warn("[outbox] object deletion pass failed:", e?.message || e);
  }
}

/** Keep finished jobs and long chat histories from growing without bound. */
const JOB_RETENTION_DAYS = Math.max(1, Number(process.env.CRAFT_JOB_RETENTION_DAYS) || 7);
const MESSAGES_PER_PROJECT = Math.max(50, Number(process.env.CRAFT_MESSAGE_RETENTION) || 300);

/**
 * Rows nobody reads again: finished jobs with their payload/result JSON, expired
 * sessions, and chat history beyond what the editor ever shows.
 */
export async function pruneOperationalTables(): Promise<void> {
  try {
    const jobs = await db.execute(sql`
      DELETE FROM generation_jobs
      WHERE state IN ('completed', 'failed', 'cancelled')
        AND coalesce(finished_at, updated_at, created_at) < NOW() - (${JOB_RETENTION_DAYS} || ' days')::interval
      RETURNING id
    `);
    // Abandoned jobs (client vanished, lease never claimed) used to live forever.
    const abandoned = await db.execute(sql`
      DELETE FROM generation_jobs
      WHERE state IN ('queued', 'running')
        AND coalesce(lease_until, updated_at, created_at) < NOW() - (${JOB_RETENTION_DAYS * 2} || ' days')::interval
      RETURNING id
    `);
    const sessions = await db.execute(sql`DELETE FROM session WHERE expire < NOW() RETURNING sid`);
    // Objects that kept failing to delete for a month are not coming back; drop the retry row.
    const deadDeletes = await db.execute(sql`
      DELETE FROM object_delete_outbox
      WHERE attempts >= 12 AND created_at < NOW() - interval '30 days'
      RETURNING id
    `);
    const messages = await db.execute(sql`
      DELETE FROM project_messages
      WHERE id IN (
        SELECT id FROM (
          SELECT id,
                 row_number() OVER (PARTITION BY project_id ORDER BY created_at DESC, id DESC) AS rn
          FROM project_messages
        ) ranked
        WHERE rn > ${MESSAGES_PER_PROJECT}
      )
      RETURNING id
    `);
    const counts = {
      jobs: jobs.rows?.length ?? 0,
      abandonedJobs: abandoned.rows?.length ?? 0,
      sessions: sessions.rows?.length ?? 0,
      messages: messages.rows?.length ?? 0,
      deadDeletes: deadDeletes.rows?.length ?? 0,
    };
    if (Object.values(counts).some(Boolean)) {
      console.log("[prune] operational tables:", counts);
    }
  } catch (e: any) {
    console.warn("[prune] operational tables failed:", e?.message || e);
  }
}

/**
 * Fill `projects.preview_image` for sites saved before the column existed.
 * Reads a bounded slice of the HTML so a few hundred projects cannot spike the heap.
 */
export async function backfillProjectPreviewImages(): Promise<void> {
  let scanned = 0;
  let filled = 0;
  try {
    for (;;) {
      // Never filter with octet_length(generated_code) — that detoasts every
      // candidate row and is what stalled the shared Postgres pool under load.
      const res = await db.execute(sql`
        SELECT id, left(coalesce(generated_code, ''), 200000) AS head
        FROM projects
        WHERE preview_image IS NULL
        ORDER BY updated_at DESC NULLS LAST, id DESC
        LIMIT 10
      `);
      const rows = res.rows as Array<{ id: number; head: string | null }>;
      if (!rows.length) break;

      for (const row of rows) {
        const src = extractPreviewImage(row.head);
        // Empty string marks "already scanned, nothing found" so the loop terminates.
        await db.execute(sql`
          UPDATE projects SET preview_image = ${src ?? ""} WHERE id = ${row.id}
        `);
        scanned += 1;
        if (src) filled += 1;
      }
      await sleep(750);
      // Cap a single pass so boot/maintenance cannot monopolize the pool.
      if (scanned >= 200) break;
    }
    if (scanned) console.log(`[projects] preview backfill: ${filled}/${scanned} sites got a thumbnail`);
  } catch (e: any) {
    console.warn("[projects] preview backfill failed:", e?.message || e);
  }
}

export async function backfillVersionBlobs(): Promise<void> {
  if (!versionBlobsEnabled()) {
    console.log("[versions] blob backfill skipped — Object Storage disabled");
    return;
  }
  let moved = 0;
  let bytes = 0;
  try {
    for (;;) {
      const rows = await nextBatch();
      if (!rows.length) break;

      for (const row of rows) {
        const payload: VersionPayload = { code: row.code || "", files: row.files ?? null };
        const size = payloadBytes(payload);
        const key = versionBlobKey(row.projectId, row.id);
        try {
          await putVersionBlob(key, payload);
          await db.execute(sql`
            UPDATE project_versions
            SET code = '',
                files = NULL,
                blob_key = ${key},
                code_bytes = ${size},
                has_files = ${!!payload.files?.length},
                healthy = ${isHealthySnapshot(payload.code)}
            WHERE id = ${row.id}
          `);
          moved += 1;
          bytes += size;
        } catch (e: any) {
          console.warn(`[versions] backfill failed for version ${row.id}:`, e?.message || e);
          return;
        }
      }
      console.log(`[versions] blob backfill progress: ${moved} snapshots, ${(bytes / 1048576).toFixed(1)}MB moved`);
      await sleep(BATCH_PAUSE_MS);
    }

    if (moved) {
      console.log(
        `[versions] blob backfill done: ${moved} snapshots, ${(bytes / 1048576).toFixed(1)}MB now in Object Storage. ` +
          "Set CRAFT_VACUUM_VERSIONS=1 to reclaim the freed Postgres pages.",
      );
    }

    // VACUUM FULL takes an exclusive lock, so it only runs when explicitly asked for.
    if (process.env.CRAFT_VACUUM_VERSIONS === "1") {
      console.log("[versions] VACUUM FULL project_versions started");
      await db.execute(sql`VACUUM (FULL, ANALYZE) project_versions`);
      const size = await db.execute(sql`
        SELECT pg_total_relation_size('project_versions')::bigint AS bytes,
               pg_database_size(current_database())::bigint AS db_bytes
      `);
      console.log("[versions] VACUUM FULL done:", size.rows?.[0]);
    }
  } catch (e: any) {
    console.warn("[versions] blob backfill aborted:", e?.message || e);
  }
}

const SITE_MIN_BYTES = Math.max(256, Number(process.env.CRAFT_SITE_BLOB_MIN_BYTES) || 2048);
const SITE_MAX_BYTES = Math.max(SITE_MIN_BYTES, Number(process.env.CRAFT_SITE_BLOB_MAX_BYTES) || 24 * 1024 * 1024);

/**
 * One-way move of existing site code (projects.generated_code, project_files.code)
 * into Object Storage, plus a refresh of the scan flags for rows saved before those
 * columns existed. Race-safe: the row is only cleared when its content is still the
 * one that was uploaded (compare-and-swap on md5). A concurrent edit wins, and the
 * next pass picks the row up again. Safe to run repeatedly.
 */
export async function backfillSiteBlobs(opts: { maxRows?: number } = {}): Promise<{ projects: number; files: number; bytes: number }> {
  const stats = { projects: 0, files: 0, bytes: 0 };
  const maxRows = Math.max(1, opts.maxRows ?? 2000);
  if (!siteBlobsEnabled()) {
    console.log("[site-blobs] backfill skipped — Object Storage disabled");
    return stats;
  }
  try {
    let lastId = 0;
    while (stats.projects < maxRows) {
      const res = await db.execute(sql`
        SELECT id, generated_code AS code, md5(generated_code) AS digest
        FROM projects
        WHERE code_blob_key IS NULL
          AND id > ${lastId}
          AND octet_length(generated_code) BETWEEN ${SITE_MIN_BYTES} AND ${SITE_MAX_BYTES}
        ORDER BY id
        LIMIT ${BATCH_SIZE}
      `);
      const rows = res.rows as Array<{ id: number; code: string; digest: string }>;
      if (!rows.length) break;
      for (const row of rows) {
        lastId = row.id;
        const key = siteCodeKey(row.id);
        await putSiteBlob(key, row.code);
        const meta = deriveProjectContentMeta(row.code);
        const swapped = await db.execute(sql`
          UPDATE projects
          SET generated_code = '', code_blob_key = ${key},
              code_bytes = ${meta.codeBytes},
              generating_placeholder = ${meta.generatingPlaceholder},
              anim_pending = ${meta.animPending},
              anim_ready = ${meta.animReady},
              anim_task_pending = ${meta.animTaskPending},
              has_scroll_jacking = ${meta.hasScrollJacking}
          WHERE id = ${row.id} AND code_blob_key IS NULL AND md5(generated_code) = ${row.digest}
          RETURNING id
        `);
        if (swapped.rows.length) {
          stats.projects += 1;
          stats.bytes += meta.codeBytes;
        } else {
          // Edited mid-upload: the uploaded object is now an orphan.
          await db.execute(sql`INSERT INTO object_delete_outbox (object_key) VALUES (${key}) ON CONFLICT DO NOTHING`);
        }
      }
      await sleep(BATCH_PAUSE_MS);
    }

    lastId = 0;
    while (stats.files < maxRows * 20) {
      const res = await db.execute(sql`
        SELECT id, project_id AS "projectId", filename, code, md5(code) AS digest
        FROM project_files
        WHERE blob_key IS NULL
          AND id > ${lastId}
          AND octet_length(code) BETWEEN ${SITE_MIN_BYTES} AND ${SITE_MAX_BYTES}
        ORDER BY id
        LIMIT ${BATCH_SIZE * 4}
      `);
      const rows = res.rows as Array<{ id: number; projectId: number; filename: string; code: string; digest: string }>;
      if (!rows.length) break;
      for (const row of rows) {
        lastId = row.id;
        const key = siteFileKey(row.projectId, row.filename);
        await putSiteBlob(key, row.code);
        const bytes = Buffer.byteLength(row.code, "utf8");
        const swapped = await db.execute(sql`
          UPDATE project_files SET code = '', blob_key = ${key}, code_bytes = ${bytes}
          WHERE id = ${row.id} AND blob_key IS NULL AND md5(code) = ${row.digest}
          RETURNING id
        `);
        if (swapped.rows.length) {
          stats.files += 1;
          stats.bytes += bytes;
        } else {
          await db.execute(sql`INSERT INTO object_delete_outbox (object_key) VALUES (${key}) ON CONFLICT DO NOTHING`);
        }
      }
      await sleep(Math.min(BATCH_PAUSE_MS, 1000));
    }
    if (stats.projects || stats.files) {
      console.log(
        `[site-blobs] backfill: ${stats.projects} sites + ${stats.files} pages, ${(stats.bytes / 1048576).toFixed(1)}MB moved to Object Storage`,
      );
    }
  } catch (e: any) {
    // Stops on the first failure (e.g. storage outage); rows already moved stay moved.
    console.warn("[site-blobs] backfill aborted:", e?.message || e);
  }
  return stats;
}

/**
 * Inline rows saved before the scan-flag columns existed have them all false.
 * Recompute from the inline HTML (offloaded rows got correct flags on write).
 */
export async function backfillProjectScanFlags(): Promise<number> {
  let fixed = 0;
  try {
    // All scanner flags, for inline rows whose cached flags disagree with the HTML.
    // Offloaded rows got correct flags when they were written.
    const res = await db.execute(sql`
      WITH f AS (
        SELECT id,
               position('data-scroll-anim-task-id="' in generated_code) > 0 AS task,
               position('Scroll-jacking: lock page scroll while animation plays' in generated_code) > 0 AS jack,
               position('data-scroll-anim-pending="1"' in generated_code) > 0 AS pending,
               position('data-craft-generating="1"' in generated_code) > 0 AS generating
        FROM projects
        WHERE code_blob_key IS NULL
      )
      UPDATE projects p
      SET anim_task_pending = f.task, has_scroll_jacking = f.jack,
          anim_pending = f.pending, generating_placeholder = f.generating
      FROM f
      WHERE p.id = f.id
        AND (p.anim_task_pending, p.has_scroll_jacking, p.anim_pending, p.generating_placeholder)
            IS DISTINCT FROM (f.task, f.jack, f.pending, f.generating)
      RETURNING p.id
    `);
    fixed = res.rows.length;
    if (fixed) console.log(`[projects] scan flags refreshed for ${fixed} site(s)`);
  } catch (e: any) {
    console.warn("[projects] scan flag backfill failed:", e?.message || e);
  }
  return fixed;
}

/**
 * Reverse of backfillSiteBlobs: copy site code from Object Storage back into the
 * rows. Run this BEFORE deploying code older than the offload (it reads
 * generated_code directly and would see empty sites). Also set CRAFT_SITE_BLOBS=0
 * first so new saves stay inline. Objects are left in place (the outbox/grace
 * period handles them); only the pointers are cleared.
 */
export async function inlineSiteBlobs(): Promise<{ projects: number; files: number; failed: number }> {
  const { getSiteBlob } = await import("./site-blobs");
  const stats = { projects: 0, files: 0, failed: 0 };
  let lastId = 0;
  for (;;) {
    const res = await db.execute(sql`
      SELECT id, code_blob_key AS key FROM projects
      WHERE code_blob_key IS NOT NULL AND id > ${lastId} ORDER BY id LIMIT 20
    `);
    const rows = res.rows as Array<{ id: number; key: string }>;
    if (!rows.length) break;
    for (const row of rows) {
      lastId = row.id;
      try {
        const code = await getSiteBlob(row.key);
        const done = await db.execute(sql`
          UPDATE projects SET generated_code = ${code}, code_blob_key = NULL
          WHERE id = ${row.id} AND code_blob_key = ${row.key} RETURNING id
        `);
        if (done.rows.length) stats.projects += 1;
      } catch (e: any) {
        stats.failed += 1;
        console.warn(`[site-blobs] inline failed for project ${row.id}:`, e?.message || e);
      }
    }
  }
  lastId = 0;
  for (;;) {
    const res = await db.execute(sql`
      SELECT id, blob_key AS key FROM project_files
      WHERE blob_key IS NOT NULL AND id > ${lastId} ORDER BY id LIMIT 50
    `);
    const rows = res.rows as Array<{ id: number; key: string }>;
    if (!rows.length) break;
    for (const row of rows) {
      lastId = row.id;
      try {
        const code = await getSiteBlob(row.key);
        const done = await db.execute(sql`
          UPDATE project_files SET code = ${code}, blob_key = NULL
          WHERE id = ${row.id} AND blob_key = ${row.key} RETURNING id
        `);
        if (done.rows.length) stats.files += 1;
      } catch (e: any) {
        stats.failed += 1;
        console.warn(`[site-blobs] inline failed for file ${row.id}:`, e?.message || e);
      }
    }
  }
  console.log("[site-blobs] inline (rollback prep):", stats);
  return stats;
}
