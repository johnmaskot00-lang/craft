import { sql } from "drizzle-orm";
import { pgTable, text, varchar, serial, integer, timestamp, json, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").unique(),
  password: text("password"),
  displayName: text("display_name").notNull(),
  credits: integer("credits").notNull().default(0),
  plan: text("plan").notNull().default("bronze"),
  telegramId: text("telegram_id").unique(),
  yandexId: text("yandex_id").unique(),
  avatarUrl: text("avatar_url"),
  /** Public invite code for https://craft-ai.ru/r/<code> (unique when set). */
  referralCode: text("referral_code").unique(),
  /** Set once at signup when arriving via a referral link. */
  referredByUserId: integer("referred_by_user_id"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export interface SeoKeyword {
  id: string;
  keyword: string;
  slug: string;
  title: string;
  status: "pending" | "generating" | "done" | "failed";
  filename?: string;
  image?: string;
  publishedAt?: string;
  updatedAt?: string;
  contentType?: "guide" | "comparison" | "tutorial" | "review" | "listicle";
  keyQuestions?: string[];
  /** Per-article offer — wins over cluster/site defaults when generating CTAs. */
  niche?: string;
  targetUrl?: string;
  ctaLabel?: string;
}

export interface SeoCluster {
  id: string;
  name: string;
  slug: string;
  description: string;
  keywords: SeoKeyword[];
  /** Default offer for keywords in this category (used when keyword has none). */
  niche?: string;
  targetUrl?: string;
  ctaLabel?: string;
}

export type SeoLayoutFamily =
  | "editorial"
  | "magazine"
  | "knowledge"
  | "visual"
  | "portal"
  | "digest";

// Per-site publication system. Version 2 sites use the structural family and
// variants below; legacy sites keep their original fixed HTML skeleton.
export interface SeoTheme {
  id: string;
  name: string;
  headingFont: string; // Cyrillic-capable Google Font
  bodyFont: string;    // Cyrillic-capable Google Font
  accent: string;
  accent2: string;
  text: string;
  text2: string;
  muted: string;
  bg: string;
  bg2: string;
  bg3: string;
  border: string;
  nav: string;
  radius: string;
  layout?: "magazine" | "newspaper" | "mosaic" | "stacked" | "editorial" | "night";
  navStyle?: "dark" | "light" | "line";
  navVariant?: "masthead" | "bar" | "index" | "floating" | "newswire" | "numbered";
  cardStyle?: "boxed" | "overlay" | "row";
  density?: "compact" | "comfy" | "airy";
  dark?: boolean;
  artDirected?: boolean;
  designBrief?: string;
  layoutFamily?: SeoLayoutFamily;
  homeVariant?: "lead-grid" | "single-feature" | "topic-first" | "story-mosaic" | "newsroom" | "compact-feed" | "slider-split" | "cinematic-cover" | "mosaic-stage" | "story-rail" | "topic-orbit" | "magazine-deck";
  categoryVariant?: "grid" | "index" | "featured" | "feed";
  articleVariant?: "sidebar-right" | "sidebar-left" | "focus" | "wide";
  sectionOrder?: Array<"hero" | "topics" | "latest" | "trending" | "cta">;
}

export interface SeoConfig {
  niche: string;
  rawKeywords: string[];
  clusters: SeoCluster[];
  siteTitle: string;
  siteDescription: string;
  projectName?: string;
  theme?: SeoTheme;
  /** Set only for newly analyzed projects; missing means preserve the legacy skeleton. */
  structuralVersion?: 2;
  /** Curated architecture/navigation generation version for safe in-place upgrades of v2 sites. */
  architectureVersion?: 4 | 5 | 6;
  /** One generated square brand mark reused across every page and deployment. */
  logoUrl?: string;
  logoStatus?: "pending" | "generating" | "ready" | "fallback";
  /** Site-wide default affiliate/ref offer (overridden by cluster or keyword). */
  targetUrl?: string;
  ctaLabel?: string;
  status: "idle" | "analyzing" | "generating" | "done" | "error";
  pagesTotal: number;
  pagesGenerated: number;
  publishUrl?: string;
  faviconDataUrl?: string;
  faviconMime?: string;
}

/** Resolve which referral/CTA to use for an article (keyword → cluster → site). */
export function resolveSeoOffer(
  kw: Pick<SeoKeyword, "niche" | "targetUrl" | "ctaLabel"> | null | undefined,
  cluster: Pick<SeoCluster, "niche" | "targetUrl" | "ctaLabel"> | null | undefined,
  cfg: Pick<SeoConfig, "niche" | "targetUrl" | "ctaLabel">,
): { niche: string; targetUrl: string; ctaLabel: string } {
  const niche = String(kw?.niche || cluster?.niche || cfg.niche || "").trim();
  const targetUrl = String(kw?.targetUrl || cluster?.targetUrl || cfg.targetUrl || "").trim();
  const ctaLabel = String(kw?.ctaLabel || cluster?.ctaLabel || cfg.ctaLabel || "Попробовать →").trim()
    || "Попробовать →";
  return { niche, targetUrl, ctaLabel };
}

/** Human product name for native editorial mentions (niche or hostname). */
export function seoOfferProductName(niche: string, targetUrl: string): string {
  const n = String(niche || "").trim();
  if (n) {
    const words = n.split(/\s+/).filter(Boolean);
    // Short brand-like niches: "Dremia", "AI Dream", "Маркетплейс Dremia"
    if (words.length <= 4 && n.length <= 48) {
      const brandish = words.find((w) => /^[A-Za-z][\w.-]{1,24}$/.test(w) && /[a-zA-Z]/.test(w));
      if (brandish && !/^(ai|ии|для|the|and|маркетплейс|сервис|платформа)$/i.test(brandish)) {
        return brandish;
      }
      if (words.length <= 2) return n;
    }
  }
  try {
    const host = new URL(targetUrl).hostname.replace(/^www\./i, "");
    const base = (host.split(".")[0] || host).replace(/[-_]+/g, " ");
    return base
      .split(/\s+/)
      .filter(Boolean)
      .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
      .join(" ") || "сервис";
  } catch {
    return n || "сервис";
  }
}

export const projects = pgTable("projects", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  generatedCode: text("generated_code").notNull().default(""),
  geminiInteractionId: text("gemini_interaction_id"),
  publishedUrl: text("published_url"),
  publishStatus: text("publish_status").notNull().default("draft"),
  vercelProjectId: text("vercel_project_id"),
  /** Yandex Object Storage pool (cloud) where the project bucket lives. */
  ycStoragePoolId: integer("yc_storage_pool_id"),
  customDomain: text("custom_domain"),
  type: varchar("type", { length: 20 }).notNull().default("website"),
  seoConfig: json("seo_config").$type<SeoConfig>(),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

/**
 * One row = one Yandex Cloud used as an Object Storage pool.
 * Default quota is 25 buckets/cloud; we keep a soft limit and auto-create
 * a new cloud when the active pool is full.
 */
export const ycStoragePools = pgTable("yc_storage_pools", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  cloudId: text("cloud_id").notNull(),
  folderId: text("folder_id").notNull(),
  accessKeyId: text("access_key_id").notNull(),
  secretAccessKey: text("secret_access_key").notNull(),
  bucketCount: integer("bucket_count").notNull().default(0),
  bucketLimit: integer("bucket_limit").notNull().default(20),
  status: text("status").notNull().default("active"), // active | full | error
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export type YcStoragePool = typeof ycStoragePools.$inferSelect;

export const projectMessages = pgTable("project_messages", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull(),
  role: text("role").notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const projectImages = pgTable("project_images", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull(),
  userId: integer("user_id"),
  name: text("name").notNull(),
  url: text("url").notNull(),
  prompt: text("prompt").notNull().default(""),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const projectVersions = pgTable("project_versions", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull(),
  code: text("code").notNull(),
  label: text("label").notNull().default(""),
  files: json("files").$type<{filename: string, code: string}[]>(),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const insertUserSchema = createInsertSchema(users).omit({
  id: true,
  createdAt: true,
  credits: true,
  plan: true,
  telegramId: true,
  avatarUrl: true,
  referralCode: true,
  referredByUserId: true,
});

export const insertProjectSchema = createInsertSchema(projects).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertProjectMessageSchema = createInsertSchema(projectMessages).omit({
  id: true,
  createdAt: true,
});

export const insertProjectImageSchema = createInsertSchema(projectImages).omit({
  id: true,
  createdAt: true,
});

export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;
export type Project = typeof projects.$inferSelect;
export type InsertProject = z.infer<typeof insertProjectSchema>;
export type ProjectMessage = typeof projectMessages.$inferSelect;
export type InsertProjectMessage = z.infer<typeof insertProjectMessageSchema>;
export type ProjectImage = typeof projectImages.$inferSelect;
export type InsertProjectImage = z.infer<typeof insertProjectImageSchema>;

export const insertProjectVersionSchema = createInsertSchema(projectVersions).omit({
  id: true,
  createdAt: true,
});
export type ProjectVersion = typeof projectVersions.$inferSelect;
export type InsertProjectVersion = z.infer<typeof insertProjectVersionSchema>;

export const projectFiles = pgTable("project_files", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull(),
  filename: text("filename").notNull(),
  code: text("code").notNull(),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (t) => ({
  projectFilenameUniq: uniqueIndex("project_files_project_id_filename_uniq").on(t.projectId, t.filename),
}));

export const insertProjectFileSchema = createInsertSchema(projectFiles).omit({
  id: true,
  createdAt: true,
});
export type ProjectFile = typeof projectFiles.$inferSelect;
export type InsertProjectFile = z.infer<typeof insertProjectFileSchema>;

export const creditTransactions = pgTable("credit_transactions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  amount: integer("amount").notNull(),
  type: text("type").notNull().default("debit"),
  operation: text("operation").notNull(),
  note: text("note"),
  idempotencyKey: text("idempotency_key").notNull().unique(),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export type CreditTransaction = typeof creditTransactions.$inferSelect;

export const leads = pgTable("leads", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull(),
  name: text("name").notNull().default(""),
  email: text("email").notNull().default(""),
  phone: text("phone").notNull().default(""),
  message: text("message").notNull().default(""),
  source: text("source").notNull().default("form"),
  isRead: integer("is_read").notNull().default(0),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const insertLeadSchema = createInsertSchema(leads).omit({
  id: true,
  createdAt: true,
  isRead: true,
});
export type Lead = typeof leads.$inferSelect;
export type InsertLead = z.infer<typeof insertLeadSchema>;

export const paymentOrders = pgTable("payment_orders", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  amount: integer("amount").notNull(),
  tokens: integer("tokens").notNull(),
  status: text("status").notNull().default("pending"),
  orderId: text("order_id"),
  paymentUrl: text("payment_url"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  paidAt: timestamp("paid_at"),
});

export type PaymentOrder = typeof paymentOrders.$inferSelect;

/** Admin-created promo codes: name/code, credit grant, global activation cap. */
export const promoCodes = pgTable("promo_codes", {
  id: serial("id").primaryKey(),
  /** Normalized uppercase code users type in (unique). */
  code: text("code").notNull().unique(),
  credits: integer("credits").notNull(),
  maxActivations: integer("max_activations").notNull(),
  usedCount: integer("used_count").notNull().default(0),
  /** 1 = active, 0 = disabled. */
  active: integer("active").notNull().default(1),
  createdBy: integer("created_by"),
  note: text("note"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const insertPromoCodeSchema = createInsertSchema(promoCodes).omit({
  id: true,
  usedCount: true,
  createdAt: true,
});
export type PromoCode = typeof promoCodes.$inferSelect;
export type InsertPromoCode = z.infer<typeof insertPromoCodeSchema>;

/** One redemption per user per promo (enforced by unique index). */
export const promoRedemptions = pgTable("promo_redemptions", {
  id: serial("id").primaryKey(),
  promoId: integer("promo_id").notNull(),
  userId: integer("user_id").notNull(),
  credits: integer("credits").notNull(),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (t) => ({
  promoUserUniq: uniqueIndex("promo_redemptions_promo_user_uniq").on(t.promoId, t.userId),
}));

export type PromoRedemption = typeof promoRedemptions.$inferSelect;

/** Exactly-once 20% token bonus to referrer for each paid order of a referred user. */
export const referralRewards = pgTable("referral_rewards", {
  id: serial("id").primaryKey(),
  referrerUserId: integer("referrer_user_id").notNull(),
  referredUserId: integer("referred_user_id").notNull(),
  paymentOrderId: integer("payment_order_id").notNull(),
  tokensAwarded: integer("tokens_awarded").notNull(),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (t) => ({
  orderUniq: uniqueIndex("referral_rewards_order_uniq").on(t.paymentOrderId),
}));

export type ReferralReward = typeof referralRewards.$inferSelect;

/**
 * express-session / connect-pg-simple store.
 * MUST stay in the Drizzle schema: `drizzle-kit push --force` otherwise treats
 * this table as orphaned and drops it on every Amvera restart — logging out all users.
 */
export const sessions = pgTable("session", {
  sid: varchar("sid").primaryKey(),
  sess: json("sess").notNull(),
  expire: timestamp("expire", { precision: 6 }).notNull(),
});
