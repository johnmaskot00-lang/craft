/**
 * Bot update delivery by long-polling (getUpdates).
 *
 * After the 10.2026 region move Telegram's incoming webhook requests to our host
 * time out ("Connection timed out" in getWebhookInfo), while our outgoing calls to
 * api.telegram.org work. Pulling is therefore the reliable path: the bot answers
 * within ~1s instead of waiting for Telegram's webhook retries.
 *
 * Telegram allows only one getUpdates consumer per bot, so with several API
 * instances a Redis lease picks the poller. Every other instance keeps retrying
 * the lease, which makes takeover automatic when the poller dies or redeploys.
 */
import crypto from "crypto";
import { redisEnabled, redisHoldLease, redisReleaseLease } from "./redis";

const LEASE_KEY = "telegram-poller";
const LEASE_TTL_MS = 60_000;
const HOLDER = `${process.env.HOSTNAME || "instance"}-${crypto.randomBytes(3).toString("hex")}`;

type BotCall = (method: string, body?: Record<string, unknown>) => Promise<any>;
type Dispatch = (update: any) => void;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let running = false;
let stopping = false;


async function renew(): Promise<boolean> {
  if (!redisEnabled()) return true; // single instance: nothing to coordinate
  return redisHoldLease(LEASE_KEY, HOLDER, LEASE_TTL_MS);
}

/** Start polling (idempotent). Resolves immediately; the loop runs in the background. */
export function startTelegramPolling(call: BotCall, dispatch: Dispatch, allowedUpdates: string[], log: (m: string) => void): void {
  if (running) return;
  running = true;
  void loop(call, dispatch, allowedUpdates, log);
}

export function stopTelegramPolling(): void {
  stopping = true;
}

async function loop(call: BotCall, dispatch: Dispatch, allowedUpdates: string[], log: (m: string) => void): Promise<void> {
  let offset = 0;
  let leader = false;
  let leaseCheckedAt = 0;
  while (!stopping) {
    // Renew every ~20s while polling; standby instances retry every 15s.
    if (Date.now() - leaseCheckedAt > 20_000 || !leader) {
      const got = await renew();
      leaseCheckedAt = Date.now();
      if (got && !leader) {
        // Polling and an active webhook are mutually exclusive in Telegram.
        await call("deleteWebhook", { drop_pending_updates: false });
        log(`polling started (${HOLDER})`);
      }
      if (!got && leader) log(`polling handed over (${HOLDER})`);
      leader = got;
      if (!leader) {
        await sleep(15_000);
        continue;
      }
    }
    // 25s long-poll; botApi's client timeout for getUpdates is 35s.
    const updates = await call("getUpdates", { offset, timeout: 25, allowed_updates: allowedUpdates });
    if (!Array.isArray(updates)) {
      await sleep(3000);
      continue;
    }
    for (const update of updates) {
      if (typeof update?.update_id === "number") offset = Math.max(offset, update.update_id + 1);
      try {
        dispatch(update);
      } catch (e: any) {
        console.error("[telegram] dispatch error:", e?.message || e);
      }
    }
  }
  if (leader) await redisReleaseLease(LEASE_KEY, HOLDER);
  running = false;
}
