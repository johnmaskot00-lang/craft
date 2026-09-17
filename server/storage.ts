import { db } from "./db";
import { users, projects, projectMessages, projectImages, projectVersions, projectFiles, leads, creditTransactions, paymentOrders, promoCodes, promoRedemptions, referralRewards, referralExchanges, type User, type InsertUser, type Project, type InsertProject, type ProjectMessage, type InsertProjectMessage, type ProjectImage, type InsertProjectImage, type ProjectVersion, type InsertProjectVersion, type ProjectFile, type InsertProjectFile, type Lead, type InsertLead, type CreditTransaction, type PaymentOrder, type PromoCode, type ReferralExchange } from "@shared/schema";
import { eq, desc, and, sql, gte, isNull } from "drizzle-orm";
import crypto from "crypto";
import { referralBonusTokens, normalizeReferralCode } from "./referral";
import { extractPreviewImage } from "./site-preview-image";
import {
  deleteVersionBlobs,
  getVersionBlob,
  isHealthySnapshot,
  payloadBytes,
  shouldOffloadVersion,
  versionBlobKey,
  putVersionBlob,
  type VersionPayload,
} from "./version-blobs";

/** Never serialize password hashes to API clients (admin or otherwise). */
export function publicUser<T extends { password?: string | null }>(user: T): Omit<T, "password"> {
  const { password: _pw, ...rest } = user;
  return rest;
}

export interface IStorage {
  getUser(id: number): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  getUserByTelegramId(telegramId: string): Promise<User | undefined>;
  getUserByYandexId(yandexId: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  createTelegramUser(data: { telegramId: string; displayName: string; avatarUrl?: string }): Promise<User>;
  createYandexUser(data: { yandexId: string; displayName: string; email?: string; avatarUrl?: string }): Promise<User>;
  updateUserCredits(id: number, credits: number): Promise<User | undefined>;
  deductCredits(userId: number, amount: number, operation: string, idempotencyKey: string): Promise<{ success: boolean; newBalance: number; alreadyProcessed?: boolean; conflict?: boolean }>;
  /** Refund credits and invalidate the debit idempotency key so the same key cannot free-replay. */
  refundCredits(userId: number, amount: number, idempotencyKey?: string): Promise<number>;
  addCredits(userId: number, amount: number): Promise<number>;
  creditPayment(userId: number, amount: number, idempotencyKey: string, note: string): Promise<{ credited: boolean; newBalance: number }>;

  getProject(id: number): Promise<Project | undefined>;
  getProjectsByUser(userId: number): Promise<Project[]>;
  /** Status poll — never loads generatedCode / full message bodies. */
  getProjectGenerationMeta(id: number): Promise<{
    id: number;
    userId: number;
    updatedAt: Date;
    codeBytes: number;
    generatingPlaceholder: boolean;
    animPending: boolean;
    animReady: boolean;
    messageCount: number;
    lastModelAt: Date | null;
  } | undefined>;
  createProject(project: InsertProject): Promise<Project>;
  /** Clone code, files and image library into a fresh unpublished project. */
  duplicateProject(sourceId: number, userId: number): Promise<Project | undefined>;
  updateProject(id: number, data: Partial<Project>): Promise<Project | undefined>;
  deleteProject(id: number): Promise<void>;

  getProjectMessages(projectId: number, limit?: number): Promise<ProjectMessage[]>;
  /** Ownership check without loading generatedCode. */
  getProjectOwnerId(id: number): Promise<number | undefined>;
  createProjectMessage(message: InsertProjectMessage): Promise<ProjectMessage>;

  getProjectImages(projectId: number): Promise<ProjectImage[]>;
  getImagesByUser(userId: number): Promise<(ProjectImage & { projectTitle: string })[]>;
  getImagesByUserPage(userId: number, limit: number, offset: number): Promise<{ items: (ProjectImage & { projectTitle: string })[]; total: number }>;
  createProjectImage(image: InsertProjectImage): Promise<ProjectImage>;
  deleteProjectImage(id: number): Promise<void>;

  getProjectVersions(projectId: number): Promise<ProjectVersion[]>;
  /** Metadata only — never loads HTML/files into memory (list UI / label lookup). */
  getProjectVersionSummaries(projectId: number): Promise<Array<{
    id: number;
    projectId: number;
    label: string;
    createdAt: Date;
    codeBytes: number;
    hasFiles: boolean;
  }>>;
  getProjectVersion(id: number): Promise<ProjectVersion | undefined>;
  /** Latest non-placeholder version code without loading the whole history. */
  getLatestHealthyVersionCode(projectId: number): Promise<string | null>;
  createProjectVersion(version: InsertProjectVersion): Promise<ProjectVersion>;
  updateProjectVersion(id: number, data: { code?: string; files?: { filename: string; code: string }[] | null; label?: string }): Promise<ProjectVersion | undefined>;

  getProjectFiles(projectId: number): Promise<ProjectFile[]>;
  getProjectFile(projectId: number, filename: string): Promise<ProjectFile | undefined>;
  upsertProjectFile(file: InsertProjectFile): Promise<ProjectFile>;
  deleteProjectFile(id: number): Promise<void>;
  deleteProjectFilesByProject(projectId: number): Promise<void>;

  getLead(id: number): Promise<Lead | undefined>;
  getLeadsByProject(projectId: number): Promise<Lead[]>;
  getLeadsByUser(userId: number): Promise<(Lead & { projectTitle: string })[]>;
  findRecentDuplicateLead(
    lead: InsertLead,
    withinMs: number,
  ): Promise<Lead | undefined>;
  createLead(lead: InsertLead): Promise<Lead>;
  markLeadRead(id: number): Promise<Lead | undefined>;
  deleteLead(id: number): Promise<void>;
  getUnreadLeadCount(userId: number): Promise<number>;

  getProjectByCustomDomain(domain: string): Promise<Project | undefined>;
  getPublishedProjectsCount(userId: number): Promise<number>;
  getAllPublishedProjects(): Promise<Project[]>;
  getAllUsersWithPublishedSites(): Promise<{ userId: number; publishedCount: number }[]>;
  getAllProjectsWithPendingAnim(): Promise<Project[]>;
  /** Ids only — callers load one project at a time to avoid multi-MB heap spikes. */
  listProjectIdsWithPendingAnim(limit?: number): Promise<number[]>;
  listProjectIdsWithAnimTaskId(limit?: number): Promise<number[]>;

  adminGetAllUsers(): Promise<Omit<User, "password">[]>;
  adminGetUserTransactions(userId: number): Promise<import("@shared/schema").CreditTransaction[]>;
  getUserTransactionsPage(userId: number, limit: number, offset: number): Promise<{ items: import("@shared/schema").CreditTransaction[]; total: number }>;
  adminAdjustCredits(userId: number, amount: number, type: "credit" | "debit", operation: string, note: string): Promise<Omit<User, "password"> | undefined>;
  adminGetUserProjects(userId: number): Promise<Array<Omit<Project, "generatedCode"> & { generatedCode: ""; codeBytes: number }>>;
  adminGetStats(): Promise<{ totalUsers: number; totalProjects: number; totalTokensSpent: number; totalTokensAdded: number }>;

  createPaymentOrder(data: { userId: number; amount: number; tokens: number; orderId?: string; paymentUrl?: string }): Promise<PaymentOrder>;
  getPaymentOrderById(id: number): Promise<PaymentOrder | undefined>;
  getPaymentOrderByOrderId(orderId: string): Promise<PaymentOrder | undefined>;
  updatePaymentOrderStatus(id: number, status: string, orderId?: string, paidAt?: Date): Promise<PaymentOrder | undefined>;
  getPaymentOrdersByUser(userId: number): Promise<PaymentOrder[]>;

  createPromoCode(data: { code: string; credits: number; maxActivations: number; createdBy?: number; note?: string }): Promise<PromoCode>;
  listPromoCodes(): Promise<PromoCode[]>;
  setPromoCodeActive(id: number, active: boolean): Promise<PromoCode | undefined>;
  redeemPromoCode(userId: number, code: string): Promise<{
    ok: boolean;
    credits?: number;
    newBalance?: number;
    error?: "not_found" | "inactive" | "exhausted" | "already_used" | "invalid";
  }>;
  ensurePromoTables(): Promise<void>;

  ensureReferralSchema(): Promise<void>;
  ensureReferralCode(userId: number): Promise<string>;
  getUserByReferralCode(code: string): Promise<User | undefined>;
  attachReferral(newUserId: number, referralCode: string | null | undefined): Promise<{ attached: boolean; referrerId?: number }>;
  awardReferralForPayment(order: {
    id: number;
    userId: number;
    tokens: number;
  }): Promise<{ awarded: boolean; tokens?: number; referrerId?: number }>;
  getReferralStats(referrerUserId: number): Promise<{
    code: string;
    referredCount: number;
    paidReferredCount: number;
    totalTokensEarned: number;
    availableBalance: number;
    pendingExchange: ReferralExchange | null;
    recent: Array<{
      id: number;
      referredUserId: number;
      referredDisplayName: string;
      paymentOrderId: number;
      tokensAwarded: number;
      createdAt: Date;
    }>;
  }>;
  getReferralAvailableBalance(referrerUserId: number): Promise<number>;
  requestReferralExchange(userId: number): Promise<{
    ok: boolean;
    exchangeId?: number;
    tokens?: number;
    error?: "nothing_available" | "already_pending";
  }>;
  listReferralExchanges(status?: string): Promise<Array<ReferralExchange & { displayName: string; email: string | null }>>;
  approveReferralExchange(exchangeId: number, adminUserId: number): Promise<{ ok: boolean; error?: string; newBalance?: number }>;
  rejectReferralExchange(exchangeId: number, adminUserId: number): Promise<{ ok: boolean; error?: string }>;
}

export const NEW_USER_CREDITS = 0;

/** Max version snapshots kept per project (full HTML). Was 80 — blew heap on list. */
export const VERSION_RETENTION_PER_PROJECT = Math.max(
  5,
  Math.min(40, Number(process.env.CRAFT_VERSION_RETENTION) || 20),
);

export class DatabaseStorage implements IStorage {
  async getUser(id: number): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user;
  }

