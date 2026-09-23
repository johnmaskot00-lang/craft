/**
 * Event-loop watchdog — runs in a worker thread.
 *
 * Amvera restarts a container only when the process exits. A process that is
 * alive but stuck keeps serving nothing while looking healthy. The previous
 * implementation was a setInterval on the main thread: when the loop is blocked
 * the interval simply never fires, so it could only report a stall AFTER the loop
 * resumed (verified locally) — that is how the API stayed frozen for 73 minutes
 * on 23.09. This version heartbeats from the main thread into shared memory and
 * lets a worker thread observe the gap: the worker keeps running while the main
 * thread is blocked, and kills the process with a signal so the platform replaces
 * the pod (process.exit() inside a worker would only end the worker itself).
 */
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";

const HEARTBEAT_MS = 500;
// Read at call time (not import time) so CRAFT_WATCHDOG_STALL_MS set by the runtime is honoured.
function stallLimitMs(): number {
  return Math.max(10_000, Number(process.env.CRAFT_WATCHDOG_STALL_MS) || 60_000);
}

if (!isMainThread && workerData && workerData.__craftWatchdog) {
  // ---- worker side ----
  const view = new BigInt64Array(workerData.sab as SharedArrayBuffer);
  const limit = Number(workerData.limitMs);
  let strikes = 0;
  setInterval(() => {
    const last = Number(Atomics.load(view, 0));
    const lag = Date.now() - last;
    if (lag <= limit) { strikes = 0; return; }
    strikes++;
    // Two consecutive observations, so a single long GC pause does not kill a healthy instance.
    if (strikes < 2) return;
    // Cannot use the main thread's console (it is blocked) — write straight to fd 2.
    try {
      process.stderr.write(
        `[watchdog] main thread stalled for ${Math.round(lag / 1000)}s — killing process so the platform restarts this instance\n`,
      );
    } catch { /* ignore */ }
    // IMPORTANT: inside a worker, process.exit() only ends the WORKER thread (verified
    // locally — the blocked main thread survived). A signal is delivered by the OS and
    // does not need the main event loop, so it terminates the whole process.
    try { process.kill(process.pid, "SIGKILL"); } catch { /* ignore */ }
    try { process.kill(process.pid, "SIGTERM"); } catch { /* ignore */ }
    process.exit(1);
  }, Math.min(1000, Math.max(250, Math.floor(limit / 10))));
}

export function startWatchdog(): void {
  if (!isMainThread) return;
  if (process.env.CRAFT_WATCHDOG === "0") {
    console.log("[watchdog] disabled via CRAFT_WATCHDOG=0");
    return;
  }

  const sab = new SharedArrayBuffer(8);
  const view = new BigInt64Array(sab);
  Atomics.store(view, 0, BigInt(Date.now()));
  const limitMs = stallLimitMs();

  let worker: Worker;
  try {
    // The server is bundled to CommonJS (dist/index.cjs); __filename resolves to the
    // bundle, which re-enters this module's worker branch on load.
    worker = new Worker(__filename, {
      workerData: { __craftWatchdog: true, sab, limitMs },
    });
  } catch (e: any) {
    console.warn("[watchdog] worker start failed, watchdog disabled:", e?.message || e);
    return;
  }
  worker.unref();
  worker.on("error", (e) => console.warn("[watchdog] worker error:", e?.message || e));

  const beat = setInterval(() => {
    Atomics.store(view, 0, BigInt(Date.now()));
  }, HEARTBEAT_MS);
  beat.unref?.();

  console.log(`[watchdog] armed (worker thread) — restart after ${Math.round(limitMs / 1000)}s stall`);
}
