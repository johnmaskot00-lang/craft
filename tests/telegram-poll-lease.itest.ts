// Two API instances: exactly one polls Telegram; the other takes over when it stops.
// Run: node --import tsx --import ./tests/register-stubs.mjs tests/telegram-poll-lease.itest.ts
import assert from "node:assert/strict";

process.env.REDIS_URL = "redis://fake";

async function main() {
  const redis = await import("../server/redis.ts?fake-redis");
  let pass = 0;
  const ok = (m: string) => { pass++; console.log("  ✓", m); };

  assert.equal(await redis.redisHoldLease("poller", "A", 60_000), true, "A takes the free lease");
  assert.equal(await redis.redisHoldLease("poller", "B", 60_000), false, "B cannot take A's lease");
  assert.equal(await redis.redisHoldLease("poller", "A", 60_000), true, "A renews its own lease");
  ok("hold: free → taken, foreign → refused, own → renewed");

  await redis.redisReleaseLease("poller", "B");
  assert.equal(await redis.redisHoldLease("poller", "B", 60_000), false, "B's release does not free A's lease");
  await redis.redisReleaseLease("poller", "A");
  assert.equal(await redis.redisHoldLease("poller", "B", 60_000), true, "after A releases, B takes over");
  ok("release only by holder; handover after release");

  // Only one poller across instances: this one is standby while another holds the lease.
  await redis.redisReleaseLease("poller", "B");
  const { store } = await import("./redis-stub.ts");
  store.set("craft:lease:telegram-poller", "other-instance");
  const { startTelegramPolling, stopTelegramPolling } = await import("../server/telegram-poll.ts?fake-redis");
  const calls: string[] = [];
  const call = async (method: string) => {
    calls.push(method);
    if (method === "getUpdates") { await new Promise((r) => setTimeout(r, 30)); return []; }
    return true;
  };
  startTelegramPolling(call, () => {}, ["message"], () => {});
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(calls.filter((m) => m === "getUpdates").length, 0, "standby never calls getUpdates (no 409 conflict)");
  assert.equal(calls.includes("deleteWebhook"), false);
  ok("standby instance does not poll while another holds the lease");
  stopTelegramPolling();

  console.log(`\ntelegram poll lease: all ${pass} checks passed`);
  process.exit(0);
}
main().catch((e) => { console.error("FAILED:", e); process.exit(1); });
