#!/usr/bin/env node
/** Concurrent, read-only smoke test for health or public endpoints. */
const base = (process.env.SMOKE_BASE_URL || "http://127.0.0.1:5000").replace(/\/$/, "");
const path = process.env.SMOKE_PATH || "/api/health";
const concurrency = Math.max(1, Number(process.env.SMOKE_CONCURRENCY || 20));
const requests = Math.max(concurrency, Number(process.env.SMOKE_REQUESTS || concurrency * 5));
const timeoutMs = Math.max(1000, Number(process.env.SMOKE_TIMEOUT_MS || 15000));
let next = 0;
const results = [];
async function one() {
  while (true) {
    const n = next++;
    if (n >= requests) return;
    const started = performance.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${base}${path}`, { signal: controller.signal });
      await response.arrayBuffer();
      results.push({ ok: response.ok, status: response.status, ms: performance.now() - started });
    } catch (error) {
      results.push({ ok: false, status: 0, ms: performance.now() - started, error: String(error?.name || error) });
    } finally {
      clearTimeout(timer);
    }
  }
}
await Promise.all(Array.from({ length: concurrency }, one));
const sorted = results.map((r) => r.ms).sort((a, b) => a - b);
const percentile = (p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] || 0;
const failed = results.filter((r) => !r.ok);
const summary = {
  base,
  path,
  requests,
  concurrency,
  failed: failed.length,
  errorRate: Number((failed.length / requests).toFixed(4)),
  p50Ms: Math.round(percentile(0.5)),
  p95Ms: Math.round(percentile(0.95)),
  p99Ms: Math.round(percentile(0.99)),
  statuses: Object.fromEntries([...new Set(results.map((r) => r.status))].map((s) => [s, results.filter((r) => r.status === s).length])),
};
console.log(JSON.stringify(summary, null, 2));
if (failed.length) process.exitCode = 1;
