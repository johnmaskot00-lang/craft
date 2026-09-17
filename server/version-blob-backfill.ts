/**
 * One-way migration of existing version snapshots from Postgres into Object Storage.
 *
 * Runs slowly in the background: biggest rows first (they free the most disk),
 * a few per batch so neither the 1.8GB heap nor the database gets a spike.
 * Safe to run repeatedly — already-offloaded rows are skipped.
 */
import { sql } from "drizzle-orm";
import { db } from "./db";
import { extractPreviewImage } from "./site-preview-image";
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

/**
 * Fill `projects.preview_image` for sites saved before the column existed.
 * Reads a bounded slice of the HTML so a few hundred projects cannot spike the heap.
 */
export async function backfillProjectPreviewImages(): Promise<void> {
  let scanned = 0;
  let filled = 0;
  try {
    for (;;) {
      const res = await db.execute(sql`
        SELECT id, left(coalesce(generated_code, ''), 200000) AS head
        FROM projects
        WHERE preview_image IS NULL
          AND octet_length(coalesce(generated_code, '')) > 80
        ORDER BY id DESC
        LIMIT 25
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
      await sleep(500);
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
