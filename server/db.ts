import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set");
}

const poolMax = (() => {
  const n = Number(process.env.DB_POOL_MAX);
  if (Number.isFinite(n) && n > 0) return Math.floor(n);
  // 2.5GB Amvera ≈ 20; 6GB can go higher via DB_POOL_MAX / CRAFT_RAM_MB.
  // When running N API instances, set DB_POOL_MAX so N * pool < Postgres max_connections.
  const instances = Math.max(1, Number(process.env.CRAFT_API_INSTANCES) || 1);
  const ram = Number(process.env.CRAFT_RAM_MB) || 2560;
  const base = ram >= 5000 ? 30 : 20;
  return Math.max(5, Math.floor(base / instances));
})();

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: poolMax,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 8000,
  // Cap any single query so a TOAST detoast / lock wait cannot pin a connection
  // forever and starve /api/auth/user (infinite dashboard spinner).
  statement_timeout: Math.max(5_000, Number(process.env.DB_STATEMENT_TIMEOUT_MS) || 15_000),
  query_timeout: Math.max(5_000, Number(process.env.DB_QUERY_TIMEOUT_MS) || 20_000),
});

// Gracefully handle unexpected connection errors so the pool auto-recovers
pool.on("error", (err) => {
  console.error("[DB Pool] Unexpected client error:", err.message);
});

pool.on("connect", (client) => {
  // Defense in depth if the driver ignores constructor timeouts on older pg.
  void client.query("SET statement_timeout = '15s'").catch(() => undefined);
  void client.query("SET lock_timeout = '8s'").catch(() => undefined);
});

export const db = drizzle(pool, { schema });
