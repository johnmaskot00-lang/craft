/**
 * One-shot repair after the partial DB restore (October 2026).
 *
 * The restored cluster came back with corrupted btree indexes: inserts into
 * `users` failed with XX002 "heap tid from index tuple ... points past end of
 * heap page" on users_pkey, so nobody could sign up. Rebuilding the indexes
 * from the heap fixes that. Sequences are also pushed past MAX(id) in case
 * the restore left them behind (that would surface as duplicate-key errors).
 *
 * Runs once per cluster (marker row in maintenance_runs), on one instance
 * (singleton lease), on its own connection without the pool's statement
 * timeout. REINDEX ... CONCURRENTLY keeps tables writable while it works.
 */
import pg from "pg";
import { pool } from "./db";
import { withSingletonLease } from "./singleton-lease";

export const DB_REPAIR_NAME = "reindex-after-restore-2026-10";

type RepairReport = { reindexed: string[]; failed: { index: string; error: string }[]; sequences: string[] };

// Invalid copies left by an interrupted REINDEX CONCURRENTLY are named *_ccnew*.
const CCNEW = String.raw`'%\_ccnew%'`;

export async function repairDatabase(log: (m: string) => void = console.log): Promise<RepairReport> {
  const conn = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await conn.connect();
  const report: RepairReport = { reindexed: [], failed: [], sequences: [] };
  try {
    await conn.query("SET statement_timeout = 0");
    await conn.query("SET lock_timeout = '10s'");

    const dropLeftovers = async () => {
      const left = await conn
        .query<{ name: string }>(`
          SELECT format('%I.%I', n.nspname, c.relname) AS name
            FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'public' AND c.relname LIKE ${CCNEW}`)
        .catch(() => ({ rows: [] as { name: string }[] }));
      for (const r of left.rows) {
        await conn
          .query(`DROP INDEX CONCURRENTLY IF EXISTS ${r.name}`)
          .catch(() => conn.query(`DROP INDEX IF EXISTS ${r.name}`))
          .catch(() => {});
      }
    };
    await dropLeftovers();

    const idx = await conn.query<{ name: string }>(`
      SELECT format('%I.%I', n.nspname, c.relname) AS name
        FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid JOIN pg_namespace n ON n.oid = c.relnamespace
        JOIN pg_class t ON t.oid = i.indrelid
       WHERE n.nspname = 'public' AND t.relkind = 'r' AND c.relname NOT LIKE ${CCNEW}
       ORDER BY pg_relation_size(i.indrelid)`);
    for (const { name } of idx.rows) {
      try {
        await conn.query(`REINDEX INDEX CONCURRENTLY ${name}`);
        report.reindexed.push(name);
      } catch (e: any) {
        // A failed concurrent build leaves an invalid *_ccnew copy behind; drop it
        // and retry with a plain REINDEX (short exclusive lock on that table).
        await dropLeftovers();
        try {
          await conn.query(`REINDEX INDEX ${name}`);
          report.reindexed.push(name);
        } catch (e2: any) {
          report.failed.push({ index: name, error: String(e2?.message || e2).slice(0, 300) });
          log(`[db-repair] reindex ${name} failed: ${e2?.message || e2} (concurrent: ${e?.message || e})`);
        }
      }
    }
    await dropLeftovers();

    // serial/identity columns: make sure nextval() lands past existing ids.
    const seqs = await conn.query<{ tbl: string; col: string; seq: string }>(`
      SELECT format('%I.%I', n.nspname, t.relname) AS tbl, quote_ident(a.attname) AS col,
             pg_get_serial_sequence(format('%I.%I', n.nspname, t.relname), a.attname) AS seq
        FROM pg_class t JOIN pg_namespace n ON n.oid = t.relnamespace
        JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum > 0 AND NOT a.attisdropped
       WHERE n.nspname = 'public' AND t.relkind = 'r'
         AND pg_get_serial_sequence(format('%I.%I', n.nspname, t.relname), a.attname) IS NOT NULL`);
    for (const s of seqs.rows) {
      try {
        const r = await conn.query<{ moved: boolean }>(`
          WITH m AS (SELECT COALESCE(MAX(${s.col}), 0)::bigint AS mx FROM ${s.tbl}),
               cur AS (SELECT last_value, is_called FROM ${s.seq})
          SELECT CASE WHEN m.mx > cur.last_value OR (m.mx = cur.last_value AND NOT cur.is_called)
                      THEN setval($1, m.mx, true) IS NOT NULL ELSE false END AS moved
            FROM m, cur`, [s.seq]);
        if (r.rows[0]?.moved) report.sequences.push(s.seq);
      } catch (e: any) {
        log(`[db-repair] sequence ${s.seq}: ${e?.message || e}`);
      }
    }
  } finally {
    await conn.end().catch(() => {});
  }
  return report;
}

/** Boot hook: run the repair once per cluster, in the background. */
export function scheduleDbRepairOnce(log: (m: string) => void = console.log): void {
  setTimeout(() => {
    void (async () => {
      try {
        await pool.query(`CREATE TABLE IF NOT EXISTS maintenance_runs (
          name text PRIMARY KEY, started_at timestamptz NOT NULL DEFAULT now(),
          finished_at timestamptz, report jsonb)`);
        const done = await pool.query(`SELECT 1 FROM maintenance_runs WHERE name = $1 AND finished_at IS NOT NULL`, [DB_REPAIR_NAME]);
        if (done.rowCount) return;
        await withSingletonLease(`maint-${DB_REPAIR_NAME}`, 6 * 60 * 60_000, async () => {
          log(`[db-repair] starting ${DB_REPAIR_NAME}`);
          await pool.query(
            `INSERT INTO maintenance_runs (name) VALUES ($1) ON CONFLICT (name) DO UPDATE SET started_at = now()`,
            [DB_REPAIR_NAME],
          );
          const report = await repairDatabase(log);
          await pool.query(`UPDATE maintenance_runs SET finished_at = now(), report = $2 WHERE name = $1`, [
            DB_REPAIR_NAME,
            JSON.stringify(report),
          ]);
          log(
            `[db-repair] done: ${report.reindexed.length} indexes rebuilt, ${report.failed.length} failed` +
              (report.failed.length ? ` (${report.failed.map((f) => f.index).join(", ")})` : "") +
              `, sequences moved: ${report.sequences.join(", ") || "none"}`,
          );
        });
      } catch (e: any) {
        log(`[db-repair] aborted: ${e?.message || e}`);
      }
    })();
  }, 20_000).unref?.();
}
