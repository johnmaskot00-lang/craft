import { useState, useEffect, useRef, type ChangeEvent, type MouseEvent } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { SeoConfig, SeoKeyword } from "@shared/schema";
import {
  ChevronRight, ChevronDown, ChevronLeft, Globe, Zap, RefreshCw,
  CheckCircle2, XCircle, Clock, Loader2, ArrowLeft,
  BarChart2, FileText, Layers, PlusCircle, X,
  MessageSquare, Send, ExternalLink, Download, Copy,
  Sparkles, Paperclip, Trash2, Square,
} from "lucide-react";
import { DnsInstructions } from "@/components/dns-instructions";

const SkeuoPanel = ({ children, className = "" }: { children: React.ReactNode; className?: string }) => (
  <div className={`bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 shadow-sm rounded-2xl overflow-hidden flex flex-col ${className}`}>
    {children}
  </div>
);

function agentChatText(content: string): string {
  const t = String(content || "").trim();
  if (!t) return "";
  if (t.startsWith("<!") || t.startsWith("<html") || t.startsWith("<div") || /<(body|nav|footer|article)[\s>]/i.test(t)) {
    return "Сайт обновлён";
  }
  return content;
}

type Phase = "setup" | "structure" | "generating" | "done";

function seoHtmlToPath(filename: string): string | null {
  const name = String(filename || "").replace(/^\/+/, "");
  if (!name.endsWith(".html") || name.startsWith("assets/")) return null;
  if (name === "index.html") return "/";
  if (name.endsWith("/index.html")) return `/${name.slice(0, -"index.html".length)}`;
  return `/${name.replace(/\.html$/, "")}/`;
}

function buildSeoPageUrls(
  domain: string,
  files: { filename: string }[],
  cfg: SeoConfig | null,
): string[] {
  const host = String(domain || "")
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "")
    .replace(/^www\./i, "")
    .trim()
    .toLowerCase();
  if (!host) return [];
  const origin = `https://${host}`;
  const urls = new Set<string>();
  urls.add(`${origin}/`);
  for (const f of files) {
    const path = seoHtmlToPath(f.filename);
    if (path) urls.add(`${origin}${path}`);
  }
  for (const cluster of cfg?.clusters || []) {
    if (!cluster.slug) continue;
    urls.add(`${origin}/${cluster.slug}/`);
    for (const kw of cluster.keywords || []) {
      if (!kw.slug) continue;
      if (kw.status === "done" || kw.filename) {
        urls.add(`${origin}/${cluster.slug}/${kw.slug}/`);
      }
    }
  }
  return [...urls].sort((a, b) => {
    const pa = a.slice(origin.length);
    const pb = b.slice(origin.length);
    const da = pa.split("/").filter(Boolean).length;
    const db = pb.split("/").filter(Boolean).length;
    if (da !== db) return da - db;
    return pa.localeCompare(pb, "en");
  });
}

/* ─── tiny helpers ─── */
function StatusIcon({ status }: { status: SeoKeyword["status"] | "pending" }) {
  if (status === "done")      return <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />;
  if (status === "failed")    return <XCircle      className="w-3 h-3 text-red-400   shrink-0" />;
  if (status === "generating") return <Loader2     className="w-3 h-3 text-indigo-400 shrink-0 animate-spin" />;
  return                              <Clock       className="w-3 h-3 text-zinc-600   shrink-0" />;
}

function Stat({ value, label, color }: { value: number; label: string; color: string }) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span className="text-2xl font-black tabular-nums" style={{ color }}>{value}</span>
      <span className="text-[10px] uppercase tracking-widest text-slate-400 font-semibold">{label}</span>
    </div>
  );
}

