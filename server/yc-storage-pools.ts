/**
 * Multi-cloud Object Storage pool manager.
 *
 * Yandex Object Storage quota is per-cloud (`storage.buckets.count`).
 * Soft limit: YC_BUCKETS_PER_CLOUD (default 900).
 * Hard limit: YC_BUCKETS_HARD_LIMIT (default 1000) — do not exceed real YC quota.
 * When a pool approaches its soft limit we provision a new cloud + folder +
 * service account + static access keys, then continue creating buckets there.
 *
 * Required for auto-create:
 *   YC_ORG_ID (or resolvable via YC_CLOUD_ID / existing pool), YC_BILLING_ACCOUNT_ID, YC_SERVICE_ACCOUNT_KEY
 * Bootstrap (first pool) from existing:
 *   YC_KEY_ID, YC_SECRET, YC_FOLDER_ID, optional YC_CLOUD_ID
 */
import {
  S3Client,
  ListBucketsCommand,
} from "@aws-sdk/client-s3";
import { db } from "./db";
import { ycStoragePools, type YcStoragePool } from "@shared/schema";
import { eq, asc, sql } from "drizzle-orm";
import { ycApi, waitOperation } from "./yc-iam";

function envInt(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/** Real Yandex cloud bucket quota ceiling (raised to 1000 for craft cloud). */
const HARD_BUCKET_LIMIT = Math.max(25, envInt("YC_BUCKETS_HARD_LIMIT", 1000));

const DEFAULT_SOFT_LIMIT = Math.max(
  5,
  Math.min(HARD_BUCKET_LIMIT - 1, envInt("YC_BUCKETS_PER_CLOUD", Math.min(900, HARD_BUCKET_LIMIT - 1))),
);

export type StoragePool = YcStoragePool;

const s3Cache = new Map<number, S3Client>();

export function getPoolS3Client(pool: Pick<StoragePool, "id" | "accessKeyId" | "secretAccessKey">): S3Client {
  let client = s3Cache.get(pool.id);
  if (client) return client;
  client = new S3Client({
    region: "ru-central1",
    endpoint: "https://storage.yandexcloud.net",
    credentials: {
      accessKeyId: pool.accessKeyId,
      secretAccessKey: pool.secretAccessKey,
    },
  });
  s3Cache.set(pool.id, client);
  return client;
}

async function countBuckets(pool: StoragePool): Promise<number> {
  try {
    const client = getPoolS3Client(pool);
    const out = await client.send(new ListBucketsCommand({}));
    return (out.Buckets || []).length;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[YC-POOL] listBuckets failed for pool ${pool.id}: ${msg}`);
    return pool.bucketCount;
  }
}

async function refreshPoolCount(pool: StoragePool): Promise<StoragePool> {
  const count = await countBuckets(pool);
  // Keep DB soft limit in sync with current env (quota raises must unlock "full" pools).
  const limit = Math.max(pool.bucketLimit || 0, DEFAULT_SOFT_LIMIT);
  const status = count >= limit ? "full" : "active";
  const [updated] = await db
    .update(ycStoragePools)
    .set({ bucketCount: count, bucketLimit: limit, status, updatedAt: new Date() })
    .where(eq(ycStoragePools.id, pool.id))
    .returning();
  return updated || { ...pool, bucketCount: count, bucketLimit: limit, status };
}

/** One-shot: bump all pool soft limits after YC quota increase. */
export async function syncAllPoolLimitsFromEnv(): Promise<void> {
  const rows = await db.select().from(ycStoragePools);
  for (const row of rows) {
    if ((row.bucketLimit || 0) >= DEFAULT_SOFT_LIMIT && row.status !== "full") continue;
    const count = row.bucketCount || 0;
    const status = count >= DEFAULT_SOFT_LIMIT ? "full" : "active";
    await db
      .update(ycStoragePools)
      .set({
        bucketLimit: DEFAULT_SOFT_LIMIT,
        status,
        updatedAt: new Date(),
      })
      .where(eq(ycStoragePools.id, row.id));
    console.log(
      `[YC-POOL] synced pool #${row.id} limit ${row.bucketLimit}→${DEFAULT_SOFT_LIMIT} status=${status}`,
    );
  }
}

