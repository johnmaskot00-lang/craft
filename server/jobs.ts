/**
 * Durable generation / publish jobs + priority queue.
 * API creates jobs; in-process or standalone worker claims queued rows.
 */
import { eq, and, inArray, sql, desc } from "drizzle-orm";
import { db } from "./db";
import { generationJobs, type GenerationJob } from "@shared/schema";

export type JobKind = "site-generate" | "seo-generate" | "seo-edit" | "publish";
export type JobState = "queued" | "running" | "completed" | "failed" | "cancelled";

/** Lower number = higher priority (plan: edit > site > seo). */
export function priorityForKind(kind: JobKind): number {
  switch (kind) {
    case "seo-edit":
      return 1;
    case "site-generate":
    case "publish":
      return 5;
    case "seo-generate":
      return 10;
    default:
      return 5;
  }
}

const WORKER_ID = `${process.env.HOSTNAME || "api"}-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
const JOB_LEASE_MS = Math.max(60_000, Number(process.env.CRAFT_JOB_LEASE_MS) || 15 * 60_000);

let tableReady: Promise<void> | null = null;

export async function ensureGenerationJobsTable(): Promise<void> {
  if (!tableReady) {
    tableReady = (async () => {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS generation_jobs (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL,
          project_id INTEGER NOT NULL,
          kind VARCHAR(32) NOT NULL,
          state VARCHAR(16) NOT NULL DEFAULT 'queued',
          priority INTEGER NOT NULL DEFAULT 5,
          progress JSONB DEFAULT '{}'::jsonb,
          payload JSONB DEFAULT '{}'::jsonb,
          result JSONB,
          error TEXT,
          kie_task_ids JSONB DEFAULT '[]'::jsonb,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          started_at TIMESTAMP,
          finished_at TIMESTAMP,
          lease_until TIMESTAMP,
          worker_id TEXT,
          attempts INTEGER NOT NULL DEFAULT 0
        )
      `);
      for (const stmt of [
        sql`ALTER TABLE generation_jobs ADD COLUMN IF NOT EXISTS lease_until timestamp`,
        sql`ALTER TABLE generation_jobs ADD COLUMN IF NOT EXISTS worker_id text`,
        sql`ALTER TABLE generation_jobs ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0`,
      ]) await db.execute(stmt).catch(() => undefined);
      await db.execute(sql`
        UPDATE generation_jobs
        SET state = 'queued', lease_until = NULL, worker_id = NULL,
            error = COALESCE(error, 'worker lease expired')
        WHERE state = 'running' AND lease_until IS NOT NULL AND lease_until < CURRENT_TIMESTAMP
      `).catch(() => undefined);
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS generation_jobs_lease_idx
        ON generation_jobs (state, lease_until)
      `).catch(() => undefined);
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS generation_jobs_claim_idx
        ON generation_jobs (state, priority ASC, id ASC)
      `);
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS generation_jobs_project_idx
        ON generation_jobs (project_id, created_at DESC)
      `);
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS generation_jobs_user_idx
        ON generation_jobs (user_id, created_at DESC)
      `);
    })().catch((e) => {
      tableReady = null;
      throw e;
    });
  }
  await tableReady;
}

export async function createGenerationJob(input: {
  userId: number;
  projectId: number;
  kind: JobKind;
  state?: JobState;
  payload?: Record<string, unknown>;
  progress?: Record<string, unknown>;
}): Promise<GenerationJob> {
  await ensureGenerationJobsTable();
  const priority = priorityForKind(input.kind);
  const state = input.state || "queued";
  const [row] = await db
    .insert(generationJobs)
    .values({
      userId: input.userId,
      projectId: input.projectId,
      kind: input.kind,
      state,
      priority,
      payload: input.payload || {},
      progress: input.progress || {},
      kieTaskIds: [],
      startedAt: state === "running" ? new Date() : null,
    })
    .returning();
  return row;
}

export async function getGenerationJob(id: number): Promise<GenerationJob | undefined> {
  await ensureGenerationJobsTable();
  const [row] = await db.select().from(generationJobs).where(eq(generationJobs.id, id)).limit(1);
  return row;
}

export async function listProjectJobs(
  projectId: number,
  opts?: { activeOnly?: boolean; limit?: number },
): Promise<GenerationJob[]> {
  await ensureGenerationJobsTable();
  const limit = Math.min(50, Math.max(1, opts?.limit || 20));
  if (opts?.activeOnly) {
    return db
      .select()
      .from(generationJobs)
      .where(
        and(
          eq(generationJobs.projectId, projectId),
          inArray(generationJobs.state, ["queued", "running"]),
        ),
      )
      .orderBy(desc(generationJobs.id))
      .limit(limit);
  }
  return db
    .select()
    .from(generationJobs)
    .where(eq(generationJobs.projectId, projectId))
    .orderBy(desc(generationJobs.id))
    .limit(limit);
}

