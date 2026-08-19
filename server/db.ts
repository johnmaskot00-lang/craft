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
  const ram = Number(process.env.CRAFT_RAM_MB) || 2560;
  return ram >= 5000 ? 30 : 20;
})();

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: poolMax,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 8000,
});

// Gracefully handle unexpected connection errors so the pool auto-recovers
pool.on("error", (err) => {
  console.error("[DB Pool] Unexpected client error:", err.message);
});

export const db = drizzle(pool, { schema });