export async function ensurePrimaryPoolBootstrapped(): Promise<StoragePool> {
  const existing = await db.select().from(ycStoragePools).orderBy(asc(ycStoragePools.id)).limit(1);
  if (existing[0]) return existing[0];

  const keyId = process.env.YC_KEY_ID || "";
  const secret = process.env.YC_SECRET || "";
  const folderId = process.env.YC_FOLDER_ID || "unknown";
  const cloudId = process.env.YC_CLOUD_ID || "primary";
  if (!keyId || !secret) {
    throw new Error("YC_KEY_ID / YC_SECRET не настроены");
  }

  const [row] = await db
    .insert(ycStoragePools)
    .values({
      name: "craft-primary",
      cloudId,
      folderId,
      accessKeyId: keyId,
      secretAccessKey: secret,
      bucketCount: 0,
      bucketLimit: DEFAULT_SOFT_LIMIT,
      status: "active",
    })
    .returning();

  console.log(`[YC-POOL] bootstrapped primary pool #${row.id} (limit=${DEFAULT_SOFT_LIMIT})`);
  return refreshPoolCount(row);
}

function canAutoProvisionCreds(): boolean {
  return !!(process.env.YC_BILLING_ACCOUNT_ID && process.env.YC_SERVICE_ACCOUNT_KEY);
}

/**
 * Resolve a usable organization ID:
 * 1) YC_ORG_ID if valid
 * 2) via YC_FOLDER_ID → cloud → organizationId (common when YC_CLOUD_ID unset)
 * 3) via YC_CLOUD_ID / pool cloudIds
 * 4) organizations.list
 */
async function resolveOrganizationId(): Promise<string> {
  const envOrg = (process.env.YC_ORG_ID || "").trim();
  if (envOrg) {
    try {
      await ycApi(
        "GET",
        `https://organization-manager.api.cloud.yandex.net/organization-manager/v1/organizations/${envOrg}`,
      );
      return envOrg;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[YC-POOL] YC_ORG_ID=${envOrg} invalid/inaccessible (${msg}) — resolving…`);
    }
  }

  const folderId = (process.env.YC_FOLDER_ID || "").trim();
  if (folderId) {
    try {
      const folder = await ycApi<{ cloudId?: string }>(
        "GET",
        `https://resource-manager.api.cloud.yandex.net/resource-manager/v1/folders/${folderId}`,
      );
      if (folder.cloudId) {
        const cloud = await ycApi<{ organizationId?: string }>(
          "GET",
          `https://resource-manager.api.cloud.yandex.net/resource-manager/v1/clouds/${folder.cloudId}`,
        );
        if (cloud.organizationId) {
          console.log(
            `[YC-POOL] resolved organizationId=${cloud.organizationId} from folder ${folderId} → cloud ${folder.cloudId}`,
          );
          // Backfill placeholder "primary" pool cloud ids when possible.
          try {
            await db
              .update(ycStoragePools)
              .set({ cloudId: folder.cloudId, updatedAt: new Date() })
              .where(eq(ycStoragePools.cloudId, "primary"));
          } catch {
            /* non-fatal */
          }
          return cloud.organizationId;
        }
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[YC-POOL] folder ${folderId} lookup failed: ${msg}`);
    }
  }

  const cloudCandidates: string[] = [];
  const envCloud = (process.env.YC_CLOUD_ID || "").trim();
  if (envCloud && envCloud !== "primary") cloudCandidates.push(envCloud);

  const pools = await db.select().from(ycStoragePools).orderBy(asc(ycStoragePools.id));
  for (const p of pools) {
    const cid = (p.cloudId || "").trim();
    if (cid && cid !== "primary" && !cloudCandidates.includes(cid)) cloudCandidates.push(cid);
  }

  for (const cloudId of cloudCandidates) {
    try {
      const cloud = await ycApi<{ organizationId?: string }>(
        "GET",
        `https://resource-manager.api.cloud.yandex.net/resource-manager/v1/clouds/${cloudId}`,
      );
      if (cloud.organizationId) {
        console.log(`[YC-POOL] resolved organizationId=${cloud.organizationId} from cloud ${cloudId}`);
        return cloud.organizationId;
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[YC-POOL] cloud ${cloudId} lookup failed: ${msg}`);
    }
  }

  try {
    const listed = await ycApi<{ organizations?: Array<{ id?: string; name?: string }> }>(
      "GET",
      "https://organization-manager.api.cloud.yandex.net/organization-manager/v1/organizations",
    );
    const first = (listed.organizations || []).find((o) => o.id);
    if (first?.id) {
      console.log(`[YC-POOL] using first listed organization ${first.id} (${first.name || ""})`);
      return first.id;
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[YC-POOL] organizations.list failed: ${msg}`);
  }

  throw new Error(
    "Не удалось определить Yandex Organization ID. " +
      "Проверьте YC_FOLDER_ID / YC_SERVICE_ACCOUNT_KEY (права resource-manager). " +
      "Текущий YC_ORG_ID=" +
      (envOrg || "(пусто)"),
  );
}

