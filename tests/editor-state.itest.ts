import assert from "node:assert/strict";
import { resolveActiveFileCode, retryOnceAfterConflict } from "../client/src/lib/editor-state.ts";

async function main() {
  assert.equal(resolveActiveFileCode({
    activeFile: "index.html",
    streamedFile: "index.html",
    streamedCode: "fresh visual edit",
    optimisticCode: "stale generated copy",
    projectCode: "older project copy",
    fileCode: "",
  }), "fresh visual edit", "the active file's latest streamed edit must outrank stale optimistic HTML");

  assert.equal(resolveActiveFileCode({
    activeFile: "about.html",
    streamedFile: "index.html",
    streamedCode: "index page",
    optimisticCode: "about optimistic",
    projectCode: "index project",
    fileCode: "about server",
  }), "about optimistic", "streamed HTML for another file must not replace the active file");

  const submittedBody = { prompt: "change button color", activeFile: "index.html" };
  const sentBodies: unknown[] = [];
  let waitCount = 0;
  const retried = await retryOnceAfterConflict(
    { status: 409, editInProgress: true },
    {
      isConflict: (response) => response.status === 409 && response.editInProgress,
      waitForIdle: async () => { waitCount++; return true; },
      request: async () => { sentBodies.push(submittedBody); return { status: 200, editInProgress: false }; },
    },
  );
  assert.equal(retried.retried, true);
  assert.equal(retried.timedOut, false);
  assert.equal(retried.response.status, 200);
  assert.equal(waitCount, 1);
  assert.deepEqual(sentBodies, [submittedBody], "retry submits the original request body once after the conflict clears");

  let shouldNotSend = 0;
  const timedOut = await retryOnceAfterConflict(
    { status: 409, editInProgress: true },
    {
      isConflict: () => true,
      waitForIdle: async () => false,
      request: async () => { shouldNotSend++; return { status: 200 }; },
    },
  );
  assert.equal(timedOut.timedOut, true);
  assert.equal(timedOut.retried, false);
  assert.equal(shouldNotSend, 0, "do not risk a duplicate generation if the active request did not become idle");

  let noConflictSend = 0;
  const normal = await retryOnceAfterConflict(
    { status: 200 },
    {
      isConflict: () => false,
      waitForIdle: async () => { throw new Error("must not poll without a conflict"); },
      request: async () => { noConflictSend++; return { status: 200 }; },
    },
  );
  assert.equal(normal.retried, false);
  assert.equal(noConflictSend, 0);
  console.log("editor state: fresh preview precedence and one safe conflict retry passed");
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
