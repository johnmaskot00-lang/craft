// Run: node --import tsx tests/telegram-poll.itest.ts
import assert from "node:assert/strict";

async function main() {
  const { startTelegramPolling, stopTelegramPolling } = await import("../server/telegram-poll.ts");
  let pass = 0;
  const ok = (m: string) => { pass++; console.log("  ✓", m); };

  // Fake Bot API: one update queued; getUpdates returns pending ones past offset.
  const calls: Array<{ method: string; body: any }> = [];
  const queue = [{ update_id: 500, message: { chat: { id: 1001, type: "private" }, text: "/start leads_x" } }];
  const call = async (method: string, body?: any) => {
    calls.push({ method, body });
    if (method === "deleteWebhook") return true;
    if (method === "getUpdates") {
      const pending = queue.filter((u) => u.update_id >= (body?.offset || 0));
      if (!pending.length) await new Promise((r) => setTimeout(r, 50));
      return pending;
    }
    return null;
  };
  const seen: number[] = [];
  const t0 = Date.now();
  startTelegramPolling(call, (u) => seen.push(u.update_id), ["message", "my_chat_member"], () => {});
  await new Promise((r) => setTimeout(r, 400));

  assert.equal(calls[0].method, "deleteWebhook", "webhook removed before polling");
  assert.deepEqual(seen, [500], "update delivered exactly once");
  assert.ok(Date.now() - t0 < 1000, "delivered fast");
  const gu = calls.filter((c) => c.method === "getUpdates");
  assert.equal(gu[0].body.offset, 0);
  assert.ok(gu.slice(1).every((c) => c.body.offset === 501), "offset advanced past handled update");
  assert.deepEqual(gu[0].body.allowed_updates, ["message", "my_chat_member"]);
  ok("polls immediately, deletes webhook, no redelivery");

  queue.push({ update_id: 501, message: { chat: { id: 1001, type: "private" }, text: "/start" } });
  await new Promise((r) => setTimeout(r, 300));
  assert.deepEqual(seen, [500, 501]);
  ok("new updates picked up on the next poll");

  stopTelegramPolling();
  console.log(`\ntelegram poll: all ${pass} checks passed`);
  process.exit(0);
}
main().catch((e) => { console.error("FAILED:", e); process.exit(1); });
