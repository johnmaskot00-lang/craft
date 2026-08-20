import { db } from "./db";
import { users, projects, projectMessages, projectImages, projectVersions, projectFiles, leads, creditTransactions, paymentOrders, promoCodes, promoRedemptions, referralRewards, type User, type InsertUser, type Project, type InsertProject, type ProjectMessage, type InsertProjectMessage, type ProjectImage, type InsertProjectImage, type ProjectVersion, type InsertProjectVersion, type ProjectFile, type InsertProjectFile, type Lead, type InsertLead, type CreditTransaction, type PaymentOrder, type PromoCode } from "@shared/schema";
import { eq, desc, and, sql, gte, isNull } from "drizzle-orm";
import crypto from "crypto";
import { referralBonusTokens, normalizeReferralCode } from "./referral";

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
  createProject(project: InsertProject): Promise<Project>;
  updateProject(id: number, data: Partial<Project>): Promise<Project | undefined>;
  deleteProject(id: number): Promise<void>;

  getProjectMessages(projectId: number): Promise<ProjectMessage[]>;
  createProjectMessage(message: InsertProjectMessage): Promise<ProjectMessage>;

  getProjectImages(projectId: number): Promise<ProjectImage[]>;
  getImagesByUser(userId: number): Promise<(ProjectImage & { projectTitle: string })[]>;
  getImagesByUserPage(userId: number, limit: number, offset: number): Promise<{ items: (ProjectImage & { projectTitle: string })[]; total: number }>;
  createProjectImage(image: InsertProjectImage): Promise<ProjectImage>;
  deleteProjectImage(id: number): Promise<void>;

  getProjectVersions(projectId: number): Promise<ProjectVersion[]>;
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

  adminGetAllUsers(): Promise<User[]>;
  adminGetUserTransactions(userId: number): Promise<import("@shared/schema").CreditTransaction[]>;
  getUserTransactionsPage(userId: number, limit: number, offset: number): Promise<{ items: import("@shared/schema").CreditTransaction[]; total: number }>;
  adminAdjustCredits(userId: number, amount: number, type: "credit" | "debit", operation: string, note: string): Promise<User | undefined>;
  adminGetUserProjects(userId: number): Promise<Project[]>;
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
    recent: Array<{
      id: number;
      referredUserId: number;
      referredDisplayName: string;
      paymentOrderId: number;
      tokensAwarded: number;
      createdAt: Date;
    }>;
  }>;
}