  async getUserByTelegramId(telegramId: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.telegramId, telegramId));
    return user;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    await this.ensureReferralSchema();
    const referralCode = await this.allocateReferralCode();
    const [user] = await db.insert(users).values({
      ...insertUser,
      credits: NEW_USER_CREDITS,
      referralCode,
    }).returning();
    return user;
  }

  async createTelegramUser(data: { telegramId: string; displayName: string; avatarUrl?: string }): Promise<User> {
    await this.ensureReferralSchema();
    const referralCode = await this.allocateReferralCode();
    const [user] = await db.insert(users).values({
      displayName: data.displayName,
      telegramId: data.telegramId,
      avatarUrl: data.avatarUrl ?? null,
      credits: NEW_USER_CREDITS,
      referralCode,
    }).returning();
    return user;
  }

  async getUserByYandexId(yandexId: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.yandexId, yandexId));
    return user;
  }

  async createYandexUser(data: { yandexId: string; displayName: string; email?: string; avatarUrl?: string }): Promise<User> {
    await this.ensureReferralSchema();
    const referralCode = await this.allocateReferralCode();
    const [user] = await db.insert(users).values({
      displayName: data.displayName,
      yandexId: data.yandexId,
      email: data.email ?? null,
      avatarUrl: data.avatarUrl ?? null,
      credits: NEW_USER_CREDITS,
      referralCode,
    }).returning();
    return user;
  }

  async updateUserCredits(id: number, credits: number): Promise<User | undefined> {
    const [user] = await db.update(users).set({ credits }).where(eq(users.id, id)).returning();
    return user;
  }

  async deductCredits(userId: number, amount: number, operation: string, idempotencyKey: string): Promise<{ success: boolean; newBalance: number; alreadyProcessed?: boolean; conflict?: boolean }> {
    // Atomic: claim idempotency key first, then debit. Concurrent same-key callers
    // cannot both debit. Replays only succeed when user/operation/amount match.
    try {
      return await db.transaction(async (tx) => {
        const existing = await tx.select().from(creditTransactions).where(eq(creditTransactions.idempotencyKey, idempotencyKey));
        if (existing.length > 0) {
          const row = existing[0];
          const [user] = await tx.select().from(users).where(eq(users.id, userId));
          if (
            row.userId === userId
            && row.operation === operation
            && row.amount === amount
            && (row.type || "debit") === "debit"
          ) {
            return { success: true, newBalance: user?.credits ?? 0, alreadyProcessed: true };
          }
          return { success: false, newBalance: user?.credits ?? 0, conflict: true };
        }

        const inserted = await tx.insert(creditTransactions).values({
          userId,
          amount,
          operation,
          idempotencyKey,
          type: "debit",
        }).returning();
        if (!inserted.length) {
          const [user] = await tx.select().from(users).where(eq(users.id, userId));
          return { success: false, newBalance: user?.credits ?? 0 };
        }

        const result = await tx.execute(
          sql`UPDATE users SET credits = credits - ${amount} WHERE id = ${userId} AND credits >= ${amount} RETURNING credits`
        );
        const rows = result.rows as Array<{ credits: number }>;
        if (!rows || rows.length === 0) {
          // Roll back the claimed key by aborting the transaction
          throw new Error("INSUFFICIENT_CREDITS");
        }
        return { success: true, newBalance: rows[0].credits };
      });
    } catch (err: any) {
      if (err?.message === "INSUFFICIENT_CREDITS") {
        const user = await this.getUser(userId);
        return { success: false, newBalance: user?.credits ?? 0 };
      }
      // Unique race: another txn inserted the same key вЂ” treat as replay if matching
      const existing = await db.select().from(creditTransactions).where(eq(creditTransactions.idempotencyKey, idempotencyKey));
      if (existing.length > 0) {
        const row = existing[0];
        const user = await this.getUser(userId);
        if (
          row.userId === userId
          && row.operation === operation
          && row.amount === amount
          && (row.type || "debit") === "debit"
        ) {
          return { success: true, newBalance: user?.credits ?? 0, alreadyProcessed: true };
        }
        return { success: false, newBalance: user?.credits ?? 0, conflict: true };
      }
      throw err;
    }
  }

  async refundCredits(userId: number, amount: number, idempotencyKey?: string): Promise<number> {
    // When an idempotency key is provided: credit at most once per key, and rename the
    // original debit row so a retry with the same key charges again (no free replay).
    if (idempotencyKey) {
      return await db.transaction(async (tx) => {
        const refundKey = `refund:${idempotencyKey}`;
        const inserted = await tx.insert(creditTransactions).values({
          userId,
          amount,
          type: "credit",
          operation: "refund",
          note: `Refund for ${idempotencyKey}`,
          idempotencyKey: refundKey,
        }).onConflictDoNothing().returning();

        if (inserted.length === 0) {
          const [user] = await tx.select().from(users).where(eq(users.id, userId));
          return user?.credits ?? 0;
        }

        // Free the original debit key for a future legitimate retry.
        const freedKey = `${idempotencyKey}:refunded:${Date.now()}`;
        await tx.execute(sql`
          UPDATE credit_transactions
          SET idempotency_key = ${freedKey},
              note = COALESCE(note, '') || ' [refunded]'
          WHERE idempotency_key = ${idempotencyKey}
            AND user_id = ${userId}
            AND (type = 'debit' OR type IS NULL)
        `);

        const result = await tx.execute(
          sql`UPDATE users SET credits = credits + ${amount} WHERE id = ${userId} RETURNING credits`
        );
        const rows = result.rows as Array<{ credits: number }>;
        return rows?.[0]?.credits ?? 0;
      });
    }

    const result = await db.execute(
      sql`UPDATE users SET credits = credits + ${amount} WHERE id = ${userId} RETURNING credits`
    );
    const rows = result.rows as Array<{ credits: number }>;
    return rows?.[0]?.credits ?? 0;
  }

  async addCredits(userId: number, amount: number): Promise<number> {
    const result = await db.execute(
      sql`UPDATE users SET credits = credits + ${amount} WHERE id = ${userId} RETURNING credits`
    );
    const rows = result.rows as Array<{ credits: number }>;
    return rows?.[0]?.credits ?? 0;
  }

  // Exactly-once payment crediting: insert the idempotency row and add credits in ONE
  // transaction. If the row already exists (webhook + check-status race, or duplicate
  // webhook), the insert no-ops and NO credit is applied. Because both statements share
  // one transaction, a crash can never leave the idempotency row without its credit.
  async creditPayment(userId: number, amount: number, idempotencyKey: string, note: string): Promise<{ credited: boolean; newBalance: number }> {
    return await db.transaction(async (tx) => {
      const inserted = await tx.insert(creditTransactions).values({
        userId,
        amount,
        type: "credit",
        operation: "payment",
        note,
        idempotencyKey,
      }).onConflictDoNothing().returning();

      if (inserted.length === 0) {
        const [user] = await tx.select().from(users).where(eq(users.id, userId));
        return { credited: false, newBalance: user?.credits ?? 0 };
      }

      const result = await tx.execute(
        sql`UPDATE users SET credits = credits + ${amount} WHERE id = ${userId} RETURNING credits`
      );
      const rows = result.rows as Array<{ credits: number }>;
      return { credited: true, newBalance: rows?.[0]?.credits ?? 0 };
    });
  }

  async getProject(id: number): Promise<Project | undefined> {
    const [project] = await db.select().from(projects).where(eq(projects.id, id));
    return project;
  }

  async getProjectGenerationMeta(id: number): Promise<{
    id: number;
    userId: number;
    updatedAt: Date;
    codeBytes: number;
    generatingPlaceholder: boolean;
    animPending: boolean;
    animReady: boolean;
    messageCount: number;
    lastModelAt: Date | null;
  } | undefined> {
    const [row] = await db
      .select({
        id: projects.id,
        userId: projects.userId,
        updatedAt: projects.updatedAt,
        codeBytes: sql<number>`coalesce(octet_length(${projects.generatedCode}), 0)::int`,
        generatingPlaceholder: sql<boolean>`(position('data-craft-generating="1"' in coalesce(${projects.generatedCode}, '')) > 0)`,
        animPending: sql<boolean>`(position('data-scroll-anim-pending="1"' in coalesce(${projects.generatedCode}, '')) > 0)`,
        hasScrollAnim: sql<boolean>`(position('data-craft-scrollanim' in coalesce(${projects.generatedCode}, '')) > 0)`,
        hasAnimFallback: sql<boolean>`(position('data-scroll-anim-fallback="1"' in coalesce(${projects.generatedCode}, '')) > 0)`,
      })
      .from(projects)
      .where(eq(projects.id, id));
    if (!row) return undefined;

    const [msg] = await db
      .select({
        messageCount: sql<number>`count(*)::int`,
        lastModelAt: sql<Date | null>`max(case when ${projectMessages.role} in ('model', 'assistant') then ${projectMessages.createdAt} end)`,
      })
      .from(projectMessages)
      .where(eq(projectMessages.projectId, id));

    const animPending = Boolean(row.animPending);
    return {
      id: row.id,
      userId: row.userId,
      updatedAt: row.updatedAt,
      codeBytes: Number(row.codeBytes || 0),
      generatingPlaceholder: Boolean(row.generatingPlaceholder),
      animPending,
      animReady: !animPending && (Boolean(row.hasScrollAnim) || Boolean(row.hasAnimFallback)),
      messageCount: Number(msg?.messageCount || 0),
      lastModelAt: msg?.lastModelAt ?? null,
    };
  }

  async getProjectsByUser(userId: number): Promise<Project[]> {
    // Never select generated_code for list views — full HTML OOMs the 1.8GB heap
    // when dashboards load many projects (iframe srcDoc × N).
    const rows = await db
      .select({
        id: projects.id,
        userId: projects.userId,
        title: projects.title,
        description: projects.description,
        geminiInteractionId: projects.geminiInteractionId,
        publishedUrl: projects.publishedUrl,
        publishStatus: projects.publishStatus,
        vercelProjectId: projects.vercelProjectId,
        ycStoragePoolId: projects.ycStoragePoolId,
        customDomain: projects.customDomain,
        previewImage: projects.previewImage,
        type: projects.type,
        seoConfig: projects.seoConfig,
        createdAt: projects.createdAt,
        updatedAt: projects.updatedAt,
        hasPreview: sql<boolean>`(octet_length(coalesce(${projects.generatedCode}, '')) > 80)`,
        codeBytes: sql<number>`coalesce(octet_length(${projects.generatedCode}), 0)::int`,
      })
      .from(projects)
      .where(eq(projects.userId, userId))
      .orderBy(desc(projects.createdAt));
    return rows.map((r) => ({
      ...r,
      generatedCode: "",
      hasPreview: Boolean(r.hasPreview),
      codeBytes: Number(r.codeBytes || 0),
    })) as Project[];
  }

  async createProject(insertProject: InsertProject): Promise<Project> {
    const [project] = await db
      .insert(projects)
      .values({
        ...insertProject,
        previewImage: extractPreviewImage(insertProject.generatedCode),
      })
      .returning();
    return project;
  }

  async duplicateProject(sourceId: number, userId: number): Promise<Project | undefined> {
    const [source] = await db.select().from(projects).where(eq(projects.id, sourceId));
    if (!source || source.userId !== userId) return undefined;

    // Hosting fields stay empty: the clone is a fresh draft that publishes to its
    // own bucket/domain instead of hijacking the original site.
    const [copy] = await db
      .insert(projects)
      .values({
        userId,
        title: `${source.title} (копия)`.slice(0, 200),
        description: source.description,
        generatedCode: source.generatedCode,
        previewImage: source.previewImage,
        type: source.type,
        seoConfig: source.seoConfig,
        publishStatus: "draft",
      })
      .returning();
    if (!copy) return undefined;

    const files = await db.select().from(projectFiles).where(eq(projectFiles.projectId, sourceId));
    if (files.length) {
      await db.insert(projectFiles).values(
        files.map((f) => ({ projectId: copy.id, filename: f.filename, code: f.code })),
      );
    }

    // Image library is referenced by {{IMG:name}} markers inside the cloned HTML.
    const images = await db.select().from(projectImages).where(eq(projectImages.projectId, sourceId));
    if (images.length) {
      await db.insert(projectImages).values(
        images.map((img) => ({
          projectId: copy.id,
          userId,
          name: img.name,
          url: img.url,
          prompt: img.prompt,
        })),
      );
    }

    return copy;
  }

  async updateProject(id: number, data: Partial<Project>): Promise<Project | undefined> {
    const patch: Partial<Project> = { ...data, updatedAt: new Date() };
    // Refresh the cached thumbnail whenever the site HTML changes.
    if (data.generatedCode !== undefined && data.previewImage === undefined) {
      patch.previewImage = extractPreviewImage(data.generatedCode);
    }
    const [project] = await db.update(projects).set(patch).where(eq(projects.id, id)).returning();
    return project;
  }

  async deleteProject(id: number): Promise<void> {
    const blobRows = await db
      .select({ blobKey: projectVersions.blobKey })
      .from(projectVersions)
      .where(eq(projectVersions.projectId, id));
    const blobKeys = blobRows.map((r) => r.blobKey);
    await Promise.all([
      db.delete(projectMessages).where(eq(projectMessages.projectId, id)),
      db.delete(projectFiles).where(eq(projectFiles.projectId, id)),
      db.delete(projectVersions).where(eq(projectVersions.projectId, id)),
      db.delete(projectImages).where(eq(projectImages.projectId, id)),
      db.delete(leads).where(eq(leads.projectId, id)),
    ]);
    await db.delete(projects).where(eq(projects.id, id));
    if (blobKeys.length) void deleteVersionBlobs(blobKeys);
  }

  async getProjectOwnerId(id: number): Promise<number | undefined> {
    const [row] = await db
      .select({ userId: projects.userId })
      .from(projects)
      .where(eq(projects.id, id));
    return row?.userId;
  }

  async getProjectMessages(projectId: number, limit?: number): Promise<ProjectMessage[]> {
    const cap = limit != null && Number.isFinite(limit) && limit > 0
      ? Math.min(500, Math.floor(limit))
      : undefined;
    if (!cap) {
      return db
        .select()
        .from(projectMessages)
        .where(eq(projectMessages.projectId, projectId))
        .orderBy(projectMessages.createdAt);
    }
    // Latest N in chronological order for chat / agent context.
    const rows = await db
      .select()
      .from(projectMessages)
      .where(eq(projectMessages.projectId, projectId))
      .orderBy(desc(projectMessages.createdAt))
      .limit(cap);
    return rows.reverse();
  }

  async createProjectMessage(message: InsertProjectMessage): Promise<ProjectMessage> {
    const [msg] = await db.insert(projectMessages).values(message).returning();
    return msg;
  }

  async getProjectImages(projectId: number): Promise<ProjectImage[]> {
    return db.select().from(projectImages).where(eq(projectImages.projectId, projectId)).orderBy(desc(projectImages.createdAt));
  }

  async getImagesByUser(userId: number): Promise<(ProjectImage & { projectTitle: string })[]> {
    const rows = await db
      .select({
        id: projectImages.id,
        projectId: projectImages.projectId,
        userId: projectImages.userId,
        name: projectImages.name,
        url: projectImages.url,
        prompt: projectImages.prompt,
        createdAt: projectImages.createdAt,
        projectTitle: sql<string>`COALESCE(${projects.title}, 'РЈРґР°Р»С‘РЅРЅС‹Р№ РїСЂРѕРµРєС‚')`,
      })
      .from(projectImages)
      .leftJoin(projects, eq(projectImages.projectId, projects.id))
      .where(
        sql`(${projects.userId} = ${userId} OR ${projectImages.userId} = ${userId})`
      )
      .orderBy(desc(projectImages.createdAt));
    return rows;
  }

  async getImagesByUserPage(userId: number, limit: number, offset: number): Promise<{ items: (ProjectImage & { projectTitle: string })[]; total: number }> {
    const userScope = sql`(${projects.userId} = ${userId} OR ${projectImages.userId} = ${userId})`;
    // Keep gallery to real image assets (same rule as /api/generations).
    const imageUrl = sql`${projectImages.url} ~* '\\.(png|jpe?g|webp|gif|avif|svg)([?#]|$)'`;
    const whereClause = sql`${userScope} AND ${imageUrl}`;

    const countResult = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(projectImages)
      .leftJoin(projects, eq(projectImages.projectId, projects.id))
      .where(whereClause);
    const total = Number(countResult[0]?.count ?? 0);

    const items = await db
      .select({
        id: projectImages.id,
        projectId: projectImages.projectId,
        userId: projectImages.userId,
        name: projectImages.name,
        url: projectImages.url,
        prompt: projectImages.prompt,
        createdAt: projectImages.createdAt,
        projectTitle: sql<string>`COALESCE(${projects.title}, 'РЈРґР°Р»С‘РЅРЅС‹Р№ РїСЂРѕРµРєС‚')`,
      })
      .from(projectImages)
      .leftJoin(projects, eq(projectImages.projectId, projects.id))
      .where(whereClause)
      .orderBy(desc(projectImages.createdAt))
      .limit(limit)
      .offset(offset);

    return { items, total };
  }

  async createProjectImage(image: InsertProjectImage): Promise<ProjectImage> {
    const [img] = await db.insert(projectImages).values(image).returning();
    return img;
  }

  async deleteProjectImage(id: number): Promise<void> {
    await db.delete(projectImages).where(eq(projectImages.id, id));
  }

  async getProjectVersions(projectId: number): Promise<ProjectVersion[]> {
    // Prefer getProjectVersionSummaries / getProjectVersion for new code paths.
    // Kept for rare heal/admin callers that need full rows — always LIMIT.
    const rows = await db
      .select()
      .from(projectVersions)
      .where(eq(projectVersions.projectId, projectId))
      .orderBy(desc(projectVersions.createdAt))
      .limit(VERSION_RETENTION_PER_PROJECT);
    return Promise.all(rows.map((row) => this.hydrateVersion(row)));
  }

  /** Pull the payload back from Object Storage for offloaded rows. */
  private async hydrateVersion(row: ProjectVersion): Promise<ProjectVersion> {
    if (!row.blobKey) return row;
    const payload = await getVersionBlob(row.blobKey);
    if (!payload) return row;
    return { ...row, code: payload.code, files: payload.files };
  }

  async getProjectVersionSummaries(projectId: number): Promise<Array<{
    id: number;
    projectId: number;
    label: string;
    createdAt: Date;
    codeBytes: number;
    hasFiles: boolean;
  }>> {
    // Offloaded rows carry metadata in columns; legacy inline rows are measured directly.
    const rows = await db.execute(sql`
      SELECT
        id,
        project_id AS "projectId",
        label,
        created_at AS "createdAt",
        CASE WHEN blob_key IS NOT NULL THEN code_bytes
             ELSE coalesce(octet_length(code), 0) END::int AS "codeBytes",
        CASE WHEN blob_key IS NOT NULL THEN has_files
             ELSE (files IS NOT NULL) END::boolean AS "hasFiles"
      FROM project_versions
      WHERE project_id = ${projectId}
      ORDER BY created_at DESC, id DESC
      LIMIT ${VERSION_RETENTION_PER_PROJECT}
    `);
    return (rows.rows as Array<{
      id: number;
      projectId: number;
      label: string;
      createdAt: Date;
      codeBytes: number;
      hasFiles: boolean;
    }>).map((r) => ({
      id: Number(r.id),
      projectId: Number(r.projectId),
      label: r.label || "",
      createdAt: r.createdAt,
      codeBytes: Number(r.codeBytes || 0),
      hasFiles: Boolean(r.hasFiles),
    }));
  }

  async getProjectVersion(id: number): Promise<ProjectVersion | undefined> {
    const [v] = await db.select().from(projectVersions).where(eq(projectVersions.id, id)).limit(1);
    return v ? this.hydrateVersion(v) : undefined;
  }

  async getLatestHealthyVersionCode(projectId: number): Promise<string | null> {
    const res = await db.execute(sql`
      SELECT code, blob_key AS "blobKey"
      FROM project_versions
      WHERE project_id = ${projectId}
        AND CASE
              WHEN blob_key IS NOT NULL THEN code_bytes > 80 AND healthy
              ELSE octet_length(code) > 80 AND code NOT ILIKE '%data-craft-generating="1"%'
            END
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    `);
    const row = (res.rows as Array<{ code: string; blobKey: string | null }>)[0];
    if (!row) return null;
    if (row.blobKey) {
      const payload = await getVersionBlob(row.blobKey);
      const code = payload?.code || "";
      return code.trim() ? code : null;
    }
    return row.code && row.code.trim() ? row.code : null;
  }

  async createProjectVersion(version: InsertProjectVersion): Promise<ProjectVersion> {
    const payload: VersionPayload = { code: version.code || "", files: version.files ?? null };
    const bytes = payloadBytes(payload);
    const meta = {
      codeBytes: bytes,
      hasFiles: !!payload.files?.length,
      healthy: isHealthySnapshot(payload.code),
    };
    const offload = shouldOffloadVersion(bytes);

    const [v] = await db
      .insert(projectVersions)
      .values(
        offload
          ? { ...version, code: "", files: null, ...meta }
          : { ...version, ...meta },
      )
      .returning();

    let saved = v;
    if (offload && v) {
      // Key needs the row id, so the payload is uploaded right after the insert.
      const key = versionBlobKey(v.projectId, v.id);
      try {
        await putVersionBlob(key, payload);
        const [withKey] = await db
          .update(projectVersions)
          .set({ blobKey: key })
          .where(eq(projectVersions.id, v.id))
          .returning();
        saved = withKey || v;
      } catch (err: any) {
        console.warn("[versions] blob upload failed, keeping snapshot inline:", err?.message || err);
        const [inline] = await db
          .update(projectVersions)
          .set({ code: payload.code, files: payload.files })
          .where(eq(projectVersions.id, v.id))
          .returning();
        saved = inline || v;
      }
    }

    // Version snapshots contain full HTML + multipage files and can be hundreds
    // of KB–MB each. Keep a tight history per project to protect Postgres + Node RAM.
    try {
      const pruned = await db.execute(sql`
        DELETE FROM project_versions
        WHERE id IN (
          SELECT id
          FROM project_versions
          WHERE project_id = ${version.projectId}
          ORDER BY created_at DESC, id DESC
          OFFSET ${VERSION_RETENTION_PER_PROJECT}
        )
        RETURNING blob_key AS "blobKey"
      `);
      const keys = (pruned.rows as Array<{ blobKey: string | null }>).map((r) => r.blobKey);
      if (keys.length) void deleteVersionBlobs(keys);
    } catch (err: any) {
      console.warn("[versions] retention cleanup failed:", err?.message || err);
    }
    return saved ? { ...saved, code: payload.code, files: payload.files } : saved;
  }

  async updateProjectVersion(
    id: number,
    data: { code?: string; files?: { filename: string; code: string }[] | null; label?: string },
  ): Promise<ProjectVersion | undefined> {
    const [current] = await db.select().from(projectVersions).where(eq(projectVersions.id, id));
    if (!current) return undefined;
    if (data.code === undefined && data.files === undefined && data.label === undefined) {
      return this.hydrateVersion(current);
    }

    const patch: Partial<typeof projectVersions.$inferInsert> = {};
    if (data.label !== undefined) patch.label = data.label;

    if (data.code === undefined && data.files === undefined) {
      const [v] = await db.update(projectVersions).set(patch).where(eq(projectVersions.id, id)).returning();
      return v ? this.hydrateVersion(v) : undefined;
    }

    // Payload edits rewrite the whole snapshot, so merge with what is stored today.
    const existing = current.blobKey
      ? (await getVersionBlob(current.blobKey)) ?? { code: current.code, files: current.files }
      : { code: current.code, files: current.files };
    const payload: VersionPayload = {
      code: data.code !== undefined ? data.code : existing.code,
      files: data.files !== undefined ? data.files : existing.files,
    };
    const bytes = payloadBytes(payload);
    patch.codeBytes = bytes;
    patch.hasFiles = !!payload.files?.length;
    patch.healthy = isHealthySnapshot(payload.code);

    const key = current.blobKey || versionBlobKey(current.projectId, current.id);
    if (shouldOffloadVersion(bytes) || current.blobKey) {
      try {
        await putVersionBlob(key, payload);
        patch.blobKey = key;
        patch.code = "";
        patch.files = null;
      } catch (err: any) {
        console.warn("[versions] blob update failed, keeping snapshot inline:", err?.message || err);
        patch.blobKey = null;
        patch.code = payload.code;
        patch.files = payload.files;
      }
    } else {
      patch.code = payload.code;
      patch.files = payload.files;
    }

    const [v] = await db.update(projectVersions).set(patch).where(eq(projectVersions.id, id)).returning();
    return v ? { ...v, code: payload.code, files: payload.files } : undefined;
  }

  async getProjectFiles(projectId: number): Promise<ProjectFile[]> {
    return db.select().from(projectFiles).where(eq(projectFiles.projectId, projectId)).orderBy(projectFiles.filename);
  }

  async getProjectFile(projectId: number, filename: string): Promise<ProjectFile | undefined> {
    const [file] = await db.select().from(projectFiles).where(and(eq(projectFiles.projectId, projectId), eq(projectFiles.filename, filename)));
    return file;
  }

  async upsertProjectFile(file: InsertProjectFile): Promise<ProjectFile> {
    // Prefer atomic upsert when unique (project_id, filename) exists.
    try {
      const result = await db.execute(sql`
        INSERT INTO project_files (project_id, filename, code)
        VALUES (${file.projectId}, ${file.filename}, ${file.code})
        ON CONFLICT (project_id, filename)
        DO UPDATE SET code = EXCLUDED.code
        RETURNING id, project_id, filename, code, created_at
      `);
      const row = (result.rows as any[])?.[0];
      if (row) {
        return {
          id: row.id,
          projectId: row.project_id,
          filename: row.filename,
          code: row.code,
          createdAt: row.created_at,
        } as ProjectFile;
      }
    } catch (err: any) {
      // Unique index may not exist yet in older DBs вЂ” fall back to select/update.
      console.warn("[storage] upsert ON CONFLICT failed, fallback:", err?.message?.slice?.(0, 120));
    }
    const existing = await this.getProjectFile(file.projectId, file.filename);
    if (existing) {
      const [updated] = await db.update(projectFiles).set({ code: file.code }).where(eq(projectFiles.id, existing.id)).returning();
      return updated;
    }
    const [created] = await db.insert(projectFiles).values(file).returning();
    return created;
  }

  async deleteProjectFile(id: number): Promise<void> {
    await db.delete(projectFiles).where(eq(projectFiles.id, id));
  }

  async deleteProjectFilesByProject(projectId: number): Promise<void> {
    await db.delete(projectFiles).where(eq(projectFiles.projectId, projectId));
  }

  async getLead(id: number): Promise<Lead | undefined> {
    const [l] = await db.select().from(leads).where(eq(leads.id, id));
    return l;
  }

  async getLeadsByProject(projectId: number): Promise<Lead[]> {
    return db.select().from(leads).where(eq(leads.projectId, projectId)).orderBy(desc(leads.createdAt));
  }

  async getLeadsByUser(userId: number): Promise<(Lead & { projectTitle: string })[]> {
    // One join instead of a query per project — and never selecting generated_code,
    // which the previous full-row project fetch pulled into the heap.
    return db
      .select({
        id: leads.id,
        projectId: leads.projectId,
        name: leads.name,
        email: leads.email,
        phone: leads.phone,
        message: leads.message,
        source: leads.source,
        isRead: leads.isRead,
        createdAt: leads.createdAt,
        projectTitle: projects.title,
      })
      .from(leads)
      .innerJoin(projects, eq(leads.projectId, projects.id))
      .where(eq(projects.userId, userId))
      .orderBy(desc(leads.createdAt))
      .limit(1000);
  }

  async findRecentDuplicateLead(
    lead: InsertLead,
    withinMs: number,
  ): Promise<Lead | undefined> {
    const cutoff = new Date(Date.now() - Math.max(1000, withinMs));
    const [existing] = await db
      .select()
      .from(leads)
      .where(and(
        eq(leads.projectId, lead.projectId),
        eq(leads.name, lead.name),
        eq(leads.email, lead.email),
        eq(leads.phone, lead.phone),
        eq(leads.message, lead.message),
        eq(leads.source, lead.source),
        gte(leads.createdAt, cutoff),
      ))
      .orderBy(desc(leads.createdAt))
      .limit(1);
    return existing;
  }

  async createLead(lead: InsertLead): Promise<Lead> {
    const [l] = await db.insert(leads).values(lead).returning();
    return l;
  }

  async markLeadRead(id: number): Promise<Lead | undefined> {
    const [l] = await db.update(leads).set({ isRead: 1 }).where(eq(leads.id, id)).returning();
    return l;
  }

  async deleteLead(id: number): Promise<void> {
    await db.delete(leads).where(eq(leads.id, id));
  }

  async getUnreadLeadCount(userId: number): Promise<number> {
    // Polled by every open dashboard once a minute, so it must stay a single
    // indexed COUNT — the old version loaded all projects with their HTML.
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(leads)
      .innerJoin(projects, eq(leads.projectId, projects.id))
      .where(and(eq(projects.userId, userId), eq(leads.isRead, 0)));
    return Number(row?.count ?? 0);
  }

  async getProjectByCustomDomain(domain: string): Promise<Project | undefined> {
    const result = await db.select().from(projects).where(eq(projects.customDomain, domain)).limit(1);
    return result[0];
  }

  async getPublishedProjectsCount(userId: number): Promise<number> {
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(projects)
      .where(and(eq(projects.userId, userId), eq(projects.publishStatus, "published")));
    return Number(row?.count ?? 0);
  }

  async getAllPublishedProjects(): Promise<Project[]> {
    return db.select().from(projects).where(eq(projects.publishStatus, "published"));
  }

  async getAllUsersWithPublishedSites(): Promise<{ userId: number; publishedCount: number }[]> {
    // Daily billing runs this — aggregate in Postgres instead of loading every
    // published site (with its HTML) into memory.
    const rows = await db
      .select({
        userId: projects.userId,
        publishedCount: sql<number>`count(*)::int`,
      })
      .from(projects)
      .where(eq(projects.publishStatus, "published"))
      .groupBy(projects.userId);
    return rows.map((r) => ({ userId: Number(r.userId), publishedCount: Number(r.publishedCount) }));
  }

  async getAllProjectsWithPendingAnim(): Promise<Project[]> {
    // SQL filter — avoid loading every project's generatedCode into Node.
    return db.select().from(projects).where(
      sql`${projects.generatedCode} LIKE '%data-scroll-anim-pending="1"%'`,
    );
  }

  async listProjectIdsWithPendingAnim(limit = 12): Promise<number[]> {
    const rows = await db
      .select({ id: projects.id })
      .from(projects)
      .where(sql`${projects.generatedCode} LIKE '%data-scroll-anim-pending="1"%'`)
      .orderBy(desc(projects.updatedAt))
      .limit(Math.max(1, Math.min(50, limit)));
    return rows.map((r) => r.id);
  }

  // Returns all projects that have a Kling task ID stored — either in a pending
  // spinner section or in a fallback section written after a server restart.
  // Used by the periodic animation-resume job.
  async getAllProjectsWithAnimTaskId(): Promise<Project[]> {
    return db.select().from(projects).where(
      sql`${projects.generatedCode} LIKE '%data-scroll-anim-task-id="%'`
    );
  }

  async listProjectIdsWithAnimTaskId(limit = 8): Promise<number[]> {
    const rows = await db
      .select({ id: projects.id })
      .from(projects)
      .where(sql`${projects.generatedCode} LIKE '%data-scroll-anim-task-id="%'`)
      .orderBy(desc(projects.updatedAt))
      .limit(Math.max(1, Math.min(40, limit)));
    return rows.map((r) => r.id);
  }

  async adminGetAllUsers(): Promise<Omit<User, "password">[]> {
    const rows = await db.select().from(users).orderBy(desc(users.createdAt));
    return rows.map(publicUser);
  }

  async adminGetUserTransactions(userId: number): Promise<CreditTransaction[]> {
    return db.select().from(creditTransactions).where(eq(creditTransactions.userId, userId)).orderBy(desc(creditTransactions.createdAt));
  }

  async getUserTransactionsPage(userId: number, limit: number, offset: number): Promise<{ items: CreditTransaction[]; total: number }> {
    const countResult = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(creditTransactions)
      .where(eq(creditTransactions.userId, userId));
    const total = Number(countResult[0]?.count ?? 0);
    const items = await db
      .select()
      .from(creditTransactions)
      .where(eq(creditTransactions.userId, userId))
      .orderBy(desc(creditTransactions.createdAt))
      .limit(limit)
      .offset(offset);
    return { items, total };
  }

  async adminAdjustCredits(userId: number, amount: number, type: "credit" | "debit", operation: string, note: string): Promise<Omit<User, "password"> | undefined> {
    const idempotencyKey = `admin-${type}-${userId}-${Date.now()}-${Math.random()}`;
    if (type === "credit") {
      const result = await db.execute(sql`UPDATE users SET credits = credits + ${amount} WHERE id = ${userId} RETURNING credits`);
      const rows = result.rows as Array<{ credits: number }>;
      await db.insert(creditTransactions).values({ userId, amount, type: "credit", operation, note, idempotencyKey });
      const user = await this.getUser(userId);
      return user ? publicUser(user) : undefined;
    } else {
      await db.execute(sql`UPDATE users SET credits = GREATEST(0, credits - ${amount}) WHERE id = ${userId}`);
      await db.insert(creditTransactions).values({ userId, amount, type: "debit", operation, note, idempotencyKey });
      const user = await this.getUser(userId);
      return user ? publicUser(user) : undefined;
    }
  }

  async adminGetUserProjects(userId: number): Promise<Array<Omit<Project, "generatedCode"> & { generatedCode: ""; codeBytes: number }>> {
    const rows = await db
      .select({
        id: projects.id,
        userId: projects.userId,
        title: projects.title,
        description: projects.description,
        geminiInteractionId: projects.geminiInteractionId,
        publishedUrl: projects.publishedUrl,
        publishStatus: projects.publishStatus,
        vercelProjectId: projects.vercelProjectId,
        ycStoragePoolId: projects.ycStoragePoolId,
        customDomain: projects.customDomain,
        previewImage: projects.previewImage,
        type: projects.type,
        seoConfig: projects.seoConfig,
        createdAt: projects.createdAt,
        updatedAt: projects.updatedAt,
        codeBytes: sql<number>`coalesce(octet_length(${projects.generatedCode}), 0)::int`,
      })
      .from(projects)
      .where(eq(projects.userId, userId))
      .orderBy(desc(projects.createdAt));
    return rows.map((r) => ({
      ...r,
      generatedCode: "" as const,
      codeBytes: Number(r.codeBytes || 0),
    }));
  }

  async adminGetStats(): Promise<{ totalUsers: number; totalProjects: number; totalTokensSpent: number; totalTokensAdded: number }> {
    const r1 = await db.execute(sql`SELECT COUNT(*)::int as count FROM users`);
    const r2 = await db.execute(sql`SELECT COUNT(*)::int as count FROM projects`);
    const r3 = await db.execute(sql`SELECT COALESCE(SUM(amount),0)::int as total FROM credit_transactions WHERE type='debit' OR type IS NULL`);
    const r4 = await db.execute(sql`SELECT COALESCE(SUM(amount),0)::int as total FROM credit_transactions WHERE type='credit'`);
    return {
      totalUsers: Number((r1.rows[0] as any)?.count ?? 0),
      totalProjects: Number((r2.rows[0] as any)?.count ?? 0),
      totalTokensSpent: Number((r3.rows[0] as any)?.total ?? 0),
      totalTokensAdded: Number((r4.rows[0] as any)?.total ?? 0),
    };
  }

  async createPaymentOrder(data: { userId: number; amount: number; tokens: number; orderId?: string; paymentUrl?: string }): Promise<PaymentOrder> {
    const [order] = await db.insert(paymentOrders).values(data).returning();
    return order;
  }

  async getPaymentOrderById(id: number): Promise<PaymentOrder | undefined> {
    const [order] = await db.select().from(paymentOrders).where(eq(paymentOrders.id, id));
    return order;
  }

  async getPaymentOrderByOrderId(orderId: string): Promise<PaymentOrder | undefined> {
    const [order] = await db.select().from(paymentOrders).where(eq(paymentOrders.orderId, orderId));
    return order;
  }

  async updatePaymentOrderStatus(id: number, status: string, orderId?: string, paidAt?: Date): Promise<PaymentOrder | undefined> {
    const updates: any = { status };
    if (orderId) updates.orderId = orderId;
    if (paidAt) updates.paidAt = paidAt;
    const [order] = await db.update(paymentOrders).set(updates).where(eq(paymentOrders.id, id)).returning();
    return order;
  }

  async getPaymentOrdersByUser(userId: number): Promise<PaymentOrder[]> {
    return db.select().from(paymentOrders).where(eq(paymentOrders.userId, userId)).orderBy(desc(paymentOrders.createdAt));
  }

  async ensurePromoTables(): Promise<void> {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS promo_codes (
        id serial PRIMARY KEY,
        code text NOT NULL UNIQUE,
        credits integer NOT NULL,
        max_activations integer NOT NULL,
        used_count integer NOT NULL DEFAULT 0,
        active integer NOT NULL DEFAULT 1,
        created_by integer,
        note text,
        created_at timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
      )
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS promo_redemptions (
        id serial PRIMARY KEY,
        promo_id integer NOT NULL,
        user_id integer NOT NULL,
        credits integer NOT NULL,
        created_at timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
      )
    `);
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS promo_redemptions_promo_user_uniq
      ON promo_redemptions (promo_id, user_id)
    `);
  }

  async createPromoCode(data: {
    code: string;
    credits: number;
    maxActivations: number;
    createdBy?: number;
    note?: string;
  }): Promise<PromoCode> {
    await this.ensurePromoTables();
    const code = data.code.trim().toUpperCase();
    const [row] = await db.insert(promoCodes).values({
      code,
      credits: data.credits,
      maxActivations: data.maxActivations,
      createdBy: data.createdBy ?? null,
      note: (data.note && data.note.trim()) ? data.note.trim() : null,
    }).returning();
    return row;
  }

  async listPromoCodes(): Promise<PromoCode[]> {
    await this.ensurePromoTables();
    return db.select().from(promoCodes).orderBy(desc(promoCodes.createdAt));
  }

  async setPromoCodeActive(id: number, active: boolean): Promise<PromoCode | undefined> {
    await this.ensurePromoTables();
    const [row] = await db
      .update(promoCodes)
      .set({ active: active ? 1 : 0 })
      .where(eq(promoCodes.id, id))
      .returning();
    return row;
  }

  /**
   * Redeem a promo: 1 activation per user, global cap on usedCount.
   * Credits + redemption + counter update run in one transaction.
   */
  async redeemPromoCode(userId: number, rawCode: string): Promise<{
    ok: boolean;
    credits?: number;
    newBalance?: number;
    error?: "not_found" | "inactive" | "exhausted" | "already_used" | "invalid";
  }> {
    await this.ensurePromoTables();
    const code = String(rawCode || "").trim().toUpperCase();
    if (!code || code.length < 2 || code.length > 64) {
      return { ok: false, error: "invalid" };
    }

    return await db.transaction(async (tx) => {
      const [promo] = await tx.select().from(promoCodes).where(eq(promoCodes.code, code)).limit(1);
      if (!promo) return { ok: false, error: "not_found" as const };
      if (promo.active !== 1) return { ok: false, error: "inactive" as const };
      if (promo.usedCount >= promo.maxActivations) {
        return { ok: false, error: "exhausted" as const };
      }

      const inserted = await tx.insert(promoRedemptions).values({
        promoId: promo.id,
        userId,
        credits: promo.credits,
      }).onConflictDoNothing().returning();

      if (inserted.length === 0) {
        return { ok: false, error: "already_used" as const };
      }

      const bumped = await tx.execute(sql`
        UPDATE promo_codes
        SET used_count = used_count + 1
        WHERE id = ${promo.id} AND active = 1 AND used_count < max_activations
        RETURNING id
      `);
      if (!bumped.rows?.length) {
        // Cap hit between select and update вЂ” roll back via throwing
        throw Object.assign(new Error("PROMO_EXHAUSTED"), { promoError: "exhausted" as const });
      }

      const idempotencyKey = `promo:${promo.id}:${userId}`;
      const creditInserted = await tx.insert(creditTransactions).values({
        userId,
        amount: promo.credits,
        type: "credit",
        operation: "promo",
        note: `РџСЂРѕРјРѕРєРѕРґ ${promo.code}`,
        idempotencyKey,
      }).onConflictDoNothing().returning();

      if (creditInserted.length === 0) {
        // Should not happen if redemption was new, but keep exactly-once semantics.
        const [user] = await tx.select().from(users).where(eq(users.id, userId));
        return { ok: true, credits: promo.credits, newBalance: user?.credits ?? 0 };
      }

      const result = await tx.execute(
        sql`UPDATE users SET credits = credits + ${promo.credits} WHERE id = ${userId} RETURNING credits`
      );
      const rows = result.rows as Array<{ credits: number }>;
      return { ok: true, credits: promo.credits, newBalance: rows?.[0]?.credits ?? 0 };
    }).catch((err: any) => {
      if (err?.promoError === "exhausted") return { ok: false, error: "exhausted" as const };
      throw err;
    });
  }
  async ensureReferralSchema(): Promise<void> {
    await db.execute(sql`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_code text
    `);
    await db.execute(sql`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS referred_by_user_id integer
    `);
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS users_referral_code_uniq
      ON users (referral_code)
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS referral_rewards (
        id serial PRIMARY KEY,
        referrer_user_id integer NOT NULL,
        referred_user_id integer NOT NULL,
        payment_order_id integer NOT NULL,
        tokens_awarded integer NOT NULL,
        created_at timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
      )
    `);
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS referral_rewards_order_uniq
      ON referral_rewards (payment_order_id)
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS referral_exchanges (
        id serial PRIMARY KEY,
        user_id integer NOT NULL,
        tokens integer NOT NULL,
        status text NOT NULL DEFAULT 'pending',
        payment_order_id integer,
        reviewed_by_user_id integer,
        reviewed_at timestamp,
        note text,
        created_at timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
      )
    `);
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS referral_exchanges_payment_order_uniq
      ON referral_exchanges (payment_order_id)
    `);
    // Mark referral rewards that were already auto-credited before manual exchange flow.
    await db.execute(sql`
      INSERT INTO referral_exchanges (user_id, tokens, status, payment_order_id, created_at, reviewed_at, note)
      SELECT rr.referrer_user_id, rr.tokens_awarded, 'approved', rr.payment_order_id, rr.created_at, rr.created_at, 'legacy-auto-credit'
      FROM referral_rewards rr
      WHERE EXISTS (
        SELECT 1 FROM credit_transactions ct
        WHERE ct.idempotency_key = 'referral_payment_' || rr.payment_order_id::text
      )
      ON CONFLICT (payment_order_id) DO NOTHING
    `);
  }

  private async allocateReferralCode(): Promise<string> {
    for (let attempt = 0; attempt < 16; attempt++) {
      const code = crypto.randomBytes(4).toString("hex").toUpperCase();
      const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.referralCode, code)).limit(1);
      if (!existing) return code;
    }
    return `C${Date.now().toString(36).toUpperCase()}${crypto.randomBytes(2).toString("hex").toUpperCase()}`.slice(0, 16);
  }

  async ensureReferralCode(userId: number): Promise<string> {
    await this.ensureReferralSchema();
    const user = await this.getUser(userId);
    if (!user) throw new Error("USER_NOT_FOUND");
    if (user.referralCode) return user.referralCode;
    for (let attempt = 0; attempt < 16; attempt++) {
      const code = await this.allocateReferralCode();
      try {
        const [updated] = await db
          .update(users)
          .set({ referralCode: code })
          .where(and(eq(users.id, userId), isNull(users.referralCode)))
          .returning();
        if (updated?.referralCode) return updated.referralCode;
        const fresh = await this.getUser(userId);
        if (fresh?.referralCode) return fresh.referralCode;
      } catch {
        /* unique race — try another code */
      }
    }
    throw new Error("REFERRAL_CODE_ALLOC_FAILED");
  }

  async getUserByReferralCode(code: string): Promise<User | undefined> {
    await this.ensureReferralSchema();
    const normalized = normalizeReferralCode(code);
    if (!normalized) return undefined;
    const [user] = await db.select().from(users).where(eq(users.referralCode, normalized)).limit(1);
    return user;
  }

  async attachReferral(
    newUserId: number,
    referralCode: string | null | undefined,
  ): Promise<{ attached: boolean; referrerId?: number }> {
    await this.ensureReferralSchema();
    const normalized = normalizeReferralCode(referralCode);
    if (!normalized) return { attached: false };

    const referrer = await this.getUserByReferralCode(normalized);
    if (!referrer || referrer.id === newUserId) return { attached: false };

    const [updated] = await db
      .update(users)
      .set({ referredByUserId: referrer.id })
      .where(and(
        eq(users.id, newUserId),
        isNull(users.referredByUserId),
      ))
      .returning();

    if (!updated) return { attached: false };
    console.log(`[Referral] user ${newUserId} attached to referrer ${referrer.id} (code=${normalized})`);
    return { attached: true, referrerId: referrer.id };
  }

  async awardReferralForPayment(order: {
    id: number;
    userId: number;
    tokens: number;
  }): Promise<{ awarded: boolean; tokens?: number; referrerId?: number }> {
    await this.ensureReferralSchema();
    const bonus = referralBonusTokens(order.tokens);
    if (bonus < 1) return { awarded: false };

    const buyer = await this.getUser(order.userId);
    const referrerId = buyer?.referredByUserId;
    if (!referrerId || referrerId === order.userId) return { awarded: false };

    const referrer = await this.getUser(referrerId);
    if (!referrer) return { awarded: false };

    return await db.transaction(async (tx) => {
      const insertedReward = await tx.insert(referralRewards).values({
        referrerUserId: referrerId,
        referredUserId: order.userId,
        paymentOrderId: order.id,
        tokensAwarded: bonus,
      }).onConflictDoNothing().returning();

      if (insertedReward.length === 0) {
        return { awarded: false };
      }

      console.log(
        `[Referral] +${bonus} referral tokens (pending exchange) -> user ${referrerId} from payment order ${order.id} (buyer ${order.userId})`,
      );
      return { awarded: true, tokens: bonus, referrerId };
    });
  }


  async getReferralAvailableBalance(referrerUserId: number): Promise<number> {
    await this.ensureReferralSchema();
    const [earnedRow] = await db
      .select({ total: sql<number>`coalesce(sum(${referralRewards.tokensAwarded}), 0)::int` })
      .from(referralRewards)
      .where(eq(referralRewards.referrerUserId, referrerUserId));

    const [reservedRow] = await db
      .select({ total: sql<number>`coalesce(sum(${referralExchanges.tokens}), 0)::int` })
      .from(referralExchanges)
      .where(and(
        eq(referralExchanges.userId, referrerUserId),
        sql`${referralExchanges.status} IN ('pending', 'approved')`,
      ));

    return Math.max(0, Number(earnedRow?.total || 0) - Number(reservedRow?.total || 0));
  }

  async requestReferralExchange(userId: number): Promise<{
    ok: boolean;
    exchangeId?: number;
    tokens?: number;
    error?: "nothing_available" | "already_pending";
  }> {
    await this.ensureReferralSchema();
    const [pending] = await db
      .select()
      .from(referralExchanges)
      .where(and(eq(referralExchanges.userId, userId), eq(referralExchanges.status, "pending")))
      .limit(1);
    if (pending) return { ok: false, error: "already_pending" };

    const available = await this.getReferralAvailableBalance(userId);
    if (available < 1) return { ok: false, error: "nothing_available" };

    const [created] = await db.insert(referralExchanges).values({
      userId,
      tokens: available,
      status: "pending",
    }).returning();

    console.log(`[Referral] exchange request #${created.id}: ${available} tokens for user ${userId}`);
    return { ok: true, exchangeId: created.id, tokens: available };
  }

  async listReferralExchanges(status?: string): Promise<Array<ReferralExchange & { displayName: string; email: string | null }>> {
    await this.ensureReferralSchema();
    const rows = await db
      .select({
        id: referralExchanges.id,
        userId: referralExchanges.userId,
        tokens: referralExchanges.tokens,
        status: referralExchanges.status,
        paymentOrderId: referralExchanges.paymentOrderId,
        reviewedByUserId: referralExchanges.reviewedByUserId,
        reviewedAt: referralExchanges.reviewedAt,
        note: referralExchanges.note,
        createdAt: referralExchanges.createdAt,
        displayName: users.displayName,
        email: users.email,
      })
      .from(referralExchanges)
      .leftJoin(users, eq(users.id, referralExchanges.userId))
      .where(status ? eq(referralExchanges.status, status) : undefined)
      .orderBy(desc(referralExchanges.createdAt))
      .limit(100);
    return rows.map((r) => ({
      ...r,
      displayName: r.displayName || `ID ${r.userId}`,
      email: r.email ?? null,
    }));
  }

  async approveReferralExchange(exchangeId: number, adminUserId: number): Promise<{ ok: boolean; error?: string; newBalance?: number }> {
    await this.ensureReferralSchema();
    return db.transaction(async (tx) => {
      const [ex] = await tx
        .select()
        .from(referralExchanges)
        .where(eq(referralExchanges.id, exchangeId))
        .limit(1);
      if (!ex) return { ok: false, error: "not_found" };
      if (ex.status !== "pending") return { ok: false, error: "not_pending" };

      const idempotencyKey = `referral_exchange_${exchangeId}`;
      const creditInserted = await tx.insert(creditTransactions).values({
        userId: ex.userId,
        amount: ex.tokens,
        type: "credit",
        operation: "referral_exchange",
        note: `Обмен реферальных токенов (заявка #${exchangeId})`,
        idempotencyKey,
      }).onConflictDoNothing().returning();

      if (creditInserted.length === 0) {
        return { ok: false, error: "already_credited" };
      }

      const updated = await tx.execute(
        sql`UPDATE users SET credits = credits + ${ex.tokens} WHERE id = ${ex.userId} RETURNING credits`,
      );
      const newBalance = Number((updated.rows as Array<{ credits: number }>)[0]?.credits ?? 0);

      await tx.update(referralExchanges).set({
        status: "approved",
        reviewedByUserId: adminUserId,
        reviewedAt: new Date(),
      }).where(eq(referralExchanges.id, exchangeId));

      console.log(`[Referral] exchange #${exchangeId} approved by admin ${adminUserId}: +${ex.tokens} -> user ${ex.userId}`);
      return { ok: true, newBalance };
    });
  }

  async rejectReferralExchange(exchangeId: number, adminUserId: number): Promise<{ ok: boolean; error?: string }> {
    await this.ensureReferralSchema();
    const [ex] = await db
      .select()
      .from(referralExchanges)
      .where(eq(referralExchanges.id, exchangeId))
      .limit(1);
    if (!ex) return { ok: false, error: "not_found" };
    if (ex.status !== "pending") return { ok: false, error: "not_pending" };

    await db.update(referralExchanges).set({
      status: "rejected",
      reviewedByUserId: adminUserId,
      reviewedAt: new Date(),
    }).where(eq(referralExchanges.id, exchangeId));

    console.log(`[Referral] exchange #${exchangeId} rejected by admin ${adminUserId}`);
    return { ok: true };
  }

  async getReferralStats(referrerUserId: number): Promise<{
    code: string;
    referredCount: number;
    paidReferredCount: number;
    totalTokensEarned: number;
    availableBalance: number;
    pendingExchange: ReferralExchange | null;
    recent: Array<{
      id: number;
      referredUserId: number;
      referredDisplayName: string;
      paymentOrderId: number;
      tokensAwarded: number;
      createdAt: Date;
    }>;
  }> {
    await this.ensureReferralSchema();
    const code = await this.ensureReferralCode(referrerUserId);
    const availableBalance = await this.getReferralAvailableBalance(referrerUserId);

    const [pendingExchange] = await db
      .select()
      .from(referralExchanges)
      .where(and(eq(referralExchanges.userId, referrerUserId), eq(referralExchanges.status, "pending")))
      .limit(1);

    const [countRow] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(users)
      .where(eq(users.referredByUserId, referrerUserId));

    const paidRes = await db.execute(sql`
      SELECT COUNT(DISTINCT referred_user_id)::int AS n
      FROM referral_rewards
      WHERE referrer_user_id = ${referrerUserId}
    `);
    const paidRow = (paidRes.rows as Array<{ n: number }>)[0];

    const [sumRow] = await db
      .select({ total: sql<number>`coalesce(sum(${referralRewards.tokensAwarded}), 0)::int` })
      .from(referralRewards)
      .where(eq(referralRewards.referrerUserId, referrerUserId));

    const recentRows = await db
      .select({
        id: referralRewards.id,
        referredUserId: referralRewards.referredUserId,
        referredDisplayName: users.displayName,
        paymentOrderId: referralRewards.paymentOrderId,
        tokensAwarded: referralRewards.tokensAwarded,
        createdAt: referralRewards.createdAt,
      })
      .from(referralRewards)
      .leftJoin(users, eq(users.id, referralRewards.referredUserId))
      .where(eq(referralRewards.referrerUserId, referrerUserId))
      .orderBy(desc(referralRewards.createdAt))
      .limit(20);

    return {
      code,
      referredCount: Number(countRow?.n || 0),
      paidReferredCount: Number(paidRow?.n || 0),
      totalTokensEarned: Number(sumRow?.total || 0),
      availableBalance,
      pendingExchange: pendingExchange ?? null,
      recent: recentRows.map((r) => ({
        id: r.id,
        referredUserId: r.referredUserId,
        referredDisplayName: r.referredDisplayName || `ID ${r.referredUserId}`,
        paymentOrderId: r.paymentOrderId,
        tokensAwarded: r.tokensAwarded,
        createdAt: r.createdAt,
      })),
    };
  }
}

export const storage = new DatabaseStorage();