let provisionLock: Promise<StoragePool> | null = null;

async function provisionNewCloudPool(): Promise<StoragePool> {
  if (provisionLock) return provisionLock;
  provisionLock = (async () => {
    try {
      return await provisionNewCloudPoolUnlocked();
    } finally {
      provisionLock = null;
    }
  })();
  return provisionLock;
}

async function provisionNewCloudPoolUnlocked(): Promise<StoragePool> {
  const orgId = await resolveOrganizationId();
  const billingId = process.env.YC_BILLING_ACCOUNT_ID!;
  const stamp = Date.now().toString(36).slice(-6);
  const cloudName = `craft-sites-${stamp}`;

  console.log(`[YC-POOL] provisioning storage in org ${orgId}…`);

  let cloudId: string | null = null;
  try {
    // 1. Prefer creating a brand-new cloud (needs org-level create permission)
    const cloudOp = await ycApi<{ id: string }>(
      "POST",
      "https://resource-manager.api.cloud.yandex.net/resource-manager/v1/clouds",
      { organizationId: orgId, name: cloudName, description: "Craft AI sites storage pool (auto)" },
    );
    const cloud = await waitOperation<{ id: string; name?: string }>(cloudOp.id);
    cloudId = cloud.id;
    if (!cloudId) throw new Error("Cloud create returned no id");
    console.log(`[YC-POOL] cloud created: ${cloudId}`);

    // 2. Bind billing
    const bindOp = await ycApi<{ id: string }>(
      "POST",
      `https://billing.api.cloud.yandex.net/billing/v1/billingAccounts/${billingId}/billableObjectBindings`,
      { billableObject: { id: cloudId, type: "cloud" } },
    );
    if (bindOp?.id) {
      await waitOperation(bindOp.id);
    }
    console.log(`[YC-POOL] billing bound to ${billingId}`);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[YC-POOL] cloud.create failed (${msg}) — trying existing clouds in org…`);
    cloudId = await pickExistingCloudForNewPool(orgId);
    if (!cloudId) {
      throw new Error(
        `Не удалось создать облако (${msg}). ` +
          "Выдайте сервисному аккаунту из YC_SERVICE_ACCOUNT_KEY роль " +
          "organization-manager.organizations.owner (или право создавать cloud) " +
          `в организации ${orgId}, либо удалите неиспользуемые бакеты в текущем облаке.`,
      );
    }
    console.log(`[YC-POOL] reusing existing cloud ${cloudId} for new folder pool`);
  }

  return provisionPoolInsideCloud(cloudId, stamp);
}

/** List org clouds and pick one we don't already use as a full pool. */
async function pickExistingCloudForNewPool(orgId: string): Promise<string | null> {
  try {
    const listed = await ycApi<{ clouds?: Array<{ id?: string; name?: string }> }>(
      "GET",
      `https://resource-manager.api.cloud.yandex.net/resource-manager/v1/clouds?organizationId=${encodeURIComponent(orgId)}`,
    );
    const pools = await db.select().from(ycStoragePools);
    const used = new Set(pools.map((p) => p.cloudId).filter((id) => id && id !== "primary"));
    const fullClouds = new Set(
      pools.filter((p) => p.status === "full" || p.bucketCount >= HARD_BUCKET_LIMIT).map((p) => p.cloudId),
    );
    for (const c of listed.clouds || []) {
      if (!c.id) continue;
      if (fullClouds.has(c.id)) continue;
      // Prefer clouds we have never registered as a pool.
      if (!used.has(c.id)) {
        console.log(`[YC-POOL] candidate unused cloud ${c.id} (${c.name || ""})`);
        return c.id;
      }
    }
    // Second pass: any cloud not marked full (new folder may still help if quota is per-folder — usually not,
    // but keys scoped to a new folder keep ListBuckets counts accurate per pool).
    for (const c of listed.clouds || []) {
      if (!c.id || fullClouds.has(c.id)) continue;
      console.log(`[YC-POOL] candidate existing cloud ${c.id} (${c.name || ""})`);
      return c.id;
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[YC-POOL] clouds.list failed: ${msg}`);
  }
  return null;
}

async function provisionPoolInsideCloud(cloudId: string, stamp: string): Promise<StoragePool> {
  const folderName = `sites-${stamp}`;
  const saName = `craft-storage-${stamp}`;

  // Create folder
  const folderOp = await ycApi<{ id: string }>(
    "POST",
    "https://resource-manager.api.cloud.yandex.net/resource-manager/v1/folders",
    { cloudId, name: folderName, description: "Object Storage for published Craft AI sites" },
  );
  const folder = await waitOperation<{ id: string }>(folderOp.id);
  const folderId = folder.id;
  if (!folderId) throw new Error("Folder create returned no id");
  console.log(`[YC-POOL] folder created: ${folderId}`);

  // Service account
  const saOp = await ycApi<{ id: string }>(
    "POST",
    "https://iam.api.cloud.yandex.net/iam/v1/serviceAccounts",
    { folderId, name: saName, description: "Object Storage admin for Craft AI pool" },
  );
  const sa = await waitOperation<{ id: string }>(saOp.id);
  const saId = sa.id;
  if (!saId) throw new Error("Service account create returned no id");
  console.log(`[YC-POOL] SA created: ${saId}`);

  // Grant storage.admin on the folder
  const roleOp = await ycApi<{ id: string }>(
    "POST",
    `https://resource-manager.api.cloud.yandex.net/resource-manager/v1/folders/${folderId}:updateAccessBindings`,
    {
      accessBindingDeltas: [
        {
          action: "ADD",
          accessBinding: {
            roleId: "storage.admin",
            subject: { id: saId, type: "serviceAccount" },
          },
        },
      ],
    },
  );
  if (roleOp?.id) await waitOperation(roleOp.id);

  // Static access key (S3)
  const keyRes = await ycApi<{
    accessKey?: { keyId?: string };
    secret?: string;
  }>("POST", "https://iam.api.cloud.yandex.net/iam/aws-compatibility/v1/accessKeys", {
    serviceAccountId: saId,
    description: "Craft AI Object Storage pool key",
  });
  const accessKeyId = keyRes.accessKey?.keyId;
  const secretAccessKey = keyRes.secret;
  if (!accessKeyId || !secretAccessKey) {
    throw new Error("Access key create returned no keyId/secret");
  }

  const [row] = await db
    .insert(ycStoragePools)
    .values({
      name: `craft-pool-${stamp}`,
      cloudId,
      folderId,
      accessKeyId,
      secretAccessKey,
      bucketCount: 0,
      bucketLimit: DEFAULT_SOFT_LIMIT,
      status: "active",
    })
    .returning();

  console.log(`[YC-POOL] new pool #${row.id} ready (cloud=${cloudId}, folder=${folderId}, limit=${DEFAULT_SOFT_LIMIT})`);
  return row;
}