export const NEW_USER_CREDITS = 0;

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

  async getProjectsByUser(userId: number): Promise<Project[]> {
    return db.select().from(projects).where(eq(projects.userId, userId)).orderBy(desc(projects.createdAt));
  }

  async createProject(insertProject: InsertProject): Promise<Project> {
    const [project] = await db.insert(projects).values(insertProject).returning();
    return project;
  }

  async updateProject(id: number, data: Partial<Project>): Promise<Project | undefined> {
    const [project] = await db.update(projects).set({ ...data, updatedAt: new Date() }).where(eq(projects.id, id)).returning();
    return project;
  }

  async deleteProject(id: number): Promise<void> {
    await Promise.all([
      db.delete(projectMessages).where(eq(projectMessages.projectId, id)),
      db.delete(projectFiles).where(eq(projectFiles.projectId, id)),
      db.delete(projectVersions).where(eq(projectVersions.projectId, id)),
      db.delete(projectImages).where(eq(projectImages.projectId, id)),
      db.delete(leads).where(eq(leads.projectId, id)),
    ]);
    await db.delete(projects).where(eq(projects.id, id));
  }

  async getProjectMessages(projectId: number): Promise<ProjectMessage[]> {
    return db.select().from(projectMessages).where(eq(projectMessages.projectId, projectId)).orderBy(projectMessages.createdAt);
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
    return db.select().from(projectVersions).where(eq(projectVersions.projectId, projectId)).orderBy(desc(projectVersions.createdAt));
  }

  async createProjectVersion(version: InsertProjectVersion): Promise<ProjectVersion> {
    const [v] = await db.insert(projectVersions).values(version).returning();
    // Version snapshots contain full HTML + multipage files and can be hundreds
    // of KB each. Keep a bounded history per project to prevent PostgreSQL/WAL
    // from filling the CNPG volume again. Does NOT delete /objects media files.
    try {
      await db.execute(sql`
        DELETE FROM project_versions
        WHERE id IN (
          SELECT id
          FROM project_versions
          WHERE project_id = ${version.projectId}
          ORDER BY created_at DESC, id DESC
          OFFSET 80
        )
      `);
    } catch (err: any) {
      console.warn("[versions] retention cleanup failed:", err?.message || err);
    }
    return v;
  }

  async updateProjectVersion(
    id: number,
    data: { code?: string; files?: { filename: string; code: string }[] | null; label?: string },
  ): Promise<ProjectVersion | undefined> {
    const patch: Partial<typeof projectVersions.$inferInsert> = {};
    if (data.code !== undefined) patch.code = data.code;
    if (data.files !== undefined) patch.files = data.files;
    if (data.label !== undefined) patch.label = data.label;
    if (!Object.keys(patch).length) {
      const [cur] = await db.select().from(projectVersions).where(eq(projectVersions.id, id));
      return cur;
    }
    const [v] = await db.update(projectVersions).set(patch).where(eq(projectVersions.id, id)).returning();
    return v;
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
    const userProjects = await db.select().from(projects).where(eq(projects.userId, userId));
    const projectIds = userProjects.map(p => p.id);
    if (projectIds.length === 0) return [];
    const allLeads: (Lead & { projectTitle: string })[] = [];
    for (const proj of userProjects) {
      const projLeads = await db.select().from(leads).where(eq(leads.projectId, proj.id)).orderBy(desc(leads.createdAt));
      for (const l of projLeads) {
        allLeads.push({ ...l, projectTitle: proj.title });
      }
    }
    allLeads.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return allLeads;
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
    const userProjects = await db.select().from(projects).where(eq(projects.userId, userId));
    let count = 0;
    for (const proj of userProjects) {
      const projLeads = await db.select().from(leads).where(eq(leads.projectId, proj.id));
      count += projLeads.filter(l => l.isRead === 0).length;
    }
    return count;
  }

  async getProjectByCustomDomain(domain: string): Promise<Project | undefined> {
    const result = await db.select().from(projects).where(eq(projects.customDomain, domain)).limit(1);
    return result[0];
  }

  async getPublishedProjectsCount(userId: number): Promise<number> {
    const result = await db.select().from(projects).where(and(eq(projects.userId, userId), eq(projects.publishStatus, "published")));
    return result.length;
  }

  async getAllPublishedProjects(): Promise<Project[]> {
    return db.select().from(projects).where(eq(projects.publishStatus, "published"));
  }

  async getAllUsersWithPublishedSites(): Promise<{ userId: number; publishedCount: number }[]> {
    const published = await db.select().from(projects).where(eq(projects.publishStatus, "published"));
    const map = new Map<number, number>();
    for (const p of published) {
      map.set(p.userId, (map.get(p.userId) || 0) + 1);
    }
    return Array.from(map.entries()).map(([userId, publishedCount]) => ({ userId, publishedCount }));
  }

  async getAllProjectsWithPendingAnim(): Promise<Project[]> {
    // SQL filter вЂ” avoid loading every project's generatedCode into Node.
    return db.select().from(projects).where(
      sql`${projects.generatedCode} LIKE '%data-scroll-anim-pending="1"%'`,
    );
  }

  // Returns all projects that have a Kling task ID stored вЂ” either in a pending
  // spinner section or in a fallback section written after a server restart.
  // Used by the periodic animation-resume job.
  async getAllProjectsWithAnimTaskId(): Promise<Project[]> {
    return db.select().from(projects).where(
      sql`${projects.generatedCode} LIKE '%data-scroll-anim-task-id="%'`
    );
  }

  async adminGetAllUsers(): Promise<User[]> {
    return db.select().from(users).orderBy(desc(users.createdAt));
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

  async adminAdjustCredits(userId: number, amount: number, type: "credit" | "debit", operation: string, note: string): Promise<User | undefined> {
    const idempotencyKey = `admin-${type}-${userId}-${Date.now()}-${Math.random()}`;
    if (type === "credit") {
      const result = await db.execute(sql`UPDATE users SET credits = credits + ${amount} WHERE id = ${userId} RETURNING credits`);
      const rows = result.rows as Array<{ credits: number }>;
      await db.insert(creditTransactions).values({ userId, amount, type: "credit", operation, note, idempotencyKey });
      return this.getUser(userId);
    } else {
      await db.execute(sql`UPDATE users SET credits = GREATEST(0, credits - ${amount}) WHERE id = ${userId}`);
      await db.insert(creditTransactions).values({ userId, amount, type: "debit", operation, note, idempotencyKey });
      return this.getUser(userId);
    }
  }

  async adminGetUserProjects(userId: number): Promise<Project[]> {
    return db.select().from(projects).where(eq(projects.userId, userId)).orderBy(desc(projects.createdAt));
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

      const idempotencyKey = `referral_payment_${order.id}`;
      const creditInserted = await tx.insert(creditTransactions).values({
        userId: referrerId,
        amount: bonus,
        type: "credit",
        operation: "referral",
        note: `Р РµС„РµСЂР°Р»СЊРЅС‹Р№ Р±РѕРЅСѓСЃ 20% Р·Р° РѕРїР»Р°С‚Сѓ РґСЂСѓРіР° (#${order.id})`,
        idempotencyKey,
      }).onConflictDoNothing().returning();

      if (creditInserted.length === 0) {
        return { awarded: false };
      }

      await tx.execute(
        sql`UPDATE users SET credits = credits + ${bonus} WHERE id = ${referrerId}`,
      );

      console.log(
        `[Referral] +${bonus} tokens в†’ user ${referrerId} from payment order ${order.id} (buyer ${order.userId})`,
      );
      return { awarded: true, tokens: bonus, referrerId };
    });
  }

  async getReferralStats(referrerUserId: number): Promise<{
    code: string;
    referredCount: number;
    paidReferredCount: number;
    totalTokensEarned: number;
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