/* ─── main component ─── */
export default function SeoEditorPage() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [phase, setPhase]           = useState<Phase>("setup");
  const [projectName, setProjectName] = useState("");
  const [keywordsText, setKeywordsText] = useState("");
  const [niche, setNiche]           = useState("");
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [openClusters, setOpenClusters] = useState<Set<string>>(new Set());
  const [genLog, setGenLog]         = useState<string[]>([]);
  const [genProgress, setGenProgress] = useState({ done: 0, total: 0 });
  const [isGenerating, setIsGenerating] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [removingPageId, setRemovingPageId] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing]   = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [analyzeElapsed, setAnalyzeElapsed] = useState(0);
  const analyzeTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const genAutoResumeRef = useRef(0);
  const genActiveRef = useRef(false);
  const userStoppedRef = useRef(false);

  const [targetUrl, setTargetUrl]     = useState("");
  const [ctaLabel, setCtaLabel]       = useState("Попробовать →");

  const [addKwOpen, setAddKwOpen]     = useState(false);
  const [addKwText, setAddKwText]     = useState("");
  const [addKwNiche, setAddKwNiche]   = useState("");
  const [addKwTargetUrl, setAddKwTargetUrl] = useState("");
  const [addKwCtaLabel, setAddKwCtaLabel] = useState("");
  const [isAddingKw, setIsAddingKw]   = useState(false);
  const [linksOpen, setLinksOpen] = useState(false);
  const [linksCopied, setLinksCopied] = useState(false);
  const [faviconUploading, setFaviconUploading] = useState(false);
  const [faviconCropOpen, setFaviconCropOpen] = useState(false);
  const [faviconRawSrc, setFaviconRawSrc] = useState("");
  const [cropBox, setCropBox] = useState({ x: 0, y: 0, size: 100 });
  const [cropDrag, setCropDrag] = useState<{ mode: "move" | "resize"; startX: number; startY: number; origBox: { x: number; y: number; size: number } } | null>(null);
  const faviconInputRef = useRef<HTMLInputElement>(null);
  const cropImgRef = useRef<HTMLImageElement>(null);
  const cropContainerRef = useRef<HTMLDivElement>(null);

  const [leftTab, setLeftTab] = useState<"pages" | "agent">("agent");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [chatInput, setChatInput] = useState("");
  const [isChatting, setIsChatting] = useState(false);
  const [chatStatus, setChatStatus] = useState("");
  const [pendingUserMsg, setPendingUserMsg] = useState<string | null>(null);
  const [attachedImageUrls, setAttachedImageUrls] = useState<{ url: string; preview: string }[]>([]);
  const chatFileRef = useRef<HTMLInputElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const [showPublishModal, setShowPublishModal] = useState(false);
  const [publishResult, setPublishResult] = useState<string | null>(null);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [customDomain, setCustomDomain] = useState("");
  const [domainAdding, setDomainAdding] = useState(false);
  const [domainResult, setDomainResult] = useState<{ added: boolean } | null>(null);
  const [domainError, setDomainError] = useState<string | null>(null);
  const [domainVerified, setDomainVerified] = useState<boolean | null>(null);
  const [domainDnsReady, setDomainDnsReady] = useState(false);
  const [domainStatusMessage, setDomainStatusMessage] = useState("");
  const [domainChecking, setDomainChecking] = useState(false);
  const [domainIp, setDomainIp] = useState("");

  /* ── single query, no polling — SSE provides live updates ── */
  const { data, isLoading, refetch } = useQuery<{
    project: any;
    files: { id: number; filename: string }[];
  }>({
    queryKey: ["/api/seo", id],
    queryFn: () => fetch(`/api/seo/${id}`, { credentials: "include" }).then(r => r.json()),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  const project = data?.project;
  const files   = data?.files || [];
  const cfg: SeoConfig | null = project?.seoConfig || null;

  const { data: chatMessagesRaw } = useQuery<{ id: number; role: string; content: string }[]>({
    queryKey: ["/api/projects", id, "messages"],
    queryFn: async () => {
      const r = await fetch(`/api/projects/${id}/messages`, { credentials: "include" });
      const d = await r.json();
      return Array.isArray(d) ? d : [];
    },
    enabled: !!id && (cfg?.status === "done" || (cfg?.pagesGenerated ?? 0) > 0),
    staleTime: 10_000,
  });
  const chatMessages = Array.isArray(chatMessagesRaw) ? chatMessagesRaw : [];

  useEffect(() => {
    if (!cfg) return;
    if (cfg.status === "done" || cfg.pagesGenerated > 0) setPhase("done");
    else if (cfg.clusters?.length > 0) setPhase("structure");
    else setPhase("setup");
    setProjectName(cfg.projectName || cfg.siteTitle || project?.title || "");
    if (cfg.niche) setNiche(cfg.niche);
    if (cfg.rawKeywords?.length) setKeywordsText(cfg.rawKeywords.join("\n"));
    if (cfg.targetUrl) setTargetUrl(cfg.targetUrl);
    if (cfg.ctaLabel) setCtaLabel(cfg.ctaLabel);
    if (cfg.clusters?.length > 0) setOpenClusters(new Set(cfg.clusters.slice(0, 2).map((c: any) => c.id)));
    setGenProgress({ done: cfg.pagesGenerated || 0, total: cfg.pagesTotal || 0 });
  }, [cfg?.status, cfg?.pagesGenerated, cfg?.clusters?.length]);

  // Auto-load homepage preview when project is done
  useEffect(() => {
    const hasHome = files.some(f => f.filename === "index.html");
    const selectedIsHtml = !!selectedFile?.toLowerCase().endsWith(".html");
    if (phase === "done" && hasHome && (!previewHtml || !selectedIsHtml)) {
      loadPreview("index.html");
    }
  }, [phase, files.length, selectedFile, previewHtml]);

  /* ── analyze ── */
  async function handleAnalyze() {
    const name = projectName.trim();
    if (!name) { toast({ title: "Введите название проекта", variant: "destructive" }); return; }
    const keywords = keywordsText.split(/[\n,]+/).map(k => k.trim()).filter(Boolean);
    if (!keywords.length) { toast({ title: "Введите ключевые слова", variant: "destructive" }); return; }
    if (keywords.length > 1000) { toast({ title: "Максимум 1000 ключей", variant: "destructive" }); return; }
    setIsAnalyzing(true);
    setAnalyzeElapsed(0);
    analyzeTimerRef.current = setInterval(() => setAnalyzeElapsed(s => s + 1), 1000);
    try {
      const res = await fetch(`/api/seo/${id}/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ keywords, niche, projectName: name, targetUrl: targetUrl.trim(), ctaLabel: ctaLabel.trim() }),
      });
      const raw = await res.text();
      let d: any = {};
      try { d = raw ? JSON.parse(raw) : {}; } catch { d = {}; }
      if (!res.ok) {
        const hint = res.status === 502 || res.status === 504
          ? "Сервер не успел обработать большой список. Нажмите «Построить структуру» ещё раз."
          : (d.message || `Ошибка ${res.status}`);
        throw new Error(hint);
      }
      await refetch();
      setPhase("structure");
      toast({ title: "Структура построена ✓", description: keywords.length > 80 ? `${keywords.length} ключей разложены по разделам` : undefined });
    } catch (e: any) {
      toast({ title: "Ошибка анализа", description: e.message, variant: "destructive" });
    } finally {
      setIsAnalyzing(false);
      if (analyzeTimerRef.current) clearInterval(analyzeTimerRef.current);
    }
  }

  /* ── generate (SSE) — auto-resumes until all articles are done ── */
  function startGeneration(opts?: { auto?: boolean }) {
    if (genActiveRef.current) return;
    if (userStoppedRef.current && opts?.auto) return;
    if (isGenerating && !opts?.auto) return;
    genActiveRef.current = true;
    setIsGenerating(true);
    setPhase("generating");
    if (!opts?.auto) {
      setGenLog([]);
      genAutoResumeRef.current = 0;
      userStoppedRef.current = false;
      setIsStopping(false);
    }
    setGenProgress({ done: cfg?.pagesGenerated || 0, total: cfg?.pagesTotal || 0 });

    fetch(`/api/seo/${id}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({}),
    }).then(async res => {
      if (!res.ok || !res.body) throw new Error("Generation failed");
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      let sawDone = false;
      let partial = false;
      let lastGenerated = cfg?.pagesGenerated || 0;
      let lastTotal = cfg?.pagesTotal || 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() || "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const evt = JSON.parse(line.slice(6));
            if (evt.type === "start") {
              lastTotal = evt.total || lastTotal;
              setGenProgress(p => ({ ...p, total: evt.total }));
              if (evt.resumed) setGenLog(l => [...l.slice(-99), "↻ Подключение к текущей генерации…"]);
            }
            if (evt.type === "heartbeat") {
              if (typeof evt.generated === "number") {
                lastGenerated = evt.generated;
                lastTotal = evt.total || lastTotal;
                setGenProgress({ done: evt.generated, total: evt.total || lastTotal });
              }
            }
            if (evt.type === "progress") {
              setGenLog(l => [...l.slice(-99), `⏳ ${evt.keyword}`]);
              if (typeof evt.generated === "number") {
                lastGenerated = evt.generated;
                lastTotal = evt.total || lastTotal;
                setGenProgress({ done: evt.generated, total: evt.total || lastTotal });
              }
            }
            if (evt.type === "brand")     setGenLog(l => [...l.slice(-99), `${evt.status === "ready" ? "✅" : evt.status === "fallback" ? "↪" : "🎨"} ${evt.label}`]);
            if (evt.type === "page_done") {
              setGenLog(l => [...l.slice(-99), `${evt.status === "done" ? "✅" : "❌"} ${evt.keyword}`]);
              lastGenerated = evt.generated;
              lastTotal = evt.total || lastTotal;
              setGenProgress({ done: evt.generated, total: evt.total });
            }
            if (evt.type === "done") {
              sawDone = true;
              partial = !!evt.partial;
              lastGenerated = evt.generated ?? lastGenerated;
              lastTotal = evt.total || lastTotal;
              setGenProgress({ done: lastGenerated, total: lastTotal });
              if (evt.stopped) {
                userStoppedRef.current = true;
                setIsStopping(false);
                setLeftTab("pages");
                setGenLog((l) => [...l.slice(-99), "⏹ Генерация остановлена"]);
                toast({ title: "Генерация остановлена", description: "Уже готовые статьи сохранены. Можно удалить лишние страницы и нажать «Продолжить»." });
              }
              await refetch();
              if (!partial) {
                setPhase("done");
                await loadPreview("index.html");
              }
              if (partial && !evt.stopped && !userStoppedRef.current) toast({ title: "Токены закончились", description: "Пополните баланс и нажмите «Продолжить»", variant: "destructive" });
            }
            if (evt.type === "error") toast({ title: evt.message, variant: "destructive" });
          } catch {}
        }
      }

      const result = await refetch();
      const latest =
        result.data?.project?.seoConfig ||
        (await fetch(`/api/seo/${id}`, { credentials: "include" })
          .then((r) => r.json())
          .then((d) => d.project?.seoConfig)
          .catch(() => null));
      const pagesGenerated = latest?.pagesGenerated ?? lastGenerated;
      const pagesTotal = latest?.pagesTotal ?? lastTotal;
      const status = latest?.status;
      const incomplete = pagesTotal > 0 && pagesGenerated < pagesTotal;
      const stillRunning = status === "generating";
      if (!userStoppedRef.current && !partial && (incomplete || stillRunning || !sawDone) && genAutoResumeRef.current < 40) {
        genAutoResumeRef.current += 1;
        setGenLog((l) => [...l.slice(-99), `↻ Автопродолжение ${genAutoResumeRef.current}… (${pagesGenerated}/${pagesTotal})`]);
        genActiveRef.current = false;
        setIsGenerating(false);
        window.setTimeout(() => startGeneration({ auto: true }), 1500);
        return;
      }
      genAutoResumeRef.current = 0;
      if (!incomplete) {
        setPhase("done");
        await loadPreview("index.html");
      }
    }).catch((e) => {
      if (e.name !== "AbortError") toast({ title: "Ошибка генерации", description: e.message, variant: "destructive" });
      if (!userStoppedRef.current && genAutoResumeRef.current < 40) {
        genAutoResumeRef.current += 1;
        genActiveRef.current = false;
        setIsGenerating(false);
        window.setTimeout(() => startGeneration({ auto: true }), 2000);
        return;
      }
    }).finally(() => {
      genActiveRef.current = false;
      setIsGenerating(false);
      setIsStopping(false);
      void refetch();
    });
  }

  async function stopGeneration() {
    if (!id || userStoppedRef.current) return;
    userStoppedRef.current = true;
    setIsStopping(true);
    setLeftTab("pages");
    setGenLog((l) => [...l.slice(-99), "⏹ Останавливаю — допишу текущие статьи и выйду…"]);
    try {
      const res = await fetch(`/api/seo/${id}/stop`, { method: "POST", credentials: "include" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.message || "Не удалось остановить");
    } catch (e: any) {
      userStoppedRef.current = false;
      setIsStopping(false);
      toast({ title: "Не удалось остановить", description: e?.message || "Попробуйте ещё раз", variant: "destructive" });
    }
  }

  async function removePage(kw: { id: string; title?: string; keyword: string; status?: string }) {
    if (!id || removingPageId) return;
    const ready = kw.status === "done";
    if (ready && !window.confirm(`Удалить статью «${kw.title || kw.keyword}»?`)) return;
    setRemovingPageId(kw.id);
    try {
      const res = await fetch(`/api/seo/${id}/remove-page`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keywordId: kw.id }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.message || "Не удалось удалить");
      if (d.seoConfig) {
        setGenProgress({ done: d.seoConfig.pagesGenerated || 0, total: d.seoConfig.pagesTotal || 0 });
      }
      await refetch();
      if (ready) toast({ title: "Статья удалена" });
    } catch (e: any) {
      toast({ title: "Не удалось удалить", description: e?.message || "Попробуйте ещё раз", variant: "destructive" });
    } finally {
      setRemovingPageId(null);
    }
  }

  async function redesignHome() {
    if (!id || isGenerating) return;
    setIsGenerating(true);
    setGenLog((l) => [...l.slice(-99), "🎨 Арт-директор: пересобираю уникальный дизайн…"]);
    try {
      const res = await fetch(`/api/seo/${id}/redesign-home`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.message || "Не удалось пересобрать дизайн");
      setGenLog((l) => [...l.slice(-99), "✅ Новый дизайн главной готов"]);
      toast({ title: "Дизайн обновлён", description: "Арт-директор собрал новую главную и стили." });
      await refetch();
      loadPreview("index.html");
    } catch (e: any) {
      toast({ title: "Ошибка дизайна", description: e?.message || "Попробуйте ещё раз", variant: "destructive" });
      setGenLog((l) => [...l.slice(-99), `❌ ${e?.message || "design failed"}`]);
    } finally {
      setIsGenerating(false);
    }
  }

  // If page reloads while server is still generating — reconnect automatically.
  useEffect(() => {
    if (!cfg || isGenerating || genActiveRef.current || userStoppedRef.current) return;
    if (cfg.status === "generating" && (cfg.pagesGenerated || 0) < (cfg.pagesTotal || 0)) {
      startGeneration({ auto: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg?.status, cfg?.pagesGenerated, cfg?.pagesTotal]);

  /* ── publish ── */
  async function handlePublish() {
    setIsPublishing(true);
    setPublishError(null);
    try {
      const res = await fetch(`/api/seo/${id}/publish`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.message);
      setPublishResult(d.url);
      toast({ title: "Сайт опубликован!", description: d.url });
      refetch();
    } catch (e: any) {
      setPublishError(e.message);
      toast({ title: "Ошибка публикации", description: e.message, variant: "destructive" });
    } finally {
      setIsPublishing(false);
    }
  }

  function openPublishModal() {
    setPublishResult(null);
    setPublishError(null);
    setDomainError(null);
    setDomainVerified(null);
    if (project?.customDomain) {
      setCustomDomain(project.customDomain);
      setDomainResult({ added: true });
      setTimeout(async () => {
        try {
          const res = await fetch(`/api/projects/${id}/domain/status?domain=${encodeURIComponent(project.customDomain)}`, { credentials: "include" });
          const data = await res.json();
          setDomainVerified(data.verified || false);
          setDomainDnsReady(data.dnsReady || false);
          setDomainStatusMessage(data.message || "");
          if (data.aRecordIp) setDomainIp(data.aRecordIp);
        } catch { setDomainVerified(false); }
      }, 80);
    } else {
      setCustomDomain("");
      setDomainResult(null);
    }
    setShowPublishModal(true);
    if (!project?.publishedUrl && !cfg?.publishUrl) {
      setTimeout(() => handlePublish(), 50);
    }
  }

  async function handleAddDomain() {
    if (!customDomain.trim()) return;
    setDomainAdding(true);
    setDomainError(null);
    try {
      const res = await fetch(`/api/projects/${id}/domain`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ domain: customDomain.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Ошибка привязки домена");
      setDomainResult({ added: true });
      setDomainVerified(data.verified || false);
      if (data.aRecordIp) setDomainIp(data.aRecordIp);
      await refetch();
      // Mirror files into the domain bucket and switch public URL to the custom domain.
      await handlePublish();
    } catch (e: any) {
      setDomainError(e.message);
    } finally {
      setDomainAdding(false);
    }
  }

  async function handleCheckDomain() {
    if (!customDomain.trim()) return;
    setDomainChecking(true);
    try {
      const res = await fetch(`/api/projects/${id}/domain/status?domain=${encodeURIComponent(customDomain.trim())}`, { credentials: "include" });
      const data = await res.json();
      setDomainVerified(data.verified || false);
      setDomainDnsReady(data.dnsReady || false);
      setDomainStatusMessage(data.message || "");
      if (data.aRecordIp) setDomainIp(data.aRecordIp);
    } catch {
      setDomainVerified(false);
      setDomainDnsReady(false);
      setDomainStatusMessage("");
    } finally {
      setDomainChecking(false);
    }
  }

  function handleChangeDomain() {
    setDomainResult(null);
    setCustomDomain("");
    setDomainVerified(null);
    setDomainDnsReady(false);
    setDomainStatusMessage("");
    setDomainError(null);
  }

  function handleCopyUrl(url: string) {
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const boundDomain = String(project?.customDomain || "").trim();
  const pageUrls = boundDomain ? buildSeoPageUrls(boundDomain, files, cfg) : [];
  const pageUrlsText = pageUrls.join("\n");

  function openLinksExport() {
    if (!boundDomain) {
      toast({
        title: "Сначала привяжите домен",
        description: "Список ссылок собирается по вашему домену — откройте «Опубликовать» и привяжите его.",
        variant: "destructive",
      });
      return;
    }
    if (pageUrls.length === 0) {
      toast({ title: "Страниц ещё нет", description: "Сгенерируйте сайт, затем выгрузите ссылки.", variant: "destructive" });
      return;
    }
    setLinksCopied(false);
    setLinksOpen(true);
  }

  async function copyAllPageUrls() {
    try {
      await navigator.clipboard.writeText(pageUrlsText);
      setLinksCopied(true);
      toast({ title: "Ссылки скопированы ✓", description: `${pageUrls.length} URL — вставьте в Вебмастер` });
      setTimeout(() => setLinksCopied(false), 2000);
    } catch {
      toast({ title: "Не удалось скопировать", variant: "destructive" });
    }
  }

  function downloadPageUrls() {
    const blob = new Blob([pageUrlsText + "\n"], { type: "text/plain;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${boundDomain.replace(/^www\./i, "").replace(/[^\w.-]+/g, "_")}-urls.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function handleAttachChatImage(file: File) {
    if (!file.type.startsWith("image/")) {
      toast({ title: "Можно прикрепить только изображение", variant: "destructive" });
      return;
    }
    const preview = URL.createObjectURL(file);
    const formData = new FormData();
    formData.append("file", file);
    try {
      const resp = await fetch("/api/upload-file", { method: "POST", credentials: "include", body: formData });
      const data = await resp.json();
      if (!resp.ok || !data.url) throw new Error(data.message || "Ошибка загрузки");
      setAttachedImageUrls(prev => [...prev, { url: data.url, preview }]);
    } catch (e: any) {
      toast({ title: "Не удалось загрузить фото", description: e.message, variant: "destructive" });
    }
  }

  async function handleChatSend() {
    const urls = attachedImageUrls.map(a => a.url);
    const text = chatInput.trim() || (urls.length ? "Добавь прикреплённые фото на текущую страницу." : "");
    if (!text || isChatting) return;
    setIsChatting(true);
    setChatStatus("Агент думает…");
    setPendingUserMsg(text);
    setChatInput("");
    setAttachedImageUrls([]);
    try {
      const res = await fetch(`/api/seo/${id}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ prompt: text, activeFile: selectedFile || "index.html", imageUrls: urls }),
      });
      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({ message: "Ошибка агента" }));
        throw new Error(err.message || "Ошибка агента");
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() || "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const evt = JSON.parse(line.slice(6));
            if (evt.status) setChatStatus(evt.status);
            if (evt.error) toast({ title: evt.error, variant: "destructive" });
            if (evt.done) {
              await qc.invalidateQueries({ queryKey: ["/api/projects", id, "messages"] });
              await refetch();
              if (selectedFile) await loadPreview(selectedFile);
              if (evt.creditsUsed) {
                toast({
                  title: `Списано ${evt.creditsUsed} ток.`,
                  description: publishUrl ? "Чтобы обновить опубликованный сайт — нажмите «Обновить сайт»." : "правка SEO-сайта",
                });
              }
            }
          } catch {}
        }
      }
    } catch (e: any) {
      toast({ title: "Ошибка агента", description: e.message, variant: "destructive" });
    } finally {
      setIsChatting(false);
      setChatStatus("");
      setPendingUserMsg(null);
    }
  }

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages, isChatting, chatStatus]);

  /* ── add keywords (optional niche + referral for this pack) ── */
  async function handleAddKeywords() {
    const keywords = addKwText.split(/[\n,]+/).map(k => k.trim()).filter(Boolean);
    if (!keywords.length) { toast({ title: "Введите ключевые слова", variant: "destructive" }); return; }
    const packUrl = addKwTargetUrl.trim();
    if (packUrl && !/^https?:\/\//i.test(packUrl)) {
      toast({ title: "Реф-ссылка должна начинаться с http:// или https://", variant: "destructive" });
      return;
    }
    setIsAddingKw(true);
    try {
      const res = await fetch(`/api/seo/${id}/add-keywords`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          keywords,
          niche: addKwNiche.trim() || undefined,
          targetUrl: packUrl || undefined,
          ctaLabel: addKwCtaLabel.trim() || undefined,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).message);
      const d = await res.json();
      setAddKwOpen(false);
      setAddKwText("");
      setAddKwNiche("");
      setAddKwTargetUrl("");
      setAddKwCtaLabel("");
      await refetch();
      setPhase("structure");
      const offerHint = d.offer?.niche || d.offer?.targetUrl
        ? ` Оффер: ${d.offer.niche || "ниша"} → ${d.offer.targetUrl || "ссылка сайта"}`
        : "";
      toast({
        title: `Добавлено ${d.added} ключей ✓`,
        description: `Нажмите «Генерировать» для создания новых статей.${offerHint}`,
      });
    } catch (e: any) {
      toast({ title: "Ошибка", description: e.message, variant: "destructive" });
    } finally {
      setIsAddingKw(false);
    }
  }

  const handleFaviconUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !id) return;
    const reader = new FileReader();
    reader.onload = () => {
      setFaviconRawSrc(reader.result as string);
      setCropBox({ x: 0, y: 0, size: 200 });
      setFaviconCropOpen(true);
    };
    reader.readAsDataURL(file);
    if (faviconInputRef.current) faviconInputRef.current.value = "";
  };

  const applyFaviconCrop = async () => {
    if (!id || !cropImgRef.current || !cropContainerRef.current) return;
    const img = cropImgRef.current;
    const containerRect = cropContainerRef.current.getBoundingClientRect();
    const scaleX = img.naturalWidth / containerRect.width;
    const scaleY = img.naturalHeight / containerRect.height;
    const savedCropBox = { ...cropBox };
    setFaviconCropOpen(false);
    setFaviconUploading(true);
    try {
      const sx = savedCropBox.x * scaleX;
      const sy = savedCropBox.y * scaleY;
      const sw = savedCropBox.size * scaleX;
      const sh = savedCropBox.size * scaleY;
      const canvas = document.createElement("canvas");
      canvas.width = 128;
      canvas.height = 128;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, 128, 128);
      const dataUrl = canvas.toDataURL("image/png", 0.9);
      const res = await fetch(`/api/projects/${id}/favicon`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ dataUrl, mimeType: "image/png" }),
      });
      if (!res.ok) throw new Error((await res.json()).message || "Ошибка загрузки фавикона");
      await refetch();
      if (selectedFile) await loadPreview(selectedFile);
      toast({ title: "Фавикон сохранён ✓", description: "Иконка добавлена на все страницы сайта" });
    } catch (err: any) {
      toast({ title: "Ошибка", description: err.message || "Не удалось сохранить фавикон", variant: "destructive" });
    }
    setFaviconUploading(false);
  };

  const onCropMouseDown = (e: MouseEvent, mode: "move" | "resize") => {
    e.preventDefault();
    setCropDrag({ mode, startX: e.clientX, startY: e.clientY, origBox: { ...cropBox } });
  };

  const onCropMouseMove = (e: MouseEvent) => {
    if (!cropDrag || !cropContainerRef.current) return;
    const containerRect = cropContainerRef.current.getBoundingClientRect();
    const dx = e.clientX - cropDrag.startX;
    const dy = e.clientY - cropDrag.startY;
    if (cropDrag.mode === "move") {
      const nx = Math.max(0, Math.min(containerRect.width - cropDrag.origBox.size, cropDrag.origBox.x + dx));
      const ny = Math.max(0, Math.min(containerRect.height - cropDrag.origBox.size, cropDrag.origBox.y + dy));
      setCropBox(b => ({ ...b, x: nx, y: ny }));
    } else {
      const maxSize = Math.min(
        containerRect.width - cropDrag.origBox.x,
        containerRect.height - cropDrag.origBox.y,
      );
      const newSize = Math.max(40, Math.min(maxSize, cropDrag.origBox.size + dx));
      setCropBox(b => ({ ...b, size: newSize }));
    }
  };

  /* ── preview ── */
  // Navigation interceptor script injected into every preview page
  const NAV_INTERCEPTOR = `<script>
(function(){
  function intercept(e){
    var el=e.target.closest('a[href]');
    if(!el)return;
    var href=el.getAttribute('href');
    if(!href||href.startsWith('#')||href.startsWith('http')||href.startsWith('mailto')||href.startsWith('tel'))return;
    e.preventDefault();
    e.stopPropagation();
    window.parent.postMessage({type:'seo-nav',href:href},'*');
  }
  document.addEventListener('click',intercept,true);
})();
</script>`;

  async function loadPreview(filename: string) {
    const safeFilename = filename.toLowerCase().endsWith(".html") ? filename : "index.html";
    setSelectedFile(safeFilename);
    try {
      const pageRes = await fetch(
        `/api/seo/${id}/preview-page?filename=${encodeURIComponent(safeFilename)}`,
        { credentials: "include" },
      );
      if (!pageRes.ok) return;
      let html = await pageRes.text();
      html = html.replace(/<\/body>/i, `${NAV_INTERCEPTOR}</body>`);
      if (!html.includes(NAV_INTERCEPTOR)) html += NAV_INTERCEPTOR;
      setPreviewHtml(html);
    } catch {}
  }

  // Handle navigation messages from preview iframe
  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (!e.data || e.data.type !== "seo-nav") return;
      const href: string = e.data.href;
      // Convert URL path → project filename
      // /slug/article/ → slug/article/index.html
      // /slug/ → slug/index.html
      // / → index.html
      let filename = href.replace(/^\//, "").replace(/\/$/, "");
      if (!filename) filename = "index.html";
      else if (!filename.endsWith(".html")) filename = filename + "/index.html";
      loadPreview(filename);
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [id]);

  function toggleCluster(cid: string) {
    setOpenClusters(prev => { const n = new Set(prev); n.has(cid) ? n.delete(cid) : n.add(cid); return n; });
  }

  const pct = genProgress.total > 0 ? Math.round((genProgress.done / genProgress.total) * 100) : 0;
  const keywordCount = keywordsText.split(/[\n,]+/).filter(k => k.trim()).length;
  const publishUrl = cfg?.publishUrl || project?.publishedUrl;
  const displayUrl = project?.customDomain
    ? project.customDomain.replace(/^www\./, "")
    : publishUrl?.replace(/^https?:\/\//, "").split("/")[0];

  /* ── loading screen ── */
  if (isLoading) return (
    <div className="h-[100dvh] flex items-center justify-center bg-[#F6F7FB]">
      <Loader2 className="w-10 h-10 animate-spin text-indigo-500" />
    </div>
  );

  const pillBtn = "flex items-center gap-2 h-9 sm:h-10 px-2.5 sm:px-4 rounded-full text-sm font-medium bg-white text-slate-600 border border-slate-200 shadow-sm hover:shadow-md hover:border-slate-300 transition-all duration-200";
  const iconBtn = "hidden sm:flex items-center justify-center w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-white text-slate-500 border border-slate-200 shadow-sm hover:shadow-md hover:text-slate-700 hover:border-slate-300 transition-all duration-200 disabled:opacity-40";
  const htmlFiles = files.filter(f => f.filename.toLowerCase().endsWith(".html"));
  const showAgent = phase === "done" && leftTab === "agent";
  const showPages = phase !== "done" || leftTab === "pages";

  /* ════════════════════════════════════════════════════════ */
  return (
    <div className="h-[100dvh] bg-[#F6F7FB] dark:bg-[#0F172A] flex flex-col p-1.5 sm:p-3 gap-1.5 sm:gap-3 overflow-hidden pb-[env(safe-area-inset-bottom)]">

      <header className="h-14 sm:h-16 flex items-center gap-1.5 sm:gap-3 bg-white dark:bg-slate-900 rounded-xl sm:rounded-2xl px-2 sm:px-5 border border-slate-100 dark:border-slate-800 shadow-sm shrink-0">
        <div className="flex items-center gap-1.5 sm:gap-3 shrink-0">
          <Button variant="ghost" size="icon" className="rounded-xl h-9 w-9 shrink-0 text-slate-400 hover:text-slate-700 hover:bg-slate-100" onClick={() => setLocation("/dashboard")} data-testid="button-back">
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div className="flex items-center gap-2 min-w-0">
            <svg viewBox="0 0 32 32" stroke="currentColor" strokeWidth="2" fill="none" className="w-7 h-7 sm:w-8 sm:h-8 shrink-0">
              <defs>
                <linearGradient id="seo-logo-grad" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%"><animate attributeName="stop-color" values="#FF4242;#A5FF42;#42A5FF;#42E6FF;#B742FF;#FF4242" dur="5s" repeatCount="indefinite"/></stop>
                  <stop offset="100%"><animate attributeName="stop-color" values="#B742FF;#FF4242;#A5FF42;#42A5FF;#42E6FF;#B742FF" dur="5s" repeatCount="indefinite"/></stop>
                </linearGradient>
              </defs>
              <rect x="4" y="4" width="24" height="18" rx="4" stroke="url(#seo-logo-grad)"/>
              <circle cx="10" cy="10" r="1.5" fill="url(#seo-logo-grad)" stroke="none"/>
              <circle cx="22" cy="10" r="1.5" fill="url(#seo-logo-grad)" stroke="none"/>
              <path d="M12 16l-2 2 2 2 M20 16l2 2-2 2" stroke="url(#seo-logo-grad)" strokeLinecap="round" strokeLinejoin="round"/>
              <line x1="15" y1="20" x2="17" y2="20" stroke="url(#seo-logo-grad)" strokeLinecap="round"/>
              <path d="M8 26 h16 M10 28 h12" stroke="url(#seo-logo-grad)" strokeLinecap="round"/>
            </svg>
            <div className="hidden md:flex flex-col min-w-0">
              <span style={{ fontWeight: 700, fontSize: "1.1rem", letterSpacing: "-0.03em", color: "#1D1D1F", lineHeight: 1 }}>Craft AI</span>
              <h1 className="text-xs font-bold tracking-tight text-slate-400 mt-0.5 truncate max-w-[220px]">SEO-машина{cfg?.niche ? ` · ${cfg.niche}` : ""}</h1>
            </div>
          </div>
        </div>

        <div className="flex-1 min-w-0 flex items-center gap-1 sm:gap-2 overflow-x-auto py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [&>*]:shrink-0">
          {phase !== "setup" && (
            <>
              <button onClick={() => setAddKwOpen(true)} title="Добавить новый пак ключей" className={pillBtn}>
                <PlusCircle className="w-4 h-4" /><span className="hidden lg:inline">Ключи</span>
              </button>
              <input
                ref={faviconInputRef}
                type="file"
                accept="image/png,image/jpeg,image/svg+xml,image/x-icon,image/webp"
                className="hidden"
                onChange={handleFaviconUpload}
                data-testid="input-favicon-upload"
              />
              <button
                onClick={() => faviconInputRef.current?.click()}
                disabled={faviconUploading}
                title="Фавикон"
                data-testid="button-favicon-upload"
                className={iconBtn}
              >
                {faviconUploading
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : cfg?.faviconDataUrl
                    ? <img src={cfg.faviconDataUrl} alt="" className="w-4 h-4 rounded object-cover" />
                    : <Globe className={`w-4 h-4 ${cfg?.faviconDataUrl ? "text-primary" : ""}`} />}
              </button>
              <button
                onClick={openLinksExport}
                title={boundDomain ? "Выгрузить ссылки для Вебмастера" : "Привяжите домен, чтобы выгрузить ссылки"}
                data-testid="button-export-page-urls"
                className={`${iconBtn} ${boundDomain ? "text-primary" : "opacity-60"}`}
              >
                <Download className="w-4 h-4" />
              </button>
            </>
          )}
        </div>

        {phase !== "setup" && (
          <button
            onClick={openPublishModal}
            disabled={isPublishing || files.length < 2}
            title={displayUrl || "Опубликовать"}
            className={`shrink-0 flex items-center gap-1.5 sm:gap-2 h-9 sm:h-10 px-3 sm:px-5 rounded-full text-sm font-semibold transition-all duration-200 ${
              isPublishing || files.length < 2
                ? "bg-slate-100 text-slate-400 cursor-not-allowed"
                : publishUrl
                  ? "bg-gradient-to-r from-emerald-500 to-green-500 text-white shadow-md shadow-emerald-200 hover:shadow-lg"
                  : "bg-gradient-to-r from-blue-500 to-indigo-500 text-white shadow-md shadow-blue-200 hover:shadow-lg hover:from-blue-600 hover:to-indigo-600"
            }`}
          >
            {isPublishing
              ? <><Loader2 className="w-4 h-4 animate-spin" /><span className="hidden sm:inline">Публикация...</span></>
              : publishUrl
                ? <><CheckCircle2 className="w-4 h-4" /><span className="hidden sm:inline max-w-[180px] truncate">{displayUrl || "Опубликован"}</span></>
                : <><ExternalLink className="w-4 h-4" /><span className="hidden sm:inline">Опубликовать</span></>}
          </button>
        )}
      </header>

      <div className="flex-1 flex gap-1.5 sm:gap-3 overflow-hidden relative min-h-0">
        <SkeuoPanel className={`transition-all duration-300 ease-in-out min-w-0 ${sidebarOpen ? "w-full sm:w-[440px] sm:min-w-[440px]" : "w-0 opacity-0 -translate-x-full pointer-events-none absolute sm:relative"}`}>
          <div className="px-4 sm:px-5 py-3 border-b border-slate-100 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                <Sparkles className="w-3.5 h-3.5 text-primary" />
              </div>
              <div className="min-w-0">
                <h2 className="text-sm font-semibold text-slate-800 truncate">{phase === "setup" ? "SEO-машина" : "AI Конструктор"}</h2>
                <p className="text-[11px] text-slate-400 truncate">{project?.title || projectName || "Новый SEO-сайт"}</p>
              </div>
            </div>
            <span className="text-[10px] font-medium text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full hidden sm:inline">Craft Agent</span>
          </div>

          {phase === "setup" && (
            <ScrollArea className="flex-1">
              <div className="px-5 py-4 space-y-3">
                <p className="text-xs text-slate-500 leading-relaxed">Вставьте ключевые слова — через запятую или каждое на новой строке. ИИ кластеризует их и построит структуру сайта.</p>
                <div>
                  <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block mb-1.5">Название проекта *</label>
                  <input data-testid="input-project-name" value={projectName} onChange={e => setProjectName(e.target.value)} placeholder="напр. НейроСтарт" maxLength={60} className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm text-slate-800 outline-none focus:border-indigo-400" />
                  <p className="text-[10px] text-slate-400 mt-1">Используется как название сайта в шапке, логотипе и подвале.</p>
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block mb-1.5">Ниша / ваш продукт</label>
                  <input data-testid="input-niche" value={niche} onChange={e => setNiche(e.target.value)} placeholder="напр. маркетплейс AI · Dremia" className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm text-slate-800 outline-none focus:border-indigo-400" />
                  <p className="text-[10px] text-slate-400 mt-1">Под эту нишу статьи будут нативно рекомендовать ваш продукт.</p>
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block mb-1.5">Ссылка на ваш продукт *</label>
                  <input value={targetUrl} onChange={e => setTargetUrl(e.target.value)} placeholder="https://dremia.ai" className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm text-slate-800 outline-none focus:border-indigo-400" />
                  <p className="text-[10px] text-slate-400 mt-1">Попадёт в каждую статью (блоки «Редакция рекомендует» + ссылки в тексте), не только в кнопку шапки.</p>
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block mb-1.5">Текст кнопки CTA</label>
                  <input value={ctaLabel} onChange={e => setCtaLabel(e.target.value)} placeholder="Попробовать → / Открыть Dremia →" className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm text-slate-800 outline-none focus:border-indigo-400" />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Ключевые слова</label>
                    <span className={`text-[11px] font-semibold ${keywordCount > 0 ? "text-indigo-500" : "text-slate-400"}`}>{keywordCount} / 1000</span>
                  </div>
                  <textarea value={keywordsText} onChange={e => setKeywordsText(e.target.value)} placeholder={"midjourney бесплатно, chatgpt для бизнеса, ..."} rows={12} className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-[13px] text-slate-800 outline-none focus:border-indigo-400 resize-none leading-relaxed" />
                </div>
                <button data-testid="button-analyze" onClick={handleAnalyze} disabled={isAnalyzing || !keywordsText.trim() || !projectName.trim()} className="w-full py-2.5 rounded-xl text-sm font-bold flex items-center justify-center gap-2 disabled:bg-slate-100 disabled:text-slate-400 text-white bg-gradient-to-r from-indigo-500 to-violet-600 shadow-md shadow-indigo-200 disabled:shadow-none">
                  {isAnalyzing ? <><Loader2 className="w-4 h-4 animate-spin" /> Анализирую... {analyzeElapsed > 0 ? `${analyzeElapsed}с` : ""}</> : <><Zap className="w-4 h-4" /> Построить структуру</>}
                </button>
                {isAnalyzing && <p className="text-[11px] text-slate-400 text-center">ИИ кластеризует ключевые слова — это занимает до 2–3 минут</p>}
              </div>
            </ScrollArea>
          )}

          {(phase === "structure" || phase === "generating" || phase === "done") && cfg && (
            <>
              <div className="px-5 py-3 border-b border-slate-100 flex justify-around">
                <Stat value={cfg.pagesGenerated} label="готово" color="#10b981" />
                <div className="w-px bg-slate-100" />
                <Stat value={cfg.pagesTotal} label="страниц" color="#0f172a" />
                <div className="w-px bg-slate-100" />
                <Stat value={cfg.clusters.length} label="разделов" color="#6366f1" />
              </div>
              {(phase === "generating" || cfg.pagesGenerated > 0) && (
                <div className="px-5 py-2.5 border-b border-slate-100">
                  <div className="flex justify-between mb-1.5 text-[11px] text-slate-400">
                    <span>Прогресс</span>
                    <span className={`font-bold ${pct === 100 ? "text-emerald-500" : "text-indigo-500"}`}>{genProgress.done} / {genProgress.total} ({pct}%)</span>
                  </div>
                  <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: pct === 100 ? "#10b981" : "linear-gradient(90deg,#4f46e5,#818cf8)" }} />
                  </div>
                </div>
              )}
              {phase === "done" && (
                <div className="flex items-center gap-1 px-4 pt-3">
                  <button onClick={() => setLeftTab("agent")} className={`flex-1 py-1.5 rounded-full text-[11px] font-semibold flex items-center justify-center gap-1.5 ${leftTab === "agent" ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-500 hover:text-slate-700"}`}>
                    <MessageSquare className="w-3.5 h-3.5" /> Агент
                  </button>
                  <button onClick={() => setLeftTab("pages")} className={`flex-1 py-1.5 rounded-full text-[11px] font-semibold flex items-center justify-center gap-1.5 ${leftTab === "pages" ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-500 hover:text-slate-700"}`}>
                    <Layers className="w-3.5 h-3.5" /> Страницы
                  </button>
                </div>
              )}

              {showPages && (
                <>
                  <div className="px-4 py-3 border-b border-slate-100 flex gap-2">
                    {phase === "generating" || isGenerating ? (
                      <>
                        <div className="flex-1 py-2 rounded-xl bg-slate-50 border border-slate-100 text-slate-400 text-xs flex items-center justify-center gap-2 min-w-0">
                          <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-500 shrink-0" />
                          <span className="truncate">{isStopping ? "Останавливаю…" : "Генерирую статьи..."}</span>
                        </div>
                        <button
                          type="button"
                          title="Остановить генерацию"
                          onClick={() => void stopGeneration()}
                          disabled={isStopping}
                          className="px-3 py-2 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 border border-red-200 bg-red-50 text-red-600 hover:bg-red-100 disabled:opacity-50 shrink-0"
                        >
                          <Square className="w-3 h-3 fill-current" /> Стоп
                        </button>
                      </>
                    ) : (
                      <>
                      <button onClick={() => startGeneration()} disabled={isGenerating} className={`flex-1 py-2 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 ${cfg.pagesGenerated > 0 ? "bg-indigo-50 text-indigo-600 border border-indigo-100" : "text-white bg-gradient-to-r from-indigo-500 to-violet-600 shadow-sm"}`}>
                        {cfg.pagesGenerated > 0
                          ? (cfg.pagesGenerated >= (cfg.pagesTotal || 0) && cfg.pagesTotal > 0
                            ? <><RefreshCw className="w-3.5 h-3.5" /> Обновить ленту</>
                            : <><RefreshCw className="w-3.5 h-3.5" /> Продолжить</>)
                          : <><Zap className="w-3.5 h-3.5" /> Генерировать</>}
                      </button>
                      {cfg.pagesGenerated > 0 && (
                        <button
                          type="button"
                          title="Заново изобрести уникальный дизайн главной (статьи не трогаем)"
                          onClick={() => void redesignHome()}
                          disabled={isGenerating}
                          className="px-2.5 rounded-xl border border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-100 disabled:opacity-50"
                        >
                          <Sparkles className="w-3.5 h-3.5" />
                        </button>
                      )}
                      </>
                    )}
                    <button title="Изменить ключевые слова" onClick={() => { setPhase("setup"); setKeywordsText(cfg.rawKeywords.join("\n")); setNiche(cfg.niche || ""); setTargetUrl(cfg.targetUrl || ""); setCtaLabel(cfg.ctaLabel || "Попробовать →"); }} className="px-2.5 rounded-xl border border-slate-200 text-slate-400 hover:text-slate-700 hover:bg-slate-50">
                      <RefreshCw className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div className="flex-1 overflow-y-auto pb-2">
                    <TreeRow icon={<Globe className="w-3 h-3 text-indigo-500 shrink-0" />} label="Главная" bold active={selectedFile === "index.html"} done={!!files.find(f => f.filename === "index.html")} indent={0} onClick={() => loadPreview("index.html")} />
                    {cfg.clusters.map(cluster => {
                      const open = openClusters.has(cluster.id);
                      const doneCount = cluster.keywords.filter((k: any) => k.status === "done").length;
                      const offerNiche = cluster.niche && cluster.niche !== cfg.niche ? cluster.niche : null;
                      return (
                        <div key={cluster.id}>
                          <TreeRow icon={open ? <ChevronDown className="w-3 h-3 text-slate-400 shrink-0" /> : <ChevronRight className="w-3 h-3 text-slate-400 shrink-0" />} label={cluster.name} badge={`${doneCount}/${cluster.keywords.length}${offerNiche ? ` · ${offerNiche}` : ""}`} bold active={selectedFile === `${cluster.slug}/index.html`} indent={0} onClick={() => { toggleCluster(cluster.id); loadPreview(`${cluster.slug}/index.html`); }} />
                          {open && cluster.keywords.map((kw: any) => (
                            <TreeRow
                              key={kw.id}
                              icon={<StatusIcon status={kw.status} />}
                              label={kw.title || kw.keyword}
                              badge={kw.targetUrl && kw.targetUrl !== cfg.targetUrl ? "реф" : undefined}
                              active={selectedFile === kw.filename}
                              indent={1}
                              faded={kw.status !== "done"}
                              onClick={() => kw.filename && loadPreview(kw.filename)}
                              onDelete={() => void removePage(kw)}
                              deleting={removingPageId === kw.id}
                            />
                          ))}
                        </div>
                      );
                    })}
                  </div>
                  {(phase === "generating" || isGenerating || isStopping) && genLog.length > 0 && (
                    <div className="border-t border-slate-100 px-4 py-2 max-h-[110px] overflow-y-auto bg-slate-50">
                      {genLog.slice(-7).map((line, i) => (
                        <div key={i} className="text-[10.5px] text-slate-400 leading-relaxed font-mono">{line}</div>
                      ))}
                    </div>
                  )}
                </>
              )}

              {showAgent && (
                <>
                  <ScrollArea className="flex-1">
                    <div className="py-5 space-y-4 px-4 min-w-0">
                      {chatMessages.length === 0 && !isChatting && !pendingUserMsg && (
                        <p className="text-[13px] text-slate-400 leading-relaxed">Опишите, что изменить: дизайн, структуру, тексты, фото. Можно прикрепить изображение — агент вставит его на страницу. Правка — 30 токенов.</p>
                      )}
                      {chatMessages.map((m) => (
                        <div key={m.id} className={`rounded-2xl p-3.5 text-sm min-w-0 ${m.role === "user" ? "bg-slate-800 text-white ml-auto max-w-[85%]" : "bg-slate-50 border border-slate-100 mr-auto"}`} style={{ overflowWrap: "break-word", wordBreak: "break-word" }}>
                          {m.role === "user" ? m.content : (
                            <div className="space-y-2">
                              <div className="flex items-center gap-2 mb-1">
                                <span className="text-primary font-black text-[11px]">Craft Agent</span>
                              </div>
                              <div className="text-slate-700 text-[13px] leading-relaxed select-text whitespace-pre-wrap">{agentChatText(m.content)}</div>
                            </div>
                          )}
                        </div>
                      ))}
                      {pendingUserMsg && (
                        <div className="rounded-2xl p-3.5 text-sm bg-slate-800 text-white ml-auto max-w-[85%] whitespace-pre-wrap" style={{ overflowWrap: "break-word" }}>{pendingUserMsg}</div>
                      )}
                      {isChatting && (
                        <div className="bg-slate-50 border border-slate-100 rounded-2xl p-3.5 text-sm max-w-[90%]">
                          <div className="flex items-center gap-2 mb-1">
                            <Sparkles className="w-3.5 h-3.5 text-primary shrink-0" />
                            <span className="text-primary font-black text-[11px]">Craft Agent</span>
                            <Loader2 className="w-3 h-3 animate-spin text-primary" />
                          </div>
                          <p className="text-slate-500 text-[13px] font-medium animate-pulse">{chatStatus || "Агент думает…"}</p>
                        </div>
                      )}
                      <div ref={chatEndRef} />
                    </div>
                  </ScrollArea>
                  <div className="p-3 border-t border-slate-100 bg-white pb-[max(0.75rem,env(safe-area-inset-bottom))]">
                    {attachedImageUrls.length > 0 && (
                      <div className="mb-3 flex flex-wrap gap-2">
                        {attachedImageUrls.map((img, i) => (
                          <div key={img.url} className="relative inline-flex items-center gap-2 bg-white rounded-lg px-3 py-2 shadow-sm border border-slate-200/50">
                            <img src={img.preview} alt="" className="w-12 h-12 object-cover rounded-md" />
                            <button className="text-slate-400 hover:text-red-500" onClick={() => setAttachedImageUrls(prev => prev.filter((_, j) => j !== i))}><X className="w-4 h-4" /></button>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="relative flex items-end">
                      <input ref={chatFileRef} type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleAttachChatImage(f); e.target.value = ""; }} />
                      <div className="flex-1 relative bg-slate-50 rounded-2xl border border-slate-200 overflow-hidden">
                        <Textarea
                          placeholder="Попросите изменить сайт или задайте вопрос агенту..."
                          value={chatInput}
                          onChange={e => setChatInput(e.target.value)}
                          onKeyDown={e => e.key === "Enter" && !e.shiftKey && (e.preventDefault(), handleChatSend())}
                          className="min-h-[72px] max-h-[400px] resize-y rounded-2xl border-none bg-transparent text-sm pl-4 pr-20 py-3.5 focus-visible:ring-0 focus-visible:ring-offset-0 overflow-y-auto text-slate-700 placeholder:text-slate-400"
                          disabled={isChatting}
                        />
                        <div className="absolute right-2 bottom-2 flex items-center gap-1">
                          <button onClick={() => chatFileRef.current?.click()} disabled={isChatting} className="h-7 w-7 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-white transition-all disabled:opacity-40" title="Прикрепить фото">
                            <Paperclip className="w-3.5 h-3.5" />
                          </button>
                          <button onClick={() => handleChatSend()} disabled={isChatting || (!chatInput.trim() && attachedImageUrls.length === 0)} className="h-7 w-7 rounded-full flex items-center justify-center bg-primary text-white hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed shadow-sm shadow-primary/30">
                            {isChatting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </>
              )}
            </>
          )}
        </SkeuoPanel>

        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className={`hidden sm:flex absolute left-0 top-1/2 -translate-y-1/2 z-10 w-6 h-12 bg-white shadow-sm border border-slate-100 rounded-r-xl items-center justify-center hover:bg-slate-50 text-slate-400 hover:text-slate-700 transition-all duration-500 ${sidebarOpen ? "translate-x-[440px]" : "translate-x-0"}`}
        >
          {sidebarOpen ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </button>

        <SkeuoPanel className="flex-1 relative bg-[#F6F7FB] flex flex-col overflow-hidden min-w-0">
          {htmlFiles.length > 0 && (
            <div className="flex items-center gap-1 px-3 pt-3 pb-2 overflow-x-auto shrink-0 border-b border-slate-100 bg-white">
              {htmlFiles.slice(0, 24).map(f => (
                <button
                  key={f.filename}
                  onClick={() => loadPreview(f.filename)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap ${selectedFile === f.filename ? "bg-slate-100 text-slate-800" : "text-slate-400 hover:text-slate-700 hover:bg-slate-50"}`}
                >
                  <FileText className="w-3 h-3" />
                  {f.filename === "index.html" ? "Главная" : f.filename.replace(/\/index\.html$/, "").replace(/\.html$/, "")}
                </button>
              ))}
            </div>
          )}
          <div className="flex-1 p-3 overflow-hidden min-w-0">
            {previewHtml ? (
              <div className="w-full h-full flex items-center justify-center overflow-hidden relative">
                <div className="bg-white rounded-2xl shadow-sm overflow-hidden border border-slate-200 w-full h-full min-w-0">
                  <iframe srcDoc={previewHtml} className="w-full h-full border-none" title="preview" sandbox="allow-scripts allow-forms" />
                </div>
              </div>
            ) : isAnalyzing ? (
              <AnalyzingScreen elapsed={analyzeElapsed} keywordCount={keywordCount} />
            ) : (
              <EmptyScreen phase={phase} />
            )}
          </div>
        </SkeuoPanel>
      </div>

      {/* ═══ MODAL: Publish + custom domain ═══ */}
      {showPublishModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.72)", zIndex: 220, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
          <div style={{ background: "#fff", color: "#111", borderRadius: 16, width: "100%", maxWidth: 480, maxHeight: "90vh", overflow: "hidden", display: "flex", flexDirection: "column", boxShadow: "0 24px 64px rgba(0,0,0,.45)" }}>
            <div style={{ padding: "14px 18px", borderBottom: "1px solid #eee", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ fontWeight: 700, fontSize: 16 }}>Публикация SEO-сайта</div>
              <button onClick={() => setShowPublishModal(false)} style={{ background: "none", border: "none", cursor: "pointer", color: "#888" }}><X className="w-5 h-5" /></button>
            </div>
            <div style={{ overflowY: "auto", flex: 1, padding: "1rem 1.25rem 1.25rem" }}>
              {isPublishing && (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "1rem", padding: "1rem 0" }}>
                  <Loader2 className="w-10 h-10 animate-spin" style={{ color: "#764ba2" }} />
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontWeight: 700, marginBottom: 4 }}>Публикуем сайт…</div>
                    <div style={{ fontSize: "0.82rem", color: "#86868B" }}>Загружаем файлы в Yandex Cloud</div>
                  </div>
                </div>
              )}
              {publishError && !isPublishing && (
                <div style={{ marginBottom: 12 }}>
                  <div style={{ color: "#dc2626", fontSize: 13, marginBottom: 10 }}>{publishError}</div>
                  <button
                    onClick={handlePublish}
                    style={{ padding: "8px 14px", borderRadius: 10, border: "none", background: "linear-gradient(135deg,#667eea,#764ba2)", color: "#fff", cursor: "pointer", fontWeight: 600, fontSize: 13 }}
                  >
                    Повторить публикацию
                  </button>
                </div>
              )}
              {!isPublishing && (publishResult || publishUrl) && (
                <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", color: "#16a34a" }}>
                    <CheckCircle2 className="w-5 h-5" />
                    <span style={{ fontWeight: 700, fontSize: "0.95rem" }}>Сайт опубликован</span>
                  </div>
                  <div style={{ background: "#f8f8f8", borderRadius: 12, padding: "0.75rem 1rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                    <a href={publishResult || publishUrl!} target="_blank" rel="noreferrer" style={{ flex: 1, fontSize: "0.82rem", color: "#007AFF", wordBreak: "break-all" }}>{publishResult || publishUrl}</a>
                    <button
                      onClick={() => handleCopyUrl(publishResult || publishUrl!)}
                      style={{ flexShrink: 0, padding: "0.4rem 0.7rem", borderRadius: 8, border: "1px solid #e5e7eb", background: copied ? "#f0fdf4" : "#fff", cursor: "pointer", fontSize: "0.75rem", fontWeight: 600, color: copied ? "#16a34a" : "#555" }}
                    >
                      {copied ? "Скопировано!" : "Копировать"}
                    </button>
                  </div>
                  <div style={{ fontSize: 12, color: "#6b7280", lineHeight: 1.5 }}>
                    Технический адрес Yandex Cloud. Чтобы сайт открывался на своём домене — привяжите его ниже.
                  </div>

                  <div style={{ borderTop: "1px solid #e5e7eb", paddingTop: "1rem" }}>
                    <div style={{ fontSize: "0.8rem", fontWeight: 700, color: "#333", marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}>
                      Свой домен
                      {domainResult && domainVerified === true && (
                        <span style={{ fontSize: "0.72rem", color: "#16a34a", fontWeight: 600 }}>Подключён</span>
                      )}
                      {domainResult && domainVerified !== true && (
                        <span style={{ fontSize: "0.72rem", color: "#f59e0b", fontWeight: 600 }}>Добавлен</span>
                      )}
                      {domainResult && (
                        <button onClick={handleChangeDomain} style={{ marginLeft: "auto", fontSize: "0.72rem", color: "#6b7280", background: "none", border: "1px solid #e5e7eb", borderRadius: 6, padding: "2px 8px", cursor: "pointer" }}>
                          Сменить домен
                        </button>
                      )}
                    </div>
                    {!domainResult ? (
                      <>
                        <div style={{ display: "flex", gap: "0.5rem" }}>
                          <input
                            type="text"
                            placeholder="example.ru"
                            value={customDomain}
                            onChange={(e) => setCustomDomain(e.target.value)}
                            style={{ flex: 1, padding: "0.5rem 0.75rem", borderRadius: 10, border: "1px solid #e5e7eb", fontSize: "0.85rem", outline: "none" }}
                          />
                          <button
                            onClick={handleAddDomain}
                            disabled={domainAdding || !customDomain.trim()}
                            style={{ padding: "0.5rem 0.9rem", borderRadius: 10, border: "none", background: "#4f46e5", color: "#fff", fontWeight: 600, fontSize: 13, cursor: domainAdding || !customDomain.trim() ? "not-allowed" : "pointer" }}
                          >
                            {domainAdding ? "…" : "Привязать"}
                          </button>
                        </div>
                        <div style={{ marginTop: 7, fontSize: "0.8rem", color: "#6b7280" }}>
                          Нет домена?{" "}
                          <a href="https://www.reg.ru/domain/new/?rlink=reflink-32024207" target="_blank" rel="noopener noreferrer" style={{ color: "#7c3aed", fontWeight: 700 }}>Купить</a>
                        </div>
                        {domainError && <div style={{ marginTop: 8, fontSize: "0.78rem", color: "#dc2626" }}>{domainError}</div>}
                      </>
                    ) : (
                      <DnsInstructions
                        customDomain={customDomain}
                        aRecordIp={domainIp}
                        domainChecking={domainChecking}
                        domainVerified={domainVerified}
                        domainDnsReady={domainDnsReady}
                        domainStatusMessage={domainStatusMessage}
                        onCheck={handleCheckDomain}
                        testId="button-seo-check-domain"
                      />
                    )}
                  </div>

                  <div style={{ display: "flex", gap: "0.75rem" }}>
                    <button
                      onClick={() => window.open(publishResult || publishUrl!, "_blank")}
                      style={{ flex: 1, padding: "10px", borderRadius: 10, border: "1px solid #e5e7eb", background: "#fff", cursor: "pointer", fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
                    >
                      <ExternalLink className="w-4 h-4" /> Открыть
                    </button>
                    <button
                      onClick={handlePublish}
                      style={{ flex: 1, padding: "10px", borderRadius: 10, border: "none", background: "linear-gradient(135deg,#667eea,#764ba2)", color: "#fff", cursor: "pointer", fontWeight: 600 }}
                    >
                      Обновить сайт
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ═══ MODAL: Add Keywords (+ optional niche / referral) ═══ */}
      {addKwOpen && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.75)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
          <div style={{ background: "#111118", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 14, width: "100%", maxWidth: 520, padding: 24, boxShadow: "0 24px 64px rgba(0,0,0,.7)", maxHeight: "90vh", overflowY: "auto" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 700, color: "#e2e8f0", letterSpacing: "-0.01em" }}>➕ Добавить ключи</div>
                <div style={{ fontSize: 12, color: "#555", marginTop: 3 }}>Можно указать другую нишу и реф-ссылку для этого пакета</div>
              </div>
              <button onClick={() => setAddKwOpen(false)} style={{ background: "none", border: "none", color: "#555", cursor: "pointer", padding: 4 }}>
                <X className="w-5 h-5" />
              </button>
            </div>

            <div style={{
              marginBottom: 14, padding: "12px 14px", borderRadius: 10,
              background: "rgba(99,102,241,0.06)", border: "1px solid rgba(99,102,241,0.18)",
            }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: "#818cf8", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>
                Оффер для этих статей
              </div>
              <label style={{ fontSize: 11, fontWeight: 600, color: "#666", display: "block", marginBottom: 5 }}>
                Ниша / продукт <span style={{ fontWeight: 400, color: "#444" }}>(если отличается от «{cfg?.niche || "сайта"}»)</span>
              </label>
              <input
                value={addKwNiche}
                onChange={e => setAddKwNiche(e.target.value)}
                placeholder="например: AI-инструменты для бизнеса"
                style={{ width: "100%", padding: "9px 11px", marginBottom: 10, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, color: "#e2e8f0", fontSize: 12.5, outline: "none", boxSizing: "border-box", fontFamily: "inherit" }}
                onFocus={e => (e.target.style.borderColor = "rgba(99,102,241,0.5)")}
                onBlur={e => (e.target.style.borderColor = "rgba(255,255,255,0.08)")}
              />
              <label style={{ fontSize: 11, fontWeight: 600, color: "#666", display: "block", marginBottom: 5 }}>
                Реф-ссылка CTA
              </label>
              <input
                value={addKwTargetUrl}
                onChange={e => setAddKwTargetUrl(e.target.value)}
                placeholder={cfg?.targetUrl || "https://partner.example/ref/..."}
                style={{ width: "100%", padding: "9px 11px", marginBottom: 10, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, color: "#e2e8f0", fontSize: 12.5, outline: "none", boxSizing: "border-box", fontFamily: "inherit" }}
                onFocus={e => (e.target.style.borderColor = "rgba(99,102,241,0.5)")}
                onBlur={e => (e.target.style.borderColor = "rgba(255,255,255,0.08)")}
              />
              <label style={{ fontSize: 11, fontWeight: 600, color: "#666", display: "block", marginBottom: 5 }}>
                Текст кнопки
              </label>
              <input
                value={addKwCtaLabel}
                onChange={e => setAddKwCtaLabel(e.target.value)}
                placeholder={cfg?.ctaLabel || "Попробовать →"}
                style={{ width: "100%", padding: "9px 11px", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, color: "#e2e8f0", fontSize: 12.5, outline: "none", boxSizing: "border-box", fontFamily: "inherit" }}
                onFocus={e => (e.target.style.borderColor = "rgba(99,102,241,0.5)")}
                onBlur={e => (e.target.style.borderColor = "rgba(255,255,255,0.08)")}
              />
              <div style={{ fontSize: 10.5, color: "#555", marginTop: 8, lineHeight: 1.45 }}>
                Пустые поля = оффер сайта по умолчанию. Для новой ниши укажите свою реф-ссылку — она попадёт в CTA новых статей.
              </div>
            </div>

            <label style={{ fontSize: 11, fontWeight: 600, color: "#666", textTransform: "uppercase", letterSpacing: "0.06em", display: "block", marginBottom: 6 }}>
              Ключевые слова
            </label>
            <textarea
              value={addKwText}
              onChange={e => setAddKwText(e.target.value)}
              placeholder={"новый запрос 1, новый запрос 2\n..."}
              rows={8}
              style={{ width: "100%", padding: "10px 11px", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, color: "#e2e8f0", fontSize: 12.5, resize: "none", outline: "none", lineHeight: 1.65, boxSizing: "border-box", fontFamily: "inherit" }}
              onFocus={e => (e.target.style.borderColor = "rgba(99,102,241,0.5)")}
              onBlur={e => (e.target.style.borderColor = "rgba(255,255,255,0.08)")}
            />
            <div style={{ fontSize: 11, color: "#444", marginTop: 6 }}>
              {addKwText.split(/[\n,]+/).filter(k => k.trim()).length} ключей
            </div>
            <button
              onClick={handleAddKeywords}
              disabled={isAddingKw || !addKwText.trim()}
              style={{ marginTop: 14, width: "100%", padding: "11px", background: isAddingKw || !addKwText.trim() ? "rgba(255,255,255,0.04)" : "linear-gradient(135deg,#4f46e5,#7c3aed)", border: "none", borderRadius: 10, color: isAddingKw || !addKwText.trim() ? "#555" : "#fff", fontWeight: 700, fontSize: 13.5, cursor: isAddingKw || !addKwText.trim() ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}
            >
              {isAddingKw ? <><Loader2 className="w-4 h-4 animate-spin" /> Анализирую...</> : <><Zap className="w-4 h-4" /> Добавить в структуру</>}
            </button>
          </div>
        </div>
      )}

      {linksOpen && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.75)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
          <div style={{ background: "#111118", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 14, width: "100%", maxWidth: 640, padding: 24, boxShadow: "0 24px 64px rgba(0,0,0,.7)", maxHeight: "92vh", display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 700, color: "#e2e8f0", letterSpacing: "-0.01em" }}>Ссылки для Вебмастера</div>
                <div style={{ fontSize: 12, color: "#555", marginTop: 3 }}>
                  {pageUrls.length} страниц на {boundDomain.replace(/^www\./i, "")} — скопируйте и добавьте в Яндекс.Вебмастер
                </div>
              </div>
              <button onClick={() => setLinksOpen(false)} style={{ background: "none", border: "none", color: "#555", cursor: "pointer", padding: 4 }}>
                <X className="w-5 h-5" />
              </button>
            </div>
            <textarea
              readOnly
              value={pageUrlsText}
              data-testid="textarea-page-urls"
              style={{
                width: "100%", flex: 1, minHeight: 280, maxHeight: "52vh",
                padding: "12px 14px", boxSizing: "border-box",
                background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: 10, color: "#c7d2fe", fontSize: 12, lineHeight: 1.65,
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
                outline: "none", resize: "vertical",
              }}
            />
            <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
              <button
                onClick={downloadPageUrls}
                style={{ flex: 1, padding: "10px", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, color: "#c7d2fe", fontWeight: 600, fontSize: 13, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
              >
                <Download className="w-3.5 h-3.5" /> Скачать .txt
              </button>
              <button
                onClick={copyAllPageUrls}
                data-testid="button-copy-page-urls"
                style={{ flex: 2, padding: "10px", background: linksCopied ? "rgba(52,211,153,0.18)" : "linear-gradient(135deg,#4f46e5,#7c3aed)", border: "none", borderRadius: 10, color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
              >
                {linksCopied ? <><CheckCircle2 className="w-3.5 h-3.5" /> Скопировано</> : <><Copy className="w-3.5 h-3.5" /> Скопировать все</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {faviconCropOpen && (
        <div
          style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,0.75)", display: "flex", alignItems: "center", justifyContent: "center" }}
          onMouseMove={onCropMouseMove}
          onMouseUp={() => setCropDrag(null)}
          onMouseLeave={() => setCropDrag(null)}
        >
          <div style={{ background: "#111118", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 20, padding: 24, width: 520, maxWidth: "95vw", boxShadow: "0 25px 80px rgba(0,0,0,0.6)" }}>
            <div style={{ fontWeight: 700, fontSize: "1.1rem", color: "#e2e8f0", marginBottom: 6 }}>Обрезать фавикон</div>
            <div style={{ color: "#888", fontSize: "0.8rem", marginBottom: 16 }}>Перетащите квадрат в нужное место. Потяните за угол — изменить размер.</div>
            <div ref={cropContainerRef} style={{ position: "relative", width: "100%", aspectRatio: "1/1", overflow: "hidden", borderRadius: 12, background: "#000", cursor: cropDrag?.mode === "move" ? "grabbing" : "default" }}>
              <img
                ref={cropImgRef}
                src={faviconRawSrc}
                onLoad={() => {
                  if (cropContainerRef.current) {
                    const r = cropContainerRef.current.getBoundingClientRect();
                    const s = Math.min(r.width, r.height) * 0.8;
                    setCropBox({ x: (r.width - s) / 2, y: (r.height - s) / 2, size: s });
                  }
                }}
                style={{ width: "100%", height: "100%", objectFit: "contain", display: "block", userSelect: "none", pointerEvents: "none" }}
                alt=""
              />
              <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.5)", pointerEvents: "none" }} />
              <div
                onMouseDown={(e) => onCropMouseDown(e, "move")}
                style={{
                  position: "absolute",
                  left: cropBox.x, top: cropBox.y,
                  width: cropBox.size, height: cropBox.size,
                  border: "2px solid #fff",
                  boxShadow: "0 0 0 9999px rgba(0,0,0,0.5)",
                  cursor: "grab",
                  boxSizing: "border-box",
                }}
              >
                <div style={{ position: "absolute", inset: 0, background: "transparent" }} />
                <div
                  onMouseDown={(e) => { e.stopPropagation(); onCropMouseDown(e, "resize"); }}
                  style={{ position: "absolute", bottom: -6, right: -6, width: 16, height: 16, background: "#fff", borderRadius: 4, cursor: "se-resize", boxShadow: "0 2px 6px rgba(0,0,0,0.4)" }}
                />
                <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", color: "rgba(255,255,255,0.6)", fontSize: "0.65rem", pointerEvents: "none", whiteSpace: "nowrap" }}>
                  {Math.round(cropBox.size)} × {Math.round(cropBox.size)}
                </div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 16, justifyContent: "flex-end" }}>
              <button
                onClick={() => setFaviconCropOpen(false)}
                style={{ padding: "10px 16px", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, color: "#888", fontWeight: 600, fontSize: 13, cursor: "pointer" }}
              >
                Отмена
              </button>
              <button
                onClick={applyFaviconCrop}
                style={{ padding: "10px 16px", background: "linear-gradient(135deg,#4f46e5,#7c3aed)", border: "none", borderRadius: 10, color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer" }}
              >
                Сохранить фавикон
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Tree row ─── */
function TreeRow({ icon, label, bold = false, active, done, badge, faded, indent, onClick, onDelete, deleting }: {
  icon: any; label: string; bold?: boolean; active?: boolean; done?: boolean;
  badge?: string; faded?: boolean; indent?: number; onClick?: () => void;
  onDelete?: () => void; deleting?: boolean;
}) {
  return (
    <div
      className={`group w-full flex items-center border-l-2 ${active ? "bg-slate-100 border-indigo-500" : "bg-transparent border-transparent hover:bg-slate-50"}`}
      style={{ paddingLeft: 14 + (indent || 0) * 16 }}
    >
      <button
        type="button"
        onClick={onClick}
        className="flex-1 min-w-0 text-left cursor-pointer flex items-center gap-2 py-1.5 pr-1"
      >
        {icon}
        <span className={`text-[13px] flex-1 overflow-hidden text-ellipsis whitespace-nowrap ${bold ? "font-semibold" : "font-normal"} ${active ? "text-slate-800" : faded ? "text-slate-400" : "text-slate-600"}`}>{label}</span>
        {done && !badge && <CheckCircle2 className="w-3 h-3 text-emerald-500 shrink-0 opacity-70" />}
        {badge && <span className="text-[10px] text-slate-400 font-semibold shrink-0">{badge}</span>}
      </button>
      {onDelete && (
        <button
          type="button"
          title="Убрать страницу"
          disabled={deleting}
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); onDelete(); }}
          className="shrink-0 mr-2 p-1 rounded-md text-slate-300 hover:text-red-500 hover:bg-red-50 opacity-70 sm:opacity-0 sm:group-hover:opacity-100 disabled:opacity-40"
        >
          {deleting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
        </button>
      )}
    </div>
  );
}

/* ─── Analyzing screen (shown in right panel while AI clusters) ─── */
function AnalyzingScreen({ elapsed, keywordCount }: { elapsed: number; keywordCount: number }) {
  const phases = [
    { at: 0,  label: "Отправляю ключевые слова в ИИ..." },
    { at: 5,  label: "Анализирую семантику ключей..." },
    { at: 20, label: "Кластеризую по темам..." },
    { at: 60, label: "Формирую структуру сайта..." },
    { at: 100, label: "Генерирую заголовки статей..." },
    { at: 150, label: "Финализирую структуру..." },
  ];
  const currentPhase = [...phases].reverse().find(p => elapsed >= p.at) || phases[0];

  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-6 p-10">
      <div className="relative w-20 h-20 flex items-center justify-center">
        <div style={{ position: "absolute", inset: 0, borderRadius: "50%", border: "2px solid rgba(99,102,241,0.15)", animation: "spin 3s linear infinite" }} />
        <div style={{ position: "absolute", inset: 6, borderRadius: "50%", border: "2px solid rgba(124,58,237,0.25)", animation: "spin 2s linear infinite reverse" }} />
        <Layers className="w-7 h-7 text-indigo-400" />
      </div>

      <div style={{ textAlign: "center", maxWidth: 360 }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: "#0f172a", marginBottom: 8, letterSpacing: "-0.02em" }}>
          Анализирую {keywordCount} ключей
        </div>
        <div style={{ fontSize: 13.5, color: "#818cf8", marginBottom: 6, minHeight: 20 }}>
          {currentPhase.label}
        </div>
        <div style={{ fontSize: 12, color: "#444" }}>
          Прошло: {elapsed < 60 ? `${elapsed}с` : `${Math.floor(elapsed / 60)}м ${elapsed % 60}с`}
          {" · "}{keywordCount > 200 ? "большой список, обычно до 1–2 мин" : "обычно занимает до минуты"}
        </div>
      </div>

      {/* progress dots */}
      <div style={{ display: "flex", gap: 6 }}>
        {[0, 1, 2, 3, 4].map(i => (
          <div key={i} style={{
            width: 6, height: 6, borderRadius: "50%",
            background: i <= Math.min(4, Math.floor(elapsed / 30)) ? "#4f46e5" : "#e2e8f0",
            transition: "background 0.5s",
          }} />
        ))}
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

/* ─── Empty state ─── */
function EmptyScreen({ phase }: { phase: Phase }) {
  if (phase === "setup") return (
    <div className="flex-1 flex flex-col items-center justify-center gap-5 p-10">
      <div className="w-16 h-16 rounded-2xl bg-indigo-50 border border-indigo-100 flex items-center justify-center">
        <BarChart2 className="w-7 h-7 text-indigo-500" />
      </div>
      <div className="text-center max-w-sm">
        <div className="text-lg font-bold text-slate-800 mb-2 tracking-tight">SEO-машина</div>
        <div className="text-[13.5px] text-slate-500 leading-relaxed mb-5">
          Вставьте ключевые слова слева. ИИ кластеризует их по темам, создаст структуру и сгенерирует статьи с изображениями.
        </div>
        <div className="inline-flex flex-col gap-2 text-left">
          {[
            ["⚡", "70 токенов / статья (вкл. 3 фото)"],
            ["📊", "До 1000 ключевых слов"],
            ["🌐", "Публикация на своём домене одной кнопкой"],
          ].map(([icon, text]) => (
            <div key={text} className="flex items-center gap-2.5 text-[12.5px] text-slate-500">
              <span>{icon}</span><span>{text}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-3 p-10">
      <div className="w-14 h-14 rounded-2xl bg-slate-50 border border-slate-100 flex items-center justify-center">
        <FileText className="w-6 h-6 text-slate-400" />
      </div>
      <div className="text-[13.5px] text-slate-500 text-center">
        Нажмите на страницу в структуре для предпросмотра
      </div>
    </div>
  );
}
