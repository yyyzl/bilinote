import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ArrowLeft,
  BrainCircuit,
  CalendarDays,
  CircleHelp,
  FileText,
  Loader2,
  Network,
  RefreshCw,
  ScrollText,
  Sparkles,
} from "lucide-react";
import * as api from "../lib/tauri";
import ErrorModal, { formatError } from "../components/ErrorModal";
import MermaidRenderer from "../components/MermaidRenderer";
import CopyButton from "../components/CopyButton";

type TabType = "summary" | "mindmap";
type GenerateType = "summary" | "mindmap";

const GENERATE_CONFIG = {
  summary: {
    startApi: api.startSummarize,
    defaultError: "生成总结失败",
  },
  mindmap: {
    startApi: api.startMindmap,
    defaultError: "生成思维导图失败",
  },
} as const;

const TRANSCRIPT_SOURCE_META = {
  subtitle: {
    label: "字幕",
    className: "border-sage-200 bg-sage-100/70 text-sage-700",
  },
  asr: {
    label: "ASR",
    className: "border-primary-200 bg-primary-50 text-primary-700",
  },
  mixed: {
    label: "混合",
    className: "border-gold-300 bg-gold-100/80 text-[#8e6532]",
  },
} as const;

const SUMMARY_PROSE =
  "prose prose-lg max-w-none prose-headings:font-display prose-headings:text-ink-900 prose-h2:text-[2rem] prose-h2:leading-tight prose-h2:tracking-[-0.03em] prose-h3:text-[1.4rem] prose-h3:leading-snug prose-p:text-ink-600 prose-p:leading-8 prose-strong:text-ink-900 prose-strong:font-semibold prose-a:text-primary-600 prose-ul:text-ink-600 prose-ol:text-ink-600 prose-li:marker:text-primary-400 prose-blockquote:border-l-primary-400 prose-blockquote:bg-primary-50/40 prose-blockquote:py-3 prose-blockquote:px-5 prose-blockquote:text-ink-600 prose-pre:bg-canvas-100 prose-code:text-primary-700";