/**
 * Pick a pool with enough free bucket slots. Creates a new cloud when soft
 * limit is reached (fully automatic — no manual Yandex console steps).
 *
 * Soft limit (YC_BUCKETS_PER_CLOUD, default 20) triggers auto-provision of a
 * new cloud. Organization ID is resolved from YC_ORG_ID, YC_FOLDER_ID→cloud,
 * or organizations.list — a stale YC_ORG_ID no longer blocks automation.
 *
 * Pass `{ forceNew: true }` after a TooManyBuckets error so we never reuse
 * the exhausted pool.
 */
export async function acquireStoragePool(
  slotsNeeded = 1,
  opts?: { forceNew?: boolean },
): Promise<StoragePool> {
  await ensurePrimaryPoolBootstrapped();
  await syncAllPoolLimitsFromEnv();

  const forceNew = !!opts?.forceNew;

  if (!forceNew) {
    const pools = await db.select().from(ycStoragePools).orderBy(asc(ycStoragePools.id));
    const refreshed: StoragePool[] = [];
    for (const pool of pools) {
      if (pool.status === "error" || pool.status === "full") continue;
      refreshed.push(await refreshPoolCount(pool));
    }

    // Prefer pools under soft limit.
    for (const fresh of refreshed) {
      if (fresh.bucketCount + slotsNeeded <= fresh.bucketLimit) {
        return fresh;
      }
    }

    // Soft-full → create a new cloud NOW so subsequent publishes land there.
    if (canAutoProvisionCreds()) {
      try {
        console.log("[YC-POOL] soft limit reached — provisioning new cloud automatically…");
        return await provisionNewCloudPool();
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[YC-POOL] auto new-cloud failed: ${msg}`);
        // Fall through to hard-quota reuse / final error below.
      }
    }

    // Soft-full but under Yandex hard quota — keep publishing on existing cloud.
    const hardCapable = refreshed
      .filter((p) => p.bucketCount + slotsNeeded <= HARD_BUCKET_LIMIT)
      .sort((a, b) => a.bucketCount - b.bucketCount);
    if (hardCapable[0]) {
      console.warn(
        `[YC-POOL] using pool #${hardCapable[0].id} under hard quota ` +
          `(${hardCapable[0].bucketCount}/${HARD_BUCKET_LIMIT}) — fix org/SA if new clouds fail`,
      );
      return hardCapable[0];
    }
  } else {
    console.log("[YC-POOL] forceNew — provisioning a fresh cloud (quota exhausted on current)…");
  }

  if (!canAutoProvisionCreds()) {
    throw new Error(
      "Все облака Object Storage заполнены (квота бакетов). " +
        "Настройте YC_BILLING_ACCOUNT_ID и YC_SERVICE_ACCOUNT_KEY " +
        "для автосоздания нового облака, либо увеличьте квоту storage.buckets.count.",
    );
  }

  try {
    return await provisionNewCloudPool();
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (forceNew) {
      throw new Error(
        `Не удалось создать новое облако Object Storage: ${msg}. ` +
          "Проверьте YC_SERVICE_ACCOUNT_KEY (права создавать cloud) и YC_BILLING_ACCOUNT_ID. " +
          "YC_ORG_ID подтянется из YC_FOLDER_ID автоматически.",
      );
    }
    const pools = await db.select().from(ycStoragePools).orderBy(asc(ycStoragePools.id));
    const any = pools.sort((a, b) => a.bucketCount - b.bucketCount)[0];
    if (any) {
      console.error(
        `[YC-POOL] new-cloud provision failed (${msg}); falling back to pool #${any.id}`,
      );
      return any;
    }
    throw new Error(
      `Не удалось создать новое облако Object Storage: ${msg}. ` +
        "Проверьте YC_SERVICE_ACCOUNT_KEY / YC_BILLING_ACCOUNT_ID / YC_FOLDER_ID.",
    );
  }
}

