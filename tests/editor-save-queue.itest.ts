import assert from "node:assert/strict";
import { createOrderedTaskQueue } from "../client/src/lib/ordered-save.ts";

async function main() {
  const enqueue = createOrderedTaskQueue();
  const events: string[] = [];
  let releaseFirst!: () => void;
  const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });

  const first = enqueue.enqueue(async () => {
    events.push("first:start");
    await firstGate;
    events.push("first:end");
  });
  const second = enqueue.enqueue(async () => { events.push("second"); });
  let flushed = false;
  const flush = enqueue.flush().then(() => { flushed = true; });

  await Promise.resolve();
  assert.deepEqual(events, ["first:start"], "the newer save must not start while an older save is pending");
  assert.equal(flushed, false, "flush must wait for queued saves");
  releaseFirst();
  await Promise.all([first, second, flush]);
  assert.deepEqual(events, ["first:start", "first:end", "second"]);
  assert.equal(flushed, true);

  await assert.rejects(enqueue.enqueue(async () => { throw new Error("failed save"); }), /failed save/);
  await enqueue.enqueue(async () => { events.push("after-failure"); });
  assert.equal(events.at(-1), "after-failure", "a failed save must not block later saves");
  console.log("editor save queue: ordering and failure recovery passed");
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
