/**
 * Cluster-wide singleton jobs.
 *
 * Periodic work (billing, Kling resume scans, retention, backfills) must run on
 * exactly one instance. With several API replicas each process owns its own
 * timers, so the lease below decides who actually executes: the first instance to
 * claim the name wins until the lease expires.
 *
 * Backed by Postgres rather than Redis so it also protects deployments that run
 * without REDIS_URL.
 */
import crypto from "crypto";
import { sql } from "drizzle-orm";
import { db } from "./db";

const HOLDER = `${process.env.HOSTNAME || "instance"}-${crypto.randomBytes(3).toString("hex")}`;

let tableReady: Promise<void> | null = null;

function ensureTable(): Promise<void> {
  if (!tableReady) {
    tableReady = db
      .execute(sql`
        CREATE TABLE IF NOT EXISTS singleton_leases (
          name text PRIMARY KEY,
          holder text NOT NULL,
          expires_at timestamptz NOT NULL
        )
      `)
      .then(() => undefined)
      .catch((e) => {
        tableReady = null;
        throw e;
      });
  }
  return tableReady;
}

/**
 * Runs `fn` only when this instance holds the lease.
 * `ttlMs` should cover the expected duration: the lease is not renewed, it simply
 * expires so the next scheduled tick can claim it again.
 *
 * Returns true when the job ran here.
 */
export async function withSingletonLease(
  name: string,
  ttlMs: number,
  fn: () => Promise<void>,
): Promise<boolean> {
  const ttlSec = Math.max(5, Math.ceil(ttlMs / 1000));
  try {
    await ensureTable();
    const res = await db.execute(sql`
      INSERT INTO singleton_leases (name, holder, expires_at)
      VALUES (${name}, ${HOLDER}, NOW() + (${ttlSec} || ' seconds')::interval)
      ON CONFLICT (name) DO UPDATE
        SET holder = ${HOLDER},
            expires_at = NOW() + (${ttlSec} || ' seconds')::interval
        WHERE singleton_leases.expires_at < NOW()
      RETURNING name
    `);
    if (!(res.rows?.length)) return false;
  } catch (e: any) {
    // Losing the coordination table must not silently stop maintenance work:
    // fall back to running it here, which matches single-instance behaviour.
    console.warn(`[lease] ${name}: falling back to local run —`, e?.message || e);
  }
  await fn();
  return true;
}