export async function getStoragePoolById(id: number | null | undefined): Promise<StoragePool | null> {
  if (!id) return null;
  const [row] = await db.select().from(ycStoragePools).where(eq(ycStoragePools.id, id)).limit(1);
  return row || null;
}

export async function bumpPoolBucketCount(poolId: number, delta: number): Promise<void> {
  await db
    .update(ycStoragePools)
    .set({
      bucketCount: sql`GREATEST(0, ${ycStoragePools.bucketCount} + ${delta})`,
      updatedAt: new Date(),
    })
    .where(eq(ycStoragePools.id, poolId));
}

/** Mark a pool as full after Yandex TooManyBuckets (so we stop selecting it). */
export async function markPoolFull(poolId: number, bucketCountHint?: number): Promise<void> {
  const existing = await getStoragePoolById(poolId);
  const count = Math.max(
    bucketCountHint ?? 0,
    existing?.bucketCount ?? 0,
    existing?.bucketLimit ?? HARD_BUCKET_LIMIT,
    HARD_BUCKET_LIMIT,
  );
  await db
    .update(ycStoragePools)
    .set({
      status: "full",
      bucketCount: count,
      updatedAt: new Date(),
    })
    .where(eq(ycStoragePools.id, poolId));
}

/** Admin: force-create a new storage cloud/pool now. */
export async function forceProvisionStoragePool(): Promise<StoragePool> {
  if (!canAutoProvisionCreds()) {
    throw new Error("YC_BILLING_ACCOUNT_ID / YC_SERVICE_ACCOUNT_KEY не настроены");
  }
  return provisionNewCloudPool();
}

export async function resolvePoolForProject(opts: {
  ycStoragePoolId?: number | null;
}): Promise<StoragePool> {
  if (opts.ycStoragePoolId) {
    const existing = await getStoragePoolById(opts.ycStoragePoolId);
    if (existing) return existing;
  }
  return acquireStoragePool(1);
}

/** Admin/diagnostic: pool snapshot without secrets. */
export async function listStoragePoolsPublic(): Promise<
  Array<{
    id: number;
    name: string;
    cloudId: string;
    folderId: string;
    bucketCount: number;
    bucketLimit: number;
    status: string;
    updatedAt: Date;
  }>
> {
  const rows = await db.select().from(ycStoragePools).orderBy(asc(ycStoragePools.id));
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    cloudId: r.cloudId,
    folderId: r.folderId,
    bucketCount: r.bucketCount,
    bucketLimit: r.bucketLimit,
    status: r.status,
    updatedAt: r.updatedAt,
  }));
}
