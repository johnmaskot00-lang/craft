/**
 * Priority job worker — processes queued generation_jobs.
 * Runs in-process (API) and/or as `npm run worker` / dist/worker.cjs.
 *
 * site-generate / seo-* are normally started inline (SSE) and only tracked as
 * durable jobs. Queued `publish` (and future detached kinds) are executed here.
 */
import {
  claimNextQueuedJob,
  completeGenerationJob,
  failGenerationJob,
  type JobKind,
  ensureGenerationJobsTable,
} from "./jobs";

export type JobHandler = (job: {
  id: number;
  userId: number;
  projectId: number;
  kind: string;
  payload: Record<string, unknown>;
}) => Promise<Record<string, unknown> | void>;

const handlers = new Map<string, JobHandler>();

export function registerJobHandler(kind: JobKind | string, handler: JobHandler): void {
  handlers.set(kind, handler);
}

let loopTimer: ReturnType<typeof setInterval> | null = null;
let ticking = false;

const DEFAULT_KINDS: JobKind[] = ["publish"];

export async function processOneJob(kinds: JobKind[] = DEFAULT_KINDS): Promise<boolean> {
  const job = await claimNextQueuedJob(kinds);
  if (!job) return false;
  const handler = handlers.get(job.kind);
  if (!handler) {
    await failGenerationJob(job.id, `No handler for kind=${job.kind}`);
    return true;
  }
  try {
    const result = await handler({
      id: job.id,
      userId: job.userId,
      projectId: job.projectId,
      kind: job.kind,
      payload: (job.payload as Record<string, unknown>) || {},
    });
    await completeGenerationJob(job.id, (result as Record<string, unknown>) || {});
  } catch (e: any) {
    console.error(`[worker] job ${job.id} failed:`, e?.message || e);
    await failGenerationJob(job.id, e?.message || String(e));
  }
  return true;
}

export function startInProcessWorker(opts?: {
  intervalMs?: number;
  kinds?: JobKind[];
}): void {
  if (process.env.CRAFT_RUN_WORKER === "0") {
    console.log("[worker] CRAFT_RUN_WORKER=0 — in-process worker disabled");
    return;
  }
  if (loopTimer) return;
  const intervalMs = Math.max(500, opts?.intervalMs ?? (Number(process.env.CRAFT_WORKER_INTERVAL_MS) || 2000));
  const kinds = opts?.kinds || DEFAULT_KINDS;
  void ensureGenerationJobsTable().catch((e) =>
    console.warn("[worker] ensure table:", e?.message || e),
  );
  loopTimer = setInterval(() => {
    if (ticking) return;
    ticking = true;
    void processOneJob(kinds)
      .catch((e) => console.warn("[worker] tick:", e?.message || e))
      .finally(() => {
        ticking = false;
      });
  }, intervalMs);
  loopTimer.unref?.();
  console.log(`[worker] in-process loop every ${intervalMs}ms kinds=${kinds.join(",")}`);
}

export function stopInProcessWorker(): void {
  if (loopTimer) {
    clearInterval(loopTimer);
    loopTimer = null;
  }
}
