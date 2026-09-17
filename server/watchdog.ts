/**
 * Event-loop watchdog.
 *
 * Amvera restarts a container only when the process exits. A process that is
 * alive but stuck — a long CPU-bound operation or heap thrashing near the 1.8GB
 * limit — keeps serving nothing while looking healthy, which is exactly how the
 * API went down once. Here the process notices that itself and exits so the
 * platform can replace it.
 */
const TICK_MS = 1000;
const STALL_LIMIT_MS = Math.max(
  10_000,
  Number(process.env.CRAFT_WATCHDOG_STALL_MS) || 60_000,
);

export function startWatchdog(): void {
  if (process.env.CRAFT_WATCHDOG === "0") {
    console.log("[watchdog] disabled via CRAFT_WATCHDOG=0");
    return;
  }

  let lastTick = Date.now();

  const timer = setInterval(() => {
    const now = Date.now();
    const lag = now - lastTick - TICK_MS;
    lastTick = now;

    // Small lags are normal under load; only a sustained stall is fatal.
    if (lag > STALL_LIMIT_MS) {
      const heap = process.memoryUsage();
      console.error(
        `[watchdog] event loop stalled for ${Math.round(lag / 1000)}s ` +
          `(heap ${Math.round(heap.heapUsed / 1048576)}MB/${Math.round(heap.heapTotal / 1048576)}MB) — exiting so the platform restarts this instance`,
      );
      // Give the log a moment to flush, then die.
      setTimeout(() => process.exit(1), 250);
    }
  }, TICK_MS);

  timer.unref?.();
  console.log(`[watchdog] armed — restart after ${Math.round(STALL_LIMIT_MS / 1000)}s stall`);
}
