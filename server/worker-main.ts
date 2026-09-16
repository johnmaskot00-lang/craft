/**
 * Standalone worker entry (Amvera second process or local `npm run worker`).
 * Claims queued jobs by priority: seo-edit > site/publish > seo-generate.
 */
import { ensureGenerationJobsTable } from "./jobs";
import { processOneJob, registerJobHandler, startInProcessWorker } from "./job-worker";

async function main() {
  await ensureGenerationJobsTable();
  registerJobHandler("publish", async (job) => {
    throw new Error(
      `Standalone worker cannot publish job ${job.id} yet — run with API in-process worker (CRAFT_RUN_WORKER=1)`,
    );
  });

  startInProcessWorker({
    intervalMs: Number(process.env.CRAFT_WORKER_INTERVAL_MS) || 1500,
    kinds: ["publish", "seo-edit", "site-generate", "seo-generate"],
  });
  console.log("[worker-main] running (Ctrl+C to stop)");
  await new Promise(() => {});
}

main().catch((e) => {
  console.error("[worker-main]", e);
  process.exit(1);
});