function formatCreatedDate(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export default function NoteDetail() {
  const { id } = useParams<{ id: string }>();
  const [note, setNote] = useState<api.Note | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>("summary");
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [mindmapLoading, setMindmapLoading] = useState(false);
  const [summaryProgress, setSummaryProgress] = useState("");
  const [mindmapProgress, setMindmapProgress] = useState("");
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [showTranscriptReason, setShowTranscriptReason] = useState(false);

  const summaryPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mindmapPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // 当前进行中的总结 / 思维导图任务 id，用于按 task_id 过滤进度事件，避免并发串台
  const summaryTaskIdRef = useRef<string | null>(null);
  const mindmapTaskIdRef = useRef<string | null>(null);
  const isMountedRef = useRef(true);
  const transcriptReasonRef = useRef<HTMLDivElement>(null);

  const clearPoll = useCallback((type: GenerateType) => {
    const pollRef = type === "summary" ? summaryPollRef : mindmapPollRef;
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const loadNote = useCallback(
    async (noteId: string) => {
      try {
        const data = await api.getNote(noteId);
        if (isMountedRef.current) {
          setNote(data);
        }
      } catch (e) {
        if (isMountedRef.current) {
          setError(formatError(e));
        }
      }
    },
    []
  );

  useEffect(() => {
    isMountedRef.current = true;
    if (id) {
      void loadNote(id);
    }

    let cleanup: (() => void) | undefined;
    api.onProgress((taskId, message, kind) => {
      if (!isMountedRef.current) return;
      // 只接收属于本页当前任务的进度，忽略其它笔记的并发任务事件
      if (kind === "summarize" && taskId === summaryTaskIdRef.current) {
        setSummaryProgress(message);
      } else if (kind === "mindmap" && taskId === mindmapTaskIdRef.current) {
        setMindmapProgress(message);
      }
    }).then((fn) => {
      cleanup = fn;
    });

    return () => {
      isMountedRef.current = false;
      cleanup?.();
      clearPoll("summary");
      clearPoll("mindmap");
    };
  }, [id, clearPoll, loadNote]);

  useEffect(() => {
    setShowTranscriptReason(false);
  }, [id, note?.id]);

  useEffect(() => {
    if (!showTranscriptReason) return;

    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target;
      if (target instanceof Node && !transcriptReasonRef.current?.contains(target)) {
        setShowTranscriptReason(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
    };
  }, [showTranscriptReason]);

  const handleGenerate = useCallback(
    async (type: GenerateType) => {
      if (!id) return;

      const config = GENERATE_CONFIG[type];
      const setLoading = type === "summary" ? setSummaryLoading : setMindmapLoading;
      const setProgress = type === "summary" ? setSummaryProgress : setMindmapProgress;
      const pollRef = type === "summary" ? summaryPollRef : mindmapPollRef;
      const taskIdRef = type === "summary" ? summaryTaskIdRef : mindmapTaskIdRef;

      setLoading(true);
      setActiveTab(type);
      setProgress("");

      try {
        const taskId = await config.startApi(id);
        taskIdRef.current = taskId;
        clearPoll(type);

        pollRef.current = setInterval(async () => {
          if (!isMountedRef.current) {
            clearPoll(type);
            return;
          }

          try {
            const taskInfo = await api.getTaskStatus(taskId);
            if (!isMountedRef.current) return;

            setProgress(taskInfo.progress);

            if (taskInfo.status === "completed") {
              clearPoll(type);
              taskIdRef.current = null;
              if (taskInfo.note_id) {
                const updated = await api.getNote(taskInfo.note_id);
                if (updated && isMountedRef.current) {
                  setNote(updated);
                }
              }
              if (isMountedRef.current) {
                setLoading(false);
              }
            } else if (taskInfo.status === "failed" || taskInfo.status === "cancelled") {
              clearPoll(type);
              taskIdRef.current = null;
              if (isMountedRef.current) {
                setError(taskInfo.error || config.defaultError);
                setLoading(false);
              }
            }
          } catch (e) {
            clearPoll(type);
            taskIdRef.current = null;
            if (isMountedRef.current) {
              setError(formatError(e));
              setLoading(false);
            }
          }
        }, 2000);
      } catch (e) {
        if (isMountedRef.current) {
          setError(formatError(e));
          setLoading(false);
        }
      }
    },
    [id, clearPoll]
  );

  const handleSummarize = useCallback(() => {
    void handleGenerate("summary");
  }, [handleGenerate]);

  const handleMindmap = useCallback(() => {
    void handleGenerate("mindmap");
  }, [handleGenerate]);

  const isLoading = summaryLoading || mindmapLoading;
  const currentProgress = activeTab === "summary" ? summaryProgress : mindmapProgress;
  const hasCurrentContent = activeTab === "summary" ? !!note?.summary : !!note?.mindmap;

  if (!note) {
    return (
      <div className="app-shell">
        <div className="page-shell flex min-h-screen items-center justify-center">
          <div className="editorial-card flex w-full max-w-lg flex-col items-center px-6 py-12 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full border border-primary-200 bg-primary-50 text-primary-600">
              <Loader2 size={24} className="animate-spin" />
            </div>
            <p className="mt-6 font-display text-2xl font-semibold text-ink-900">正在加载笔记</p>
            <p className="mt-3 text-sm leading-7 text-ink-500">稍等一下，我们正在准备这份内容的阅读视图。</p>
          </div>
        </div>
        <ErrorModal error={error} onClose={() => setError("")} />
      </div>
    );
  }

  const transcriptSourceMeta = note.transcript_source
    ? TRANSCRIPT_SOURCE_META[note.transcript_source as keyof typeof TRANSCRIPT_SOURCE_META]
    : null;
  const transcriptReasonTitle =
    note.transcript_source === "mixed" ? "部分内容为什么用了 ASR" : "为什么没有走原生字幕";

  return (
    <div className="app-shell">
      <header className="floating-topbar">
        <div className="topbar-inner">
          <Link to="/" className="button-secondary min-h-11 !px-4" aria-label="返回首页">
            <ArrowLeft size={18} />
            <span className="hidden sm:inline">返回</span>
          </Link>

          <div className="min-w-0 flex-1">
            <p className="editorial-kicker">Note Reader</p>
            <h1 className="truncate font-display text-2xl font-semibold leading-tight text-ink-900">
              {note.title}
            </h1>
          </div>

          <div className="editorial-chip hidden sm:inline-flex">{note.bvid}</div>
        </div>
      </header>

      <main className="page-shell mt-header-offset pt-6 sm:pt-8">
        <section className="hero-panel overflow-hidden">
            <div className="space-y-8 p-6 sm:p-8 lg:p-10">
              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="editorial-chip">
                    <Sparkles size={14} />
                    Reading Workspace
                  </div>
                  {transcriptSourceMeta && (
                    <div ref={transcriptReasonRef} className="relative">
                      <button
                        type="button"
                        onClick={() => {
                          if (note.transcript_reason) {
                            setShowTranscriptReason((previous) => !previous);
                          }
                        }}
                        className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${transcriptSourceMeta.className} ${
                          note.transcript_reason ? "cursor-pointer" : "cursor-default"
                        }`}
                        aria-label={
                          note.transcript_reason
                            ? `${transcriptSourceMeta.label}，查看原因说明`
                            : transcriptSourceMeta.label
                        }
                        aria-expanded={note.transcript_reason ? showTranscriptReason : undefined}
                      >
                        <span>{transcriptSourceMeta.label}</span>
                        {note.transcript_reason && <CircleHelp size={12} />}
                      </button>

                      {note.transcript_reason && (
                        <div
                          className={`absolute left-0 top-full z-20 mt-2 w-72 rounded-[24px] border border-ink-100 bg-ink-900 px-4 py-3 text-left text-xs leading-6 text-canvas-50 shadow-soft transition-all ${
                            showTranscriptReason
                              ? "pointer-events-auto translate-y-0 opacity-100"
                              : "pointer-events-none -translate-y-1 opacity-0"
                          }`}
                        >
                          <p className="font-semibold text-white">{transcriptReasonTitle}</p>
                          <p className="mt-1 whitespace-pre-wrap text-canvas-100">{note.transcript_reason}</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <div className="space-y-4">
                  <p className="editorial-kicker">Bilibili Archive</p>
                  <h2 className="title-display max-w-3xl">{note.title}</h2>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3 text-sm text-ink-500">
                <span className="inline-flex items-center gap-1.5">
                  <CalendarDays size={14} className="text-primary-600" />
                  {formatCreatedDate(note.created_at)}
                </span>
                <span className="text-ink-200">·</span>
                <span>AI 总结 {note.summary ? <span className="font-semibold text-sage-700">已生成</span> : <span className="text-ink-400">待生成</span>}</span>
                <span className="text-ink-200">·</span>
                <span>思维导图 {note.mindmap ? <span className="font-semibold text-sage-700">已生成</span> : <span className="text-ink-400">待生成</span>}</span>
              </div>
            </div>
        </section>

        <section className="mt-8 grid gap-8 xl:grid-cols-[1.08fr_0.92fr]">
          <div className="editorial-card p-5 sm:p-6 lg:p-8">
            <div className="flex flex-col gap-5 border-b border-ink-100 pb-6 sm:flex-row sm:items-start sm:justify-between">
              <div className="space-y-3">
                <p className="editorial-kicker">AI Workspace</p>
                <div className="flex flex-wrap items-center gap-2 rounded-full border border-ink-100 bg-white/70 p-1">
                  <button
                    onClick={() => setActiveTab("summary")}
                    className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-4 py-3 text-sm font-semibold transition-all duration-200 ${
                      activeTab === "summary"
                        ? "bg-primary-500 text-white shadow-[0_12px_24px_-18px_rgba(183,93,62,0.72)]"
                        : "text-ink-500 hover:bg-white hover:text-ink-700"
                    }`}
                  >
                    <BrainCircuit size={16} />
                    AI 总结
                  </button>
                  <button
                    onClick={() => setActiveTab("mindmap")}
                    className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-4 py-3 text-sm font-semibold transition-all duration-200 ${
                      activeTab === "mindmap"
                        ? "bg-primary-500 text-white shadow-[0_12px_24px_-18px_rgba(183,93,62,0.72)]"
                        : "text-ink-500 hover:bg-white hover:text-ink-700"
                    }`}
                  >
                    <Network size={16} />
                    思维导图
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {isLoading && (
                  <div className="editorial-chip border-primary-200 bg-primary-50 text-primary-600">
                    <Loader2 size={14} className="animate-spin" />
                    {currentProgress || "生成中..."}
                  </div>
                )}
                {!isLoading && activeTab === "summary" && note.summary && (
                  <CopyButton text={note.summary} label="复制总结" />
                )}
                {!isLoading && hasCurrentContent && (
                  <button
                    onClick={activeTab === "summary" ? handleSummarize : handleMindmap}
                    className="button-secondary"
                    title={activeTab === "summary" ? "重新生成总结" : "重新生成思维导图"}
                  >
                    <RefreshCw size={16} />
                    重新生成
                  </button>
                )}
              </div>
            </div>

            <div className="pt-8">
              {activeTab === "summary" && (
                <>
                  {note.summary ? (
                    <article className={SUMMARY_PROSE}>
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{note.summary}</ReactMarkdown>
                    </article>
                  ) : (
                    <div className="flex min-h-[320px] flex-col items-center justify-center rounded-[28px] border border-dashed border-ink-200 bg-canvas-100/50 px-6 py-12 text-center">
                      {summaryLoading ? (
                        <>
                          <div className="flex h-14 w-14 items-center justify-center rounded-full border border-primary-200 bg-primary-50 text-primary-600">
                            <Loader2 size={24} className="animate-spin" />
                          </div>
                          <p className="mt-5 font-display text-2xl font-semibold text-ink-900">正在生成 AI 总结</p>
                          <p className="mt-3 text-sm leading-7 text-ink-500">{summaryProgress || "请稍候"}</p>
                        </>
                      ) : (
                        <>
                          <div className="flex h-14 w-14 items-center justify-center rounded-full border border-ink-100 bg-white/80 text-ink-500">
                            <BrainCircuit size={24} />
                          </div>
                          <p className="mt-5 font-display text-2xl font-semibold text-ink-900">还没有总结</p>
                          <p className="mt-3 max-w-md text-sm leading-7 text-ink-500">
                            一键生成后，会把视频内容提炼成更适合快速回看和整理的摘要结构。
                          </p>
                          <button onClick={handleSummarize} className="button-primary mt-6">
                            <BrainCircuit size={16} />
                            生成 AI 总结
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </>
              )}

              {activeTab === "mindmap" && (
                <>
                  {note.mindmap ? (
                    <MermaidRenderer code={note.mindmap} onRegenerate={handleMindmap} />
                  ) : (
                    <div className="flex min-h-[320px] flex-col items-center justify-center rounded-[28px] border border-dashed border-ink-200 bg-canvas-100/50 px-6 py-12 text-center">
                      {mindmapLoading ? (
                        <>
                          <div className="flex h-14 w-14 items-center justify-center rounded-full border border-primary-200 bg-primary-50 text-primary-600">
                            <Loader2 size={24} className="animate-spin" />
                          </div>
                          <p className="mt-5 font-display text-2xl font-semibold text-ink-900">正在生成思维导图</p>
                          <p className="mt-3 text-sm leading-7 text-ink-500">{mindmapProgress || "请稍候"}</p>
                        </>
                      ) : (
                        <>
                          <div className="flex h-14 w-14 items-center justify-center rounded-full border border-ink-100 bg-white/80 text-ink-500">
                            <Network size={24} />
                          </div>
                          <p className="mt-5 font-display text-2xl font-semibold text-ink-900">还没有思维导图</p>
                          <p className="mt-3 max-w-md text-sm leading-7 text-ink-500">
                            生成后会用结构化节点串联视频的主线和重点，方便快速扫描。
                          </p>
                          <button onClick={handleMindmap} className="button-primary mt-6">
                            <Network size={16} />
                            生成思维导图
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          <div className="editorial-card p-5 sm:p-6 lg:p-8">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="editorial-kicker">Transcript Archive</p>
                <h3 className="section-display mt-2">完整转录</h3>
                <p className="mt-2 text-sm leading-7 text-ink-500">
                  保留完整原文，方便你核对细节、复制片段或继续整理。
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <CopyButton text={note.transcript} label="复制原文" />
                <button onClick={() => setExpanded((previous) => !previous)} className="button-secondary">
                  <ScrollText size={16} />
                  {expanded ? "收起" : "展开"}
                </button>
              </div>
            </div>

            <div className="mt-6 rounded-[28px] border border-ink-100/80 bg-canvas-100/50 p-4 sm:p-5">
              <div className="mb-4 flex flex-wrap items-center gap-2">
                <div className="editorial-chip">
                  <FileText size={14} />
                  Transcript
                </div>
                {transcriptSourceMeta && (
                  <div className={`inline-flex items-center rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${transcriptSourceMeta.className}`}>
                    {transcriptSourceMeta.label}
                  </div>
                )}
              </div>

              <div className="relative">
                <div
                  className={`rounded-[24px] border border-white/80 bg-paper-50/[0.88] p-4 font-mono text-sm leading-8 text-ink-600 transition-all ${
                    expanded ? "" : "max-h-[360px] overflow-hidden"
                  }`}
                >
                  {note.transcript}
                </div>
                {!expanded && (
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 rounded-b-[24px] bg-gradient-to-t from-paper-50/[0.98] to-transparent" />
                )}
              </div>
            </div>
          </div>
        </section>
      </main>

      <ErrorModal error={error} onClose={() => setError("")} />
    </div>
  );
}
