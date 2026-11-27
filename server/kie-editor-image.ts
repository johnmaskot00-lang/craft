import { setTimeout as sleep } from "node:timers/promises";
import { detectImageFormat } from "./image-compress";
import { kieResultUrl } from "./kie-jobs";
import { safeFetch } from "./url-guard";

const JOBS_URL = "https://api.kie.ai/api/v1/jobs";
const MAX_BYTES = 12 * 1024 * 1024;

/** One KIE task per planned still. Never resubmit a create with an unknown outcome. */
export async function generateEditorImage(apiKey: string, prompt: string, ratio: string) {
  const headers = { Authorization: `Bearer ${apiKey}` };
  const create = await fetch(`${JOBS_URL}/createTask`, {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(20_000),
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "gpt-image-2-text-to-image", input: { prompt, aspect_ratio: ratio, resolution: "1K" } }),
  });
  const job = create.ok ? await create.json() : null;
  const taskId = job?.data?.taskId;
  if (job?.code !== 200 || typeof taskId !== "string" || !taskId.trim()) throw new Error("KIE image create failed");

  const deadline = Date.now() + 180_000;
  const statusUrl = `${JOBS_URL}/recordInfo?${new URLSearchParams({ taskId })}`;
  while (Date.now() < deadline) {
    const data = await fetch(statusUrl, {
      headers, redirect: "error", signal: AbortSignal.timeout(Math.min(12_000, Math.max(1, deadline - Date.now()))),
    }).then(async (response) => response.ok ? response.json() : null)
      .catch(() => null);
    if (data?.code === 200 && data.data?.state === "success") {
      const result = kieResultUrl(data.data);
      if (!result) throw new Error("Empty KIE image result");
      const url = new URL(result);
      if (url.protocol !== "https:" || url.username || url.password) throw new Error("Invalid KIE image URL");
      return await downloadEditorImage(url.href);
    }
    if (data?.code === 200 && ["fail", "failed", "error"].includes(data.data?.state)) throw new Error("KIE image task failed");
    await sleep(Math.min(3000, Math.max(0, deadline - Date.now())));
  }
  throw new Error("KIE image task timed out");
}

async function downloadEditorImage(url: string) {
  const response = await safeFetch(url, { redirect: "error", signal: AbortSignal.timeout(30_000) });
  if (!response.ok || !response.body) throw new Error("KIE image download failed");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    if (Number(response.headers.get("content-length")) > MAX_BYTES) throw new Error("KIE image too large");
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BYTES) throw new Error("KIE image too large");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  const buffer = Buffer.concat(chunks, bytes);
  const format = detectImageFormat(buffer);
  if (!format) throw new Error("KIE did not return an image");
  // A recognizable header does not guarantee the browser can decode the image.
  const { default: sharp } = await import("sharp");
  await sharp(buffer, { limitInputPixels: 16_777_216 }).stats();
  return { buffer, ...format };
}