export async function updateGenerationJob(
  id: number,
  patch: {
    state?: JobState;
    progress?: Record<string, unknown>;
    result?: Record<string, unknown>;
    error?: string | null;
    kieTaskIds?: string[];
    startedAt?: Date | null;
    finishedAt?: Date | null;
  },
): Promise<GenerationJob | undefined> {
  await ensureGenerationJobsTable();
  const values: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.state !== undefined) values.state = patch.state;
  if (patch.progress !== undefined) values.progress = patch.progress;
  if (patch.result !== undefined) values.result = patch.result;
  if (patch.error !== undefined) values.error = patch.error;
  if (patch.kieTaskIds !== undefined) values.kieTaskIds = patch.kieTaskIds;
  if (patch.startedAt !== undefined) values.startedAt = patch.startedAt;
  if (patch.finishedAt !== undefined) values.finishedAt = patch.finishedAt;
  const [row] = await db
    .update(generationJobs)
    .set(values as any)
    .where(
      and(
        eq(generationJobs.id, id),
        sql`(worker_id IS NULL OR worker_id = ${WORKER_ID})`,
      ),
    )
    .returning();
  return row;
}

/** Extend a claimed job lease only while this worker still owns it. */
export async function renewGenerationJobLease(id: number): Promise<boolean> {
  await ensureGenerationJobsTable();
  const result = await db.execute(sql`
    UPDATE generation_jobs
    SET lease_until = CURRENT_TIMESTAMP + (${Math.ceil(JOB_LEASE_MS / 1000)} || ' seconds')::interval,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ${id}
      AND state = 'running'
      AND worker_id = ${WORKER_ID}
      AND lease_until >= CURRENT_TIMESTAMP
    RETURNING id
  `);
  const rows = (result as any)?.rows || (Array.isArray(result) ? result : []);
  return rows.length > 0;
}

export async function completeGenerationJob(
  id: number,
  result?: Record<string, unknown>,
): Promise<void> {
  await updateGenerationJob(id, {
    state: "completed",
    result: result || {},
    finishedAt: new Date(),
    error: null,
  });
}

export async function failGenerationJob(id: number, error: string): Promise<void> {
  await updateGenerationJob(id, {
    state: "failed",
    error: String(error || "failed").slice(0, 2000),
    finishedAt: new Date(),
  });
}

/** Atomically claim next queued job by priority (FOR UPDATE SKIP LOCKED). */
export async function claimNextQueuedJob(
  kinds?: JobKind[],
): Promise<GenerationJob | null> {
  await ensureGenerationJobsTable();
  const kindFilter =
    kinds && kinds.length > 0
      ? sql`AND kind IN (${sql.join(
          kinds.map((k) => sql`${k}`),
          sql`, `,
        )})`
      : sql``;
  const result = await db.execute(sql`
    UPDATE generation_jobs
    SET state = 'running',
        started_at = COALESCE(started_at, CURRENT_TIMESTAMP),
        updated_at = CURRENT_TIMESTAMP,
        lease_until = CURRENT_TIMESTAMP + (${Math.ceil(JOB_LEASE_MS / 1000)} || ' seconds')::interval,
        worker_id = ${WORKER_ID},
        attempts = attempts + 1
    WHERE id = (
      SELECT id FROM generation_jobs
      WHERE (state = 'queued' OR (state = 'running' AND lease_until < CURRENT_TIMESTAMP))
        AND attempts < 3
      ${kindFilter}
      ORDER BY priority ASC, id ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING *
  `);
  const rows = (result as any)?.rows || (Array.isArray(result) ? result : []);
  if (!rows.length) return null;
  const r = rows[0];
  return {
    id: r.id,
    userId: r.user_id,
    projectId: r.project_id,
    kind: r.kind,
    state: r.state,
    priority: r.priority,
    progress: r.progress || {},
    payload: r.payload || {},
    result: r.result,
    error: r.error,
    kieTaskIds: r.kie_task_ids || [],
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    leaseUntil: r.lease_until,
    workerId: r.worker_id,
    attempts: r.attempts || 0,
  } as GenerationJob;
}

export async function queueDepth(): Promise<{ queued: number; running: number }> {
  await ensureGenerationJobsTable();
  const rows = await db.execute(sql`
    SELECT state, COUNT(*)::int AS n
    FROM generation_jobs
    WHERE state IN ('queued', 'running')
    GROUP BY state
  `);
  const list = (rows as any)?.rows || [];
  let queued = 0;
  let running = 0;
  for (const r of list) {
    if (r.state === "queued") queued = r.n;
    if (r.state === "running") running = r.n;
  }
  return { queued, running };
}

/** Soft backpressure threshold before accepting new queued work. */
export function jobQueueOverloaded(depth: { queued: number; running: number }): boolean {
  const maxQueued = Number(process.env.CRAFT_JOB_QUEUE_MAX) || 200;
  return depth.queued >= maxQueued;
}
