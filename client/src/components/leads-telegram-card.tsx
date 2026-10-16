import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Send, Users, Trash2, ChevronDown, Loader2, CheckCircle2 } from "lucide-react";

const appleFont = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Helvetica Neue", Arial, sans-serif';
const TG_BLUE = "#229ED9";

type Settings = {
  enabled: boolean;
  targets: Array<{ id: number; chatTitle: string; chatType: string; createdAt: string }>;
  projects: Array<{ id: number; title: string; leadNotify: boolean }>;
};
type Link = { code: string; privateUrl: string; groupUrl: string };

const btn = (bg: string, color: string): React.CSSProperties => ({
  display: "inline-flex", alignItems: "center", gap: "0.45rem",
  padding: "0.55rem 1rem", borderRadius: 12, border: "none", cursor: "pointer",
  fontFamily: appleFont, fontSize: "0.85rem", fontWeight: 600, background: bg, color,
});

export function LeadsTelegramCard() {
  const { toast } = useToast();
  const [link, setLink] = useState<Link | null>(null);
  const [showSites, setShowSites] = useState(false);

  const { data, isLoading } = useQuery<Settings>({ queryKey: ["/api/leads/telegram"] });

  // Poll the one-time code until the bot confirms the chat (or it expires).
  const { data: linkStatus } = useQuery<{ status: string; chat?: { title: string } }>({
    queryKey: ["/api/leads/telegram/link", link?.code],
    queryFn: () => apiRequest("GET", `/api/leads/telegram/link/${link!.code}`).then((r) => r.json()),
    enabled: !!link,
    refetchInterval: 2000,
  });
  useEffect(() => {
    if (!link || !linkStatus) return;
    if (linkStatus.status === "done") {
      toast({ title: "Telegram подключён", description: linkStatus.chat?.title ? `Заявки будут приходить в «${linkStatus.chat.title}»` : undefined });
      setLink(null);
      queryClient.invalidateQueries({ queryKey: ["/api/leads/telegram"] });
    } else if (linkStatus.status === "expired") {
      toast({ title: "Ссылка устарела", description: "Нажмите «Подключить» ещё раз", variant: "destructive" });
      setLink(null);
    }
  }, [link, linkStatus, toast]);

  const linkMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/leads/telegram/link").then((r) => r.json() as Promise<Link>),
    onError: (e: any) => toast({ title: "Ошибка", description: e.message, variant: "destructive" }),
  });
  const start = async (kind: "private" | "group") => {
    // Open the tab synchronously: browsers block window.open after an await.
    const tab = window.open("about:blank", "_blank");
    try {
      const l = await linkMutation.mutateAsync();
      setLink(l);
      const url = kind === "group" ? l.groupUrl : l.privateUrl;
      if (tab) tab.location.href = url;
      else window.location.href = url;
    } catch {
      tab?.close();
    }
  };

  const removeMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/leads/telegram/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/leads/telegram"] }),
    onError: (e: any) => toast({ title: "Ошибка", description: e.message, variant: "destructive" }),
  });
  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: number; enabled: boolean }) =>
      apiRequest("PATCH", `/api/projects/${id}/lead-notify`, { enabled }),
    onMutate: async ({ id, enabled }) => {
      queryClient.setQueryData<Settings>(["/api/leads/telegram"], (old) =>
        old ? { ...old, projects: old.projects.map((p) => (p.id === id ? { ...p, leadNotify: enabled } : p)) } : old,
      );
    },
    onError: (e: any) => {
      toast({ title: "Не удалось сохранить", description: e.message, variant: "destructive" });
      queryClient.invalidateQueries({ queryKey: ["/api/leads/telegram"] });
    },
  });

  if (isLoading || !data || !data.enabled) return null;
  const connected = data.targets.length > 0;
  const hasPrivate = data.targets.some((t) => t.chatType === "private");
  const offCount = data.projects.filter((p) => !p.leadNotify).length;

  return (
    <section
      data-testid="card-leads-telegram"
      style={{ background: "#fff", border: "1px solid rgba(0,0,0,0.07)", borderRadius: 18, padding: "1.25rem 1.4rem", marginBottom: "1.75rem" }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: "0.9rem", flexWrap: "wrap" }}>
        <div style={{ width: 40, height: 40, borderRadius: 12, background: TG_BLUE, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <Send size={18} color="#fff" aria-hidden />
        </div>
        <div style={{ flex: 1, minWidth: 220 }}>
          <h2 style={{ margin: 0, fontSize: "1rem", fontWeight: 700, color: "#1D1D1F" }}>Заявки в Telegram</h2>
          <p style={{ margin: "0.2rem 0 0", fontSize: "0.82rem", color: "#86868B", lineHeight: 1.5 }}>
            {connected
              ? "Каждая новая заявка с ваших сайтов сразу приходит в подключённые чаты."
              : "Получайте заявки мгновенно — себе в личку или в общий чат команды."}
          </p>
        </div>
      </div>

      {connected && (
        <ul style={{ listStyle: "none", margin: "1rem 0 0", padding: 0, display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          {data.targets.map((t) => (
            <li key={t.id} style={{ display: "flex", alignItems: "center", gap: "0.6rem", padding: "0.6rem 0.8rem", borderRadius: 12, background: "rgba(0,0,0,0.03)" }}>
              <CheckCircle2 size={16} color="#34C759" aria-hidden />
              <span style={{ flex: 1, fontSize: "0.88rem", fontWeight: 600, color: "#1D1D1F", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {t.chatTitle}
                <span style={{ fontWeight: 400, color: "#86868B" }}> · {t.chatType === "private" ? "личные сообщения" : "группа"}</span>
              </span>
              <button
                onClick={() => removeMutation.mutate(t.id)}
                disabled={removeMutation.isPending}
                aria-label={`Отключить ${t.chatTitle}`}
                data-testid={`button-tg-remove-${t.id}`}
                style={{ ...btn("transparent", "#FF3B30"), padding: "0.3rem 0.5rem" }}
              >
                <Trash2 size={15} aria-hidden /> Отключить
              </button>
            </li>
          ))}
        </ul>
      )}

      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginTop: "1rem" }}>
        {/* A personal chat is linked once; after that only a team group can be added. */}
        {!hasPrivate && (
          <button onClick={() => start("private")} disabled={linkMutation.isPending} data-testid="button-tg-connect" style={btn(TG_BLUE, "#fff")}>
            {linkMutation.isPending ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Send size={15} aria-hidden />}
            Подключить Telegram
          </button>
        )}
        <button onClick={() => start("group")} disabled={linkMutation.isPending} data-testid="button-tg-connect-group" style={btn("rgba(34,158,217,0.1)", TG_BLUE)}>
          <Users size={15} aria-hidden /> В группу команды
        </button>
      </div>

      {link && (
        <p role="status" style={{ margin: "0.8rem 0 0", fontSize: "0.82rem", color: "#86868B", display: "flex", alignItems: "center", gap: "0.4rem" }}>
          <Loader2 size={14} className="animate-spin" aria-hidden />
          Нажмите «Start» в Telegram (или выберите группу) — подключение подтвердится автоматически.{" "}
          <a href={link.privateUrl} target="_blank" rel="noreferrer" style={{ color: TG_BLUE }}>Открыть бота</a>
        </p>
      )}

      {connected && data.projects.length > 0 && (
        <div style={{ marginTop: "1rem", borderTop: "1px solid rgba(0,0,0,0.06)", paddingTop: "0.8rem" }}>
          <button
            onClick={() => setShowSites(!showSites)}
            aria-expanded={showSites}
            data-testid="button-tg-sites"
            style={{ ...btn("transparent", "#1D1D1F"), padding: 0, fontWeight: 500 }}
          >
            <ChevronDown size={15} aria-hidden style={{ transform: showSites ? "rotate(180deg)" : "none", transition: "transform 0.2s" }} />
            Сайты: {data.projects.length - offCount} из {data.projects.length} присылают заявки
          </button>
          {showSites && (
            <ul style={{ listStyle: "none", margin: "0.6rem 0 0", padding: 0, display: "flex", flexDirection: "column", gap: "0.25rem" }}>
              {data.projects.map((p) => (
                <li key={p.id}>
                  <label style={{ display: "flex", alignItems: "center", gap: "0.6rem", padding: "0.35rem 0", fontSize: "0.86rem", color: "#1D1D1F", cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={p.leadNotify}
                      onChange={(e) => toggleMutation.mutate({ id: p.id, enabled: e.target.checked })}
                      data-testid={`toggle-tg-project-${p.id}`}
                      style={{ width: 16, height: 16, accentColor: TG_BLUE }}
                    />
                    {p.title || `Проект #${p.id}`}
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
