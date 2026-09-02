import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Coins, Calendar, Hash, User, Shield, HeadphonesIcon, Gift, LogOut, History, ChevronLeft, ChevronRight, Loader2, Copy, Check, Users, Link2 } from "lucide-react";

const appleFont = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Helvetica Neue", Arial, sans-serif';
const HISTORY_PAGE_SIZE = 20;
const SUPPORT_TELEGRAM_URL = "https://telegram.me/alextraffic";

const PLAN_LABELS: Record<string, string> = {
  free: "Бесплатный",
  bronze: "Старт",
  silver: "Базовый",
  gold: "Профи",
  platinum: "Ультра",
};

type CreditTxn = {
  id: number;
  amount: number;
  type: string;
  operation: string;
  label: string;
  note: string | null;
  createdAt: string;
};

type CreditHistoryPage = {
  items: CreditTxn[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
};

type ReferralMe = {
  code: string;
  link: string;
  ratePercent: number;
  referredCount: number;
  paidReferredCount: number;
  totalTokensEarned: number;
  availableBalance: number;
  pendingExchange: { id: number; tokens: number; createdAt: string } | null;
  recent: Array<{
    id: number;
    referredUserId: number;
    referredDisplayName: string;
    paymentOrderId: number;
    tokensAwarded: number;
    createdAt: string;
  }>;
};

export default function ProfilePage() {
  const { user, logout } = useAuth();
  const [, setLocation] = useLocation();
  const [historyPage, setHistoryPage] = useState(1);
  const [promoCode, setPromoCode] = useState("");
  const [copiedRef, setCopiedRef] = useState(false);
  const { toast } = useToast();

  const { data: historyData, isLoading: historyLoading, isError: historyError, isFetching: historyFetching } = useQuery<CreditHistoryPage>({
    queryKey: ["/api/credits/history", historyPage, HISTORY_PAGE_SIZE],
    queryFn: async () => {
      const res = await fetch(`/api/credits/history?page=${historyPage}&limit=${HISTORY_PAGE_SIZE}`, {
        credentials: "include",
      });
      if (!res.ok) {
        const text = (await res.text()) || res.statusText;
        throw new Error(`${res.status}: ${text}`);
      }
      return res.json();
    },
    enabled: !!user,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    placeholderData: (prev) => prev,
  });

  const { data: referral, isLoading: referralLoading } = useQuery<ReferralMe>({
    queryKey: ["/api/referral/me"],
    queryFn: async () => {
      const res = await fetch("/api/referral/me", { credentials: "include" });
      if (!res.ok) {
        const text = (await res.text()) || res.statusText;
        throw new Error(`${res.status}: ${text}`);
      }
      return res.json();
    },
    enabled: !!user,
    staleTime: 30_000,
  });

  const exchangeMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/referral/exchange", {});
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message || "Не удалось отправить заявку");
      return data;
    },
    onSuccess: (data) => {
      toast({
        title: "Заявка отправлена",
        description: data.message || `Обмен ${data.tokens} токенов ожидает подтверждения`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/referral/me"] });
    },
    onError: (err: any) => {
      toast({ title: "Ошибка", description: err?.message || "Не удалось обменять", variant: "destructive" });
    },
  });

  const redeemMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/promo/redeem", { code: promoCode.trim() });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message || "Не удалось активировать");
      return data;
    },
    onSuccess: (data) => {
      toast({
        title: "Промокод активирован",
        description: data.message || `Начислено ${data.credits} токенов`,
      });
      setPromoCode("");
      if (data.newBalance !== undefined) {
        queryClient.setQueryData(["/api/auth/user"], (old: any) =>
          old ? { ...old, credits: data.newBalance } : old,
        );
      }
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      queryClient.invalidateQueries({ queryKey: ["/api/credits/history"] });
    },
    onError: (err: any) => {
      let msg = err?.message || "Не удалось активировать промокод";
      try {
        const m = String(msg).match(/\{.*\}/);
        if (m) {
          const p = JSON.parse(m[0]);
          if (p.message) msg = p.message;
        }
      } catch {}
      toast({ title: "Ошибка", description: msg, variant: "destructive" });
    },
  });

  if (!user) return null;

  const history = historyData?.items ?? [];
  const historyTotal = historyData?.total ?? 0;
  const historyTotalPages = Math.max(1, historyData?.totalPages ?? 1);
  const currentHistoryPage = Math.min(historyPage, historyTotalPages);

  const joinDate = new Date(user.createdAt).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
  const planLabel = PLAN_LABELS[user.plan ?? "free"] ?? user.plan;

  const rows = [
    { icon: <Hash size={16} color="#007AFF" />, bg: "rgba(0,122,255,0.08)", label: "Пользователь ID", value: `#${user.id}`, mono: true },
    { icon: <User size={16} color="#5856D6" />, bg: "rgba(88,86,214,0.08)", label: "Имя", value: user.displayName || user.email?.split("@")[0] || "—" },
    { icon: <Coins size={16} color="hsl(27deg 93% 60%)" />, bg: "rgba(255,149,0,0.08)", label: "Токены", value: String(user.credits ?? 0) },
    { icon: <Shield size={16} color="#34C759" />, bg: "rgba(52,199,89,0.08)", label: "Тарифный план", value: planLabel },
    { icon: <Calendar size={16} color="#FF9500" />, bg: "rgba(255,149,0,0.08)", label: "Дата регистрации", value: joinDate },
  ];

  const navItems = [
    {
      icon: <HeadphonesIcon size={15} />,
      label: "Поддержка",
      color: "#007AFF",
      danger: false,
      onClick: () => {
        window.open(SUPPORT_TELEGRAM_URL, "_blank", "noopener,noreferrer");
      },
    },
    {
      icon: <LogOut size={15} />,
      label: "Выйти",
      color: "#FF3B30",
      danger: true,
      onClick: async () => {
        await logout();
        setLocation("/auth");
      },
    },
  ];

  const canRedeem = promoCode.trim().length >= 2 && !redeemMutation.isPending;

  return (
    <div style={{ minHeight: "100vh", background: "#FBFBFD", fontFamily: appleFont }}>

      {/* Header */}
      <header style={{ position: "sticky", top: 0, zIndex: 50, background: "rgba(251,251,253,0.88)", backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)", borderBottom: "1px solid rgba(0,0,0,0.06)" }}>
        <div style={{ maxWidth: 640, margin: "0 auto", padding: "0 1.5rem", display: "flex", alignItems: "center", gap: "1rem", height: 64 }}>
          <button
            onClick={() => setLocation("/dashboard")}
            style={{ width: 38, height: 38, borderRadius: 11, background: "rgba(0,0,0,0.04)", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "#86868B" }}
            onMouseEnter={e => (e.currentTarget.style.background = "rgba(0,0,0,0.08)")}
            onMouseLeave={e => (e.currentTarget.style.background = "rgba(0,0,0,0.04)")}
          >
            <ArrowLeft size={17} />
          </button>
          <span style={{ fontSize: "1.05rem", fontWeight: 700, letterSpacing: "-0.025em", color: "#1D1D1F" }}>Профиль</span>
        </div>
      </header>

      <main style={{ maxWidth: 640, margin: "0 auto", padding: "2.5rem 1.5rem" }}>

        {/* Avatar block */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: "2.5rem" }}>
          <div style={{ width: 96, height: 96, borderRadius: "50%", overflow: "hidden", background: "linear-gradient(135deg,hsl(27deg 93% 60%),#00a6ff)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 8px 32px rgba(0,166,255,0.25)", marginBottom: "1rem", border: "3px solid rgba(255,255,255,0.9)" }}>
            {user.avatarUrl ? (
              <img src={user.avatarUrl} alt="avatar" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            ) : (
              <span style={{ fontSize: "2.2rem", fontWeight: 700, color: "#fff" }}>
                {(user.displayName || user.email || "U")[0].toUpperCase()}
              </span>
            )}
          </div>
          <h1 style={{ fontSize: "1.5rem", fontWeight: 700, letterSpacing: "-0.035em", color: "#1D1D1F", margin: "0 0 0.25rem" }}>
            {user.displayName || user.email?.split("@")[0]}
          </h1>
          <span style={{ fontSize: "0.78rem", fontWeight: 600, color: "#007AFF", background: "rgba(0,122,255,0.08)", padding: "0.2rem 0.75rem", borderRadius: 100 }}>
            {planLabel}
          </span>
        </div>

        {/* Info rows */}
        <div style={{ background: "#fff", borderRadius: 20, border: "1px solid rgba(0,0,0,0.06)", boxShadow: "0 2px 12px rgba(0,0,0,0.04)", overflow: "hidden", marginBottom: "1.25rem" }}>
          {rows.map((row, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: "0.875rem", padding: "0.9rem 1.25rem", borderBottom: i < rows.length - 1 ? "1px solid rgba(0,0,0,0.05)" : "none" }}>
              <div style={{ width: 34, height: 34, borderRadius: 10, background: row.bg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                {row.icon}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: "0.68rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "#AEAEB2", marginBottom: 2 }}>{row.label}</div>
                <div style={{ fontSize: "0.92rem", fontWeight: 600, color: "#1D1D1F", fontFamily: row.mono ? '"SF Mono", "Menlo", monospace' : appleFont }}>{row.value}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Referral program */}
        <div style={{ background: "#fff", borderRadius: 20, border: "1px solid rgba(0,0,0,0.06)", boxShadow: "0 2px 12px rgba(0,0,0,0.04)", overflow: "hidden", marginBottom: "1.25rem", padding: "1.1rem 1.25rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "0.85rem" }}>
            <div style={{ width: 34, height: 34, borderRadius: 10, background: "rgba(52,199,89,0.12)", display: "flex", alignItems: "center", justifyContent: "center", color: "#34C759" }}>
              <Users size={16} />
            </div>
            <div>
              <div style={{ fontSize: "0.92rem", fontWeight: 700, color: "#1D1D1F" }}>Реферальная программа</div>
              <div style={{ fontSize: "0.72rem", color: "#AEAEB2", marginTop: 2 }}>
                {referral?.ratePercent ?? 20}% токенов с каждой оплаты друга
              </div>
            </div>
          </div>

          {referralLoading && !referral ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#AEAEB2", fontSize: "0.85rem" }}>
              <Loader2 size={14} className="animate-spin" /> Загрузка…
            </div>
          ) : (
            <>
              <div style={{ display: "flex", gap: 8, alignItems: "stretch", marginBottom: "0.85rem" }}>
                <div
                  style={{
                    flex: 1, padding: "0.7rem 0.9rem", borderRadius: 12, border: "1px solid rgba(0,0,0,0.1)",
                    fontSize: "0.78rem", fontWeight: 600, background: "rgba(0,0,0,0.02)", color: "#1D1D1F",
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: appleFont,
                  }}
                  title={referral?.link}
                  data-testid="text-referral-link"
                >
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <Link2 size={13} color="#86868B" />
                    {referral?.link || "—"}
                  </span>
                </div>
                <button
                  type="button"
                  data-testid="button-copy-referral"
                  onClick={async () => {
                    if (!referral?.link) return;
                    try {
                      await navigator.clipboard.writeText(referral.link);
                      setCopiedRef(true);
                      toast({ title: "Ссылка скопирована" });
                      window.setTimeout(() => setCopiedRef(false), 2000);
                    } catch {
                      toast({ title: "Не удалось скопировать", variant: "destructive" });
                    }
                  }}
                  style={{
                    padding: "0 1rem", borderRadius: 12, border: "none",
                    background: "#34C759", color: "#fff",
                    fontWeight: 700, fontSize: "0.85rem", cursor: "pointer",
                    display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap",
                  }}
                >
                  {copiedRef ? <Check size={15} /> : <Copy size={15} />}
                  {copiedRef ? "Готово" : "Копировать"}
                </button>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: "0.85rem" }}>
                {[
                  { label: "Друзей", value: referral?.referredCount ?? 0 },
                  { label: "С оплатой", value: referral?.paidReferredCount ?? 0 },
                  { label: "К обмену", value: referral?.availableBalance ?? 0 },
                ].map((s) => (
                  <div key={s.label} style={{ background: "rgba(0,0,0,0.025)", borderRadius: 12, padding: "0.65rem 0.5rem", textAlign: "center" }}>
                    <div style={{ fontSize: "1.05rem", fontWeight: 700, color: "#1D1D1F" }}>{s.value}</div>
                    <div style={{ fontSize: "0.65rem", fontWeight: 600, color: "#AEAEB2", textTransform: "uppercase", letterSpacing: "0.06em" }}>{s.label}</div>
                  </div>
                ))}
              </div>

              {referral?.pendingExchange ? (
                <div style={{
                  marginBottom: referral?.recent?.length ? "0.85rem" : 0,
                  padding: "0.75rem 0.9rem", borderRadius: 12,
                  background: "rgba(255,149,0,0.08)", border: "1px solid rgba(255,149,0,0.2)",
                  fontSize: "0.8rem", color: "#1D1D1F", fontWeight: 600,
                }}>
                  Заявка на обмен {referral.pendingExchange.tokens} токенов на рассмотрении
                </div>
              ) : (referral?.availableBalance ?? 0) > 0 ? (
                <button
                  type="button"
                  data-testid="button-referral-exchange"
                  disabled={exchangeMutation.isPending}
                  onClick={() => exchangeMutation.mutate()}
                  style={{
                    width: "100%", marginBottom: referral?.recent?.length ? "0.85rem" : 0,
                    padding: "0.75rem 1rem", borderRadius: 12, border: "none",
                    background: "#007AFF", color: "#fff",
                    fontWeight: 700, fontSize: "0.88rem", cursor: exchangeMutation.isPending ? "default" : "pointer",
                    opacity: exchangeMutation.isPending ? 0.7 : 1,
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                  }}
                >
                  {exchangeMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : null}
                  Обменять {referral?.availableBalance} токенов
                </button>
              ) : null}

              {(referral?.totalTokensEarned ?? 0) > 0 && (
                <div style={{ fontSize: "0.72rem", color: "#AEAEB2", marginBottom: referral?.recent?.length ? "0.85rem" : 0 }}>
                  Всего заработано: {referral?.totalTokensEarned} токенов
                </div>
              )}

              {!!referral?.recent?.length && (
                <div style={{ borderTop: "1px solid rgba(0,0,0,0.06)", paddingTop: "0.75rem" }}>
                  <div style={{ fontSize: "0.68rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "#AEAEB2", marginBottom: 8 }}>
                    Последние начисления
                  </div>
                  {referral.recent.slice(0, 5).map((r) => (
                    <div key={r.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "0.35rem 0", fontSize: "0.8rem" }}>
                      <span style={{ color: "#1D1D1F", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {r.referredDisplayName}
                      </span>
                      <span style={{ color: "#34C759", fontWeight: 700, flexShrink: 0 }}>+{r.tokensAwarded}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {/* Promo code redeem */}
        <div style={{ background: "#fff", borderRadius: 20, border: "1px solid rgba(0,0,0,0.06)", boxShadow: "0 2px 12px rgba(0,0,0,0.04)", overflow: "hidden", marginBottom: "1.25rem", padding: "1.1rem 1.25rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "0.85rem" }}>
            <div style={{ width: 34, height: 34, borderRadius: 10, background: "rgba(88,86,214,0.1)", display: "flex", alignItems: "center", justifyContent: "center", color: "#5856D6" }}>
              <Gift size={16} />
            </div>
            <div>
              <div style={{ fontSize: "0.92rem", fontWeight: 700, color: "#1D1D1F" }}>Промокод</div>
              <div style={{ fontSize: "0.72rem", color: "#AEAEB2", marginTop: 2 }}>Один промокод — одна активация на аккаунт</div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "stretch" }}>
            <input
              value={promoCode}
              onChange={(e) => setPromoCode(e.target.value.toUpperCase())}
              onKeyDown={(e) => {
                if (e.key === "Enter" && canRedeem) redeemMutation.mutate();
              }}
              placeholder="Введите промокод"
              maxLength={64}
              data-testid="input-promo-code"
              style={{
                flex: 1, padding: "0.7rem 0.9rem", borderRadius: 12, border: "1px solid rgba(0,0,0,0.1)",
                fontSize: "0.9rem", fontWeight: 600, letterSpacing: "0.04em", outline: "none",
                background: "rgba(0,0,0,0.02)", color: "#1D1D1F", fontFamily: appleFont,
              }}
            />
            <button
              type="button"
              data-testid="button-redeem-promo"
              onClick={() => redeemMutation.mutate()}
              disabled={!canRedeem}
              style={{
                padding: "0 1.1rem", borderRadius: 12, border: "none",
                background: canRedeem ? "#5856D6" : "rgba(0,0,0,0.08)",
                color: canRedeem ? "#fff" : "#AEAEB2",
                fontWeight: 700, fontSize: "0.85rem", cursor: canRedeem ? "pointer" : "default",
                display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap",
              }}
            >
              {redeemMutation.isPending ? <Loader2 size={15} className="animate-spin" /> : null}
              Активировать
            </button>
          </div>
        </div>

        {/* Actions: Support → Logout */}
        <div style={{ background: "#fff", borderRadius: 20, border: "1px solid rgba(0,0,0,0.06)", boxShadow: "0 2px 12px rgba(0,0,0,0.04)", overflow: "hidden", marginBottom: "1.25rem" }}>
          {navItems.map((item, i) => (
            <button
              key={i}
              onClick={item.onClick}
              style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                gap: "0.875rem",
                padding: "0.9rem 1.25rem",
                borderBottom: i < navItems.length - 1 ? "1px solid rgba(0,0,0,0.05)" : "none",
                background: "transparent",
                border: "none",
                cursor: "pointer",
                textAlign: "left",
              }}
              onMouseEnter={e => (e.currentTarget.style.background = item.danger ? "rgba(255,59,48,0.04)" : "rgba(0,0,0,0.015)")}
              onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
            >
              <div style={{ width: 34, height: 34, borderRadius: 10, background: `${item.color}14`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, color: item.color }}>
                {item.icon}
              </div>
              <span style={{ fontSize: "0.92rem", fontWeight: 600, color: item.danger ? "#FF3B30" : "#1D1D1F", fontFamily: appleFont }}>{item.label}</span>
              {!item.danger && <span style={{ marginLeft: "auto", color: "#AEAEB2", fontSize: "1rem" }}>›</span>}
            </button>
          ))}
        </div>

        {/* Transparent token spend history */}
        <div style={{ background: "#fff", borderRadius: 20, border: "1px solid rgba(0,0,0,0.06)", boxShadow: "0 2px 12px rgba(0,0,0,0.04)", overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", padding: "0.95rem 1.25rem", borderBottom: "1px solid rgba(0,0,0,0.05)" }}>
            <div style={{ width: 34, height: 34, borderRadius: 10, background: "rgba(0,122,255,0.08)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <History size={16} color="#007AFF" />
            </div>
            <div>
              <div style={{ fontSize: "0.92rem", fontWeight: 700, color: "#1D1D1F" }}>Расход токенов</div>
              <div style={{ fontSize: "0.72rem", color: "#AEAEB2", marginTop: 2 }}>
                Прозрачная история списаний и возвратов
                {historyTotal > 0 ? ` · ${historyTotal}` : ""}
                {historyTotalPages > 1 ? ` · стр. ${currentHistoryPage}/${historyTotalPages}` : ""}
              </div>
            </div>
          </div>
          {historyLoading && !historyData ? (
            <div style={{ padding: "1.25rem", fontSize: "0.85rem", color: "#AEAEB2" }}>Загрузка операций…</div>
          ) : historyError ? (
            <div style={{ padding: "1.25rem", fontSize: "0.85rem", color: "#FF3B30" }}>Не удалось загрузить историю. Обновите страницу.</div>
          ) : historyTotal === 0 ? (
            <div style={{ padding: "1.25rem", fontSize: "0.85rem", color: "#AEAEB2" }}>Пока нет операций</div>
          ) : (
            <>
              <div style={{ opacity: historyFetching ? 0.7 : 1 }}>
                {history.map((t, i) => {
                  const isCredit = t.type === "credit";
                  const when = new Date(t.createdAt).toLocaleString("ru-RU", {
                    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
                  });
                  return (
                    <div
                      key={t.id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "0.75rem",
                        padding: "0.75rem 1.25rem",
                        borderBottom: i < history.length - 1 || historyTotalPages > 1 ? "1px solid rgba(0,0,0,0.04)" : "none",
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: "0.86rem", fontWeight: 600, color: "#1D1D1F" }}>{t.label}</div>
                        <div style={{ fontSize: "0.7rem", color: "#AEAEB2", marginTop: 2 }}>{when}</div>
                      </div>
                      <div style={{ fontSize: "0.9rem", fontWeight: 700, color: isCredit ? "#34C759" : "#1D1D1F", fontVariantNumeric: "tabular-nums" }}>
                        {isCredit ? "+" : "−"}{t.amount}
                      </div>
                    </div>
                  );
                })}
              </div>
              {historyTotalPages > 1 && (
                <div style={{ padding: "0.85rem 1.25rem", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                  <div style={{ fontSize: "0.72rem", color: "#AEAEB2" }}>
                    {(currentHistoryPage - 1) * HISTORY_PAGE_SIZE + 1}–{Math.min(currentHistoryPage * HISTORY_PAGE_SIZE, historyTotal)} из {historyTotal}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <button
                      data-testid="button-credits-prev"
                      onClick={() => setHistoryPage((p) => Math.max(1, p - 1))}
                      disabled={currentHistoryPage <= 1}
                      style={{
                        width: 32, height: 32, borderRadius: 8, border: "1px solid #E0E0E5", background: "#fff",
                        cursor: currentHistoryPage <= 1 ? "default" : "pointer", opacity: currentHistoryPage <= 1 ? 0.4 : 1,
                        display: "flex", alignItems: "center", justifyContent: "center", color: "#1D1D1F",
                      }}
                      aria-label="Предыдущая страница"
                    >
                      <ChevronLeft size={15} />
                    </button>
                    <span style={{ minWidth: 56, textAlign: "center", fontSize: "0.8rem", fontWeight: 600, color: "#1D1D1F" }}>
                      {currentHistoryPage} / {historyTotalPages}
                    </span>
                    <button
                      data-testid="button-credits-next"
                      onClick={() => setHistoryPage((p) => Math.min(historyTotalPages, p + 1))}
                      disabled={currentHistoryPage >= historyTotalPages}
                      style={{
                        width: 32, height: 32, borderRadius: 8, border: "1px solid #E0E0E5", background: "#fff",
                        cursor: currentHistoryPage >= historyTotalPages ? "default" : "pointer", opacity: currentHistoryPage >= historyTotalPages ? 0.4 : 1,
                        display: "flex", alignItems: "center", justifyContent: "center", color: "#1D1D1F",
                      }}
                      aria-label="Следующая страница"
                    >
                      <ChevronRight size={15} />
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
}
