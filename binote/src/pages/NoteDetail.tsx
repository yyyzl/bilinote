import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ArrowLeft,
  CalendarDays,
  CircleHelp,
  ExternalLink,
  FileText,
  Loader2,
  RefreshCw,
} from "lucide-react";
import AppLayout from "../components/AppLayout";
import LoadingState, { LoadFailure } from "../components/LoadingState";
import PendingNotice from "../components/PendingNotice";
import * as api from "../lib/tauri";
import ErrorModal, { formatError } from "../components/ErrorModal";
import MermaidRenderer from "../components/MermaidRenderer";
import CopyButton from "../components/CopyButton";

type TabType = "summary" | "mindmap" | "transcript";
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

const POLL_INTERVAL_MS = 2000;

const TRANSCRIPT_SOURCE_META = {
  subtitle: {
    label: "官方字幕",
    className: "border-sage-200 bg-sage-100/70 text-sage-700",
  },
  asr: {
    label: "语音转写",
    className: "border-primary-200 bg-primary-50 text-primary-700",
  },
  mixed: {
    label: "混合来源",
    className: "border-gold-300 bg-gold-100/80 text-[#8e6532]",
  },
} as const;

function formatCreatedDate(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function getNoteSourceInput(note: api.Note): string {
  return (
    note.source_url?.trim() || `https://www.bilibili.com/video/${note.bvid}`
  );
}

function getOpenableSourceUrl(note: api.Note): string {
  const sourceInput = getNoteSourceInput(note);
  return /^https?:\/\//i.test(sourceInput)
    ? sourceInput
    : `https://www.bilibili.com/video/${note.bvid}`;
}

function ReaderBackLink() {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    // 限制在实际滚动范围内，避免触底/触顶回弹误判方向。
    const getScrollTop = () => Math.max(0, Math.min(
      window.scrollY,
      document.documentElement.scrollHeight - window.innerHeight,
    ));
    let previousTop = getScrollTop();
    const handleScroll = () => {
      const top = getScrollTop();
      if (top !== previousTop) {
        setVisible(top === 0 || top < previousTop);
        previousTop = top;
      }
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <Link
      to="/"
      className={`back-line reader-back-link${visible ? "" : " reader-back-link-hidden"}`}
      onFocus={() => setVisible(true)}
    >
      <ArrowLeft size={19} aria-hidden="true" />
      返回笔记库
    </Link>
  );
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
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [recoveredNoteId, setRecoveredNoteId] = useState<string | null>(null);
  const [taskRecoveryError, setTaskRecoveryError] = useState("");
  const [taskRecoveryAttempt, setTaskRecoveryAttempt] = useState(0);
  const generationLockRef = useRef(new Set<GenerateType>());
  const pollBusyRef = useRef({ summary: false, mindmap: false });
  const [generationNotice, setGenerationNotice] = useState({
    summary: "",
    mindmap: "",
  });
  const [generationStarted, setGenerationStarted] = useState<
    Partial<Record<GenerateType, number>>
  >({});
  const [cancelling, setCancelling] = useState<GenerateType | null>(null);
  const [showTranscriptReason, setShowTranscriptReason] = useState(false);

  const summaryPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mindmapPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // 当前进行中的总结 / 思维导图任务 id，用于按 task_id 过滤进度事件，避免并发串台
  const summaryTaskIdRef = useRef<string | null>(null);
  const mindmapTaskIdRef = useRef<string | null>(null);
  const isMountedRef = useRef(true);
  const routeVersionRef = useRef(0);
  const transcriptReasonRef = useRef<HTMLDivElement>(null);

  const clearPoll = useCallback((type: GenerateType) => {
    const pollRef = type === "summary" ? summaryPollRef : mindmapPollRef;
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const loadNote = useCallback(async (noteId: string) => {
    const version = routeVersionRef.current;
    try {
      const data = await api.getNote(noteId);
      if (isMountedRef.current && version === routeVersionRef.current) {
        setNote(data);
        setLoaded(true);
      }
    } catch (e) {
      if (isMountedRef.current && version === routeVersionRef.current) {
        setLoadError(formatError(e));
        setLoaded(true);
      }
    }
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    setLoaded(false);
    setLoadError("");
    generationLockRef.current.clear();
    setGenerationNotice({ summary: "", mindmap: "" });
    setCancelling(null);
    setNote(null);
    setSummaryLoading(false);
    setMindmapLoading(false);
    summaryTaskIdRef.current = null;
    mindmapTaskIdRef.current = null;
    if (id) {
      void loadNote(id);
    }

    let cleanup: (() => void) | undefined;
    let listenerCancelled = false;
    api
      .onProgress((taskId, message) => {
        if (!isMountedRef.current) return;
        // 按 task_id 匹配本页当前任务的进度（含被接管的转录自动生成阶段），
        // 忽略其它笔记的并发任务事件。转录任务可同时驱动总结和导图两侧。
        if (taskId === summaryTaskIdRef.current) {
          setSummaryProgress(message);
        }
        if (taskId === mindmapTaskIdRef.current) {
          setMindmapProgress(message);
        }
      })
      .then((fn) => {
        if (listenerCancelled) fn();
        else cleanup = fn;
      });

    return () => {
      isMountedRef.current = false;
      routeVersionRef.current += 1;
      listenerCancelled = true;
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
      if (
        target instanceof Node &&
        !transcriptReasonRef.current?.contains(target)
      ) {
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

  // 接管一个后端任务：登记 task_id（用于进度事件路由）并轮询直到终态。
  // 任务既可以是本页刚启动的，也可以是页面重建后从后端任务列表里恢复的。
  const watchTask = useCallback(
    (type: GenerateType, taskId: string) => {
      const version = routeVersionRef.current;
      const isCurrent = () =>
        isMountedRef.current && version === routeVersionRef.current;
      const config = GENERATE_CONFIG[type];
      const setLoading =
        type === "summary" ? setSummaryLoading : setMindmapLoading;
      const setProgress =
        type === "summary" ? setSummaryProgress : setMindmapProgress;
      const pollRef = type === "summary" ? summaryPollRef : mindmapPollRef;
      const taskIdRef =
        type === "summary" ? summaryTaskIdRef : mindmapTaskIdRef;

      generationLockRef.current.add(type);
      setGenerationStarted((previous) =>
        previous[type] ? previous : { ...previous, [type]: Date.now() },
      );
      taskIdRef.current = taskId;
      clearPoll(type);

      pollRef.current = setInterval(async () => {
        if (!isCurrent() || pollBusyRef.current[type]) return;
        pollBusyRef.current[type] = true;
        try {
          const taskInfo = await api.getTaskStatus(taskId);
          if (!isCurrent()) return;

          setProgress(taskInfo.progress);

          if (taskInfo.status === "completed") {
            clearPoll(type);
            taskIdRef.current = null;
            if (taskInfo.note_id) {
              const updated = await api.getNote(taskInfo.note_id);
              if (updated && isCurrent()) {
                // 每个生成任务只更新自己的产物，避免迟到的整条快照回滚并行结果。
                setNote((current) =>
                  current?.id === updated.id
                    ? {
                        ...current,
                        ...(type === "summary"
                          ? {
                              summary: updated.summary,
                              preview: updated.preview,
                            }
                          : { mindmap: updated.mindmap }),
                      }
                    : current,
                );
              }
            }
            if (isCurrent()) {
              generationLockRef.current.delete(type);
              setCancelling(null);
              setGenerationNotice((previous) => ({
                ...previous,
                [type]: type === "summary" ? "总结已更新" : "导图已更新",
              }));
              setLoading(false);
            }
          } else if (
            taskInfo.status === "failed" ||
            taskInfo.status === "cancelled"
          ) {
            clearPoll(type);
            taskIdRef.current = null;
            if (isCurrent()) {
              generationLockRef.current.delete(type);
              setCancelling(null);
              if (taskInfo.status === "cancelled")
                setGenerationNotice((previous) => ({
                  ...previous,
                  [type]: "已取消生成，原有内容已保留",
                }));
              else setError(taskInfo.error || config.defaultError);
              setLoading(false);
            }
          }
        } catch (e) {
          if (!isCurrent()) return;
          clearPoll(type);
          taskIdRef.current = null;
          if (isMountedRef.current) {
            generationLockRef.current.delete(type);
            setCancelling(null);
            setError(formatError(e));
            setLoading(false);
          }
        } finally {
          pollBusyRef.current[type] = false;
        }
      }, POLL_INTERVAL_MS);
    },
    [clearPoll],
  );

  const handleGenerate = useCallback(
    async (type: GenerateType) => {
      if (!id || recoveredNoteId !== id || generationLockRef.current.has(type))
        return;
      generationLockRef.current.add(type);
      const version = routeVersionRef.current;
      setGenerationNotice((previous) => ({ ...previous, [type]: "" }));
      setGenerationStarted((previous) => ({ ...previous, [type]: Date.now() }));
      const config = GENERATE_CONFIG[type];
      const setLoading =
        type === "summary" ? setSummaryLoading : setMindmapLoading;
      const setProgress =
        type === "summary" ? setSummaryProgress : setMindmapProgress;

      setLoading(true);
      setActiveTab(type);
      setProgress("");

      try {
        const taskId = await config.startApi(id);
        if (!isMountedRef.current || version !== routeVersionRef.current)
          return;
        watchTask(type, taskId);
      } catch (e) {
        if (isMountedRef.current && version === routeVersionRef.current) {
          generationLockRef.current.delete(type);
          setError(formatError(e));
          setLoading(false);
        }
      }
    },
    [id, recoveredNoteId, watchTask],
  );

  // 页面打开时检查后端是否已有针对本笔记的进行中任务：别处启动的总结/导图任务，
  // 或转录任务的自动生成阶段（转录完成即落盘笔记，随后同一任务继续生成总结/导图）。
  // 有则直接进入"生成中"状态并接管轮询，避免误显示"生成"按钮导致重复启动任务。
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setRecoveredNoteId(null);
    setTaskRecoveryError("");

    void (async () => {
      try {
        const [entries, config] = await Promise.all([
          api.listTasks(),
          api.getConfig(),
        ]);
        if (cancelled || !isMountedRef.current) return;

        const actives = entries.filter(
          (e) =>
            e.note_id === id &&
            (e.status === "queued" || e.status === "running"),
        );
        for (const e of actives) {
          const adoptSummary =
            e.kind === "summarize" ||
            (e.kind === "transcribe" && config.auto_summary);
          const adoptMindmap =
            e.kind === "mindmap" ||
            (e.kind === "transcribe" && config.auto_mindmap);

          if (adoptSummary && !summaryTaskIdRef.current) {
            setSummaryLoading(true);
            setSummaryProgress(e.progress);
            watchTask("summary", e.task_id);
          }
          if (adoptMindmap && !mindmapTaskIdRef.current) {
            setMindmapLoading(true);
            setMindmapProgress(e.progress);
            watchTask("mindmap", e.task_id);
          }
        }
        setRecoveredNoteId(id);
      } catch (e) {
        if (!cancelled && isMountedRef.current)
          setTaskRecoveryError(formatError(e));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [id, watchTask, taskRecoveryAttempt]);

  const handleSummarize = useCallback(() => {
    void handleGenerate("summary");
  }, [handleGenerate]);

  const handleMindmap = useCallback(() => {
    void handleGenerate("mindmap");
  }, [handleGenerate]);

  const isLoading =
    activeTab === "summary"
      ? summaryLoading
      : activeTab === "mindmap"
        ? mindmapLoading
        : false;
  const currentProgress =
    activeTab === "summary" ? summaryProgress : mindmapProgress;

  const cancelGeneration = async (type: GenerateType) => {
    const taskId =
      type === "summary" ? summaryTaskIdRef.current : mindmapTaskIdRef.current;
    if (!taskId || cancelling) return;
    const version = routeVersionRef.current;
    setCancelling(type);
    try {
      await api.cancelTask(taskId);
    } catch (e) {
      if (isMountedRef.current && version === routeVersionRef.current) {
        setCancelling(null);
        setError(formatError(e));
      }
    }
  };

  if (!note || note.id !== id) {
    const waiting = !loaded || Boolean(note && note.id !== id);
    return (
      <AppLayout reader>
        <ReaderBackLink />
        {waiting ? (
          <LoadingState kind="reader" />
        ) : (
          <div className="panel">
            <LoadFailure
              title={loadError ? "笔记暂时无法读取" : "笔记不存在或无法加载"}
              message={
                loadError
                  ? "读取没有完成，请重试。也可以返回笔记库。"
                  : "可以返回笔记库，重新打开这篇笔记。"
              }
              retryLabel="重新加载笔记"
              onRetry={() => {
                if (id) {
                  setLoaded(false);
                  setLoadError("");
                  void loadNote(id);
                }
              }}
            />
          </div>
        )}
      </AppLayout>
    );
  }

  const transcriptSourceMeta = note.transcript_source
    ? TRANSCRIPT_SOURCE_META[
        note.transcript_source as keyof typeof TRANSCRIPT_SOURCE_META
      ]
    : null;
  const sourceInput = getNoteSourceInput(note);
  const openableSourceUrl = getOpenableSourceUrl(note);
  const content =
    activeTab === "transcript"
      ? note.transcript
      : activeTab === "summary"
        ? note.summary
        : note.mindmap;
  const tabLabel =
    activeTab === "summary"
      ? "AI 总结"
      : activeTab === "transcript"
        ? "原始转录"
        : "思维导图";
  const headings = (note.summary ?? "").split("\n").flatMap((line, index) => {
    const match = /^#{1,3}\s+(.+)$/.exec(line);
    return match
      ? [{ line: index + 1, text: match[1].replace(/[*_`]/g, "") }]
      : [];
  });
  const actions = (
    <>
      {content && (
        <CopyButton
          text={content}
          label={
            activeTab === "transcript"
              ? "复制原文"
              : activeTab === "summary"
                ? "复制总结"
                : "复制导图源码"
          }
        />
      )}
      {activeTab !== "transcript" && (
        <button
          className="button-secondary"
          disabled={isLoading || recoveredNoteId !== id}
          onClick={activeTab === "summary" ? handleSummarize : handleMindmap}
        >
          {isLoading ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <RefreshCw size={16} />
          )}
          {isLoading ? "生成中" : content ? "重新生成" : "立即生成"}
        </button>
      )}
    </>
  );

  return (
    <AppLayout reader>
      <ReaderBackLink />
      <header className="note-heading">
        <div className="min-w-0">
          <h1>{note.title}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-ink-400">
            <span>B站视频</span>
            <span>·</span>
            <time>{formatCreatedDate(note.created_at)}</time>
            {transcriptSourceMeta && (
              <div className="relative" ref={transcriptReasonRef}>
                <button
                  className="inline-flex items-center gap-1 rounded bg-canvas-100 px-2 py-0.5 text-xs text-ink-500"
                  disabled={!note.transcript_reason}
                  aria-expanded={showTranscriptReason}
                  onClick={() => setShowTranscriptReason((value) => !value)}
                >
                  {transcriptSourceMeta.label}
                  {note.transcript_reason && <CircleHelp size={13} />}
                </button>
                {showTranscriptReason && note.transcript_reason && (
                  <div className="absolute left-0 top-full z-10 mt-2 w-60 rounded-lg border border-ink-100 bg-white p-4 text-xs leading-6 text-ink-600 shadow-soft">
                    {note.transcript_reason}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
        <a
          href={openableSourceUrl}
          target="_blank"
          rel="noreferrer"
          className="button-secondary"
        >
          <ExternalLink size={17} />
          打开源视频
        </a>
      </header>
      <div className="content-tabs" role="tablist" aria-label="笔记内容">
        {(
          [
            { id: "summary", label: "AI 总结" },
            { id: "transcript", label: "原始转录" },
            { id: "mindmap", label: "思维导图" },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            id={`tab-${tab.id}`}
            role="tab"
            aria-controls="note-content"
            aria-selected={activeTab === tab.id}
            className="content-tab"
            tabIndex={activeTab === tab.id ? 0 : -1}
            onKeyDown={(event) => {
              const tabs: TabType[] = ["summary", "transcript", "mindmap"];
              const index = tabs.indexOf(activeTab);
              const target =
                event.key === "ArrowRight"
                  ? tabs[(index + 1) % tabs.length]
                  : event.key === "ArrowLeft"
                    ? tabs[(index + tabs.length - 1) % tabs.length]
                    : event.key === "Home"
                      ? tabs[0]
                      : event.key === "End"
                        ? tabs[tabs.length - 1]
                        : null;
              if (target) {
                event.preventDefault();
                setActiveTab(target);
                document.getElementById(`tab-${target}`)?.focus();
              }
            }}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {taskRecoveryError ? (
        <LoadFailure
          title="后台任务暂时无法恢复"
          message="请重新读取任务状态后再生成，已有内容仍可阅读。"
          retryLabel="重新读取任务"
          onRetry={() => setTaskRecoveryAttempt((attempt) => attempt + 1)}
        />
      ) : (
        recoveredNoteId !== id && (
          <p role="status" className="mb-4 text-sm text-ink-500">
            正在恢复后台任务，恢复后即可生成新内容。
          </p>
        )
      )}
      <div className={activeTab === "mindmap" ? "min-w-0" : "reader-layout"}>
        <section
          key={activeTab}
          aria-busy={isLoading}
          className="reader-panel panel"
          id="note-content"
          role="tabpanel"
          tabIndex={0}
          aria-labelledby={`tab-${activeTab}`}
        >
          <div className="reader-toolbar">
            <h2>{tabLabel}</h2>
            <div className="reader-actions flex gap-2">{actions}</div>
          </div>
          {isLoading && (
            <PendingNotice
              message={(currentProgress || "正在生成，请稍候…").slice(0, 180)}
              startedAt={
                activeTab === "summary"
                  ? generationStarted.summary
                  : generationStarted.mindmap
              }
              onCancel={() =>
                void cancelGeneration(
                  activeTab === "summary" ? "summary" : "mindmap",
                )
              }
              cancelling={cancelling !== null}
            />
          )}
          {!isLoading &&
            activeTab !== "transcript" &&
            generationNotice[activeTab] && (
              <p role="status" className="success-notice">
                {generationNotice[activeTab]}
              </p>
            )}
          {isLoading && !content && (
            <div aria-hidden="true" className="min-h-[290px] space-y-6 py-7">
              {["w-1/3", "w-full", "w-5/6", "w-full", "w-2/3"].map(
                (width, index) => (
                  <div key={index} className={`skeleton-line ${width}`} />
                ),
              )}
            </div>
          )}
          {activeTab === "summary" && note.summary && (
            <article className="summary-content">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  h1: ({ node, ...props }) => (
                    <h2
                      id={`reader-section-${node?.position?.start.line}`}
                      {...props}
                    />
                  ),
                  h2: ({ node, ...props }) => (
                    <h2
                      id={`reader-section-${node?.position?.start.line}`}
                      {...props}
                    />
                  ),
                  h3: ({ node, ...props }) => (
                    <h3
                      id={`reader-section-${node?.position?.start.line}`}
                      {...props}
                    />
                  ),
                }}
              >
                {note.summary}
              </ReactMarkdown>
            </article>
          )}
          {activeTab === "transcript" && (
            <>
              <p className="mb-6 text-xs text-ink-400">
                {transcriptSourceMeta?.label ?? "转录文本"} ·{" "}
                {note.transcript.length.toLocaleString("zh-CN")} 字
              </p>
              <div className="transcript-copy">{note.transcript}</div>
              {note.transcript_reason && (
                <div className="mt-8 rounded-lg bg-canvas-50 p-4 text-sm leading-7 text-ink-500">
                  <strong className="font-medium text-ink-700">
                    转录来源说明
                  </strong>
                  <p className="whitespace-pre-wrap">
                    {note.transcript_reason}
                  </p>
                </div>
              )}
            </>
          )}
          {activeTab === "mindmap" && note.mindmap && (
            <MermaidRenderer
              code={note.mindmap}
              onRegenerate={recoveredNoteId === id ? handleMindmap : undefined}
            />
          )}
          {!content && !isLoading && (
            <div className="flex min-h-[380px] flex-col items-center justify-center gap-4 text-center">
              <h3 className="text-2xl font-semibold">
                {activeTab === "transcript"
                  ? "暂无转录内容"
                  : `还没有${tabLabel}`}
              </h3>
              <p className="max-w-sm text-sm leading-7 text-ink-500">
                {activeTab === "transcript"
                  ? "这篇笔记暂时没有可用的转录文本。"
                  : "根据已有转录整理内容，生成后可以随时回来阅读。"}
              </p>
              {activeTab !== "transcript" && (
                <button
                  className="button-primary"
                  disabled={recoveredNoteId !== id}
                  onClick={
                    activeTab === "summary" ? handleSummarize : handleMindmap
                  }
                >
                  生成{tabLabel}
                </button>
              )}
            </div>
          )}
          {activeTab !== "transcript" && content && (
            <p className="mt-8 border-t border-ink-100 pt-4 text-xs text-ink-400">
              AI 生成内容，建议结合原始转录核对。
            </p>
          )}
        </section>
        {activeTab !== "mindmap" && (
          <aside className="reader-toc panel">
            {activeTab === "summary" && headings.length > 0 && (
              <>
                <h2 className="mb-4 text-xl font-semibold">本页目录</h2>
                <nav aria-label="本页目录" className="mb-6">
                  {headings.map((heading) => (
                    <button
                      key={heading.line}
                      className="block w-full border-l-2 border-ink-100 py-2 pl-4 text-left text-sm leading-6 text-ink-500 hover:border-primary-300 hover:text-primary-700"
                      onClick={() =>
                        document
                          .getElementById(`reader-section-${heading.line}`)
                          ?.scrollIntoView({
                            behavior: window.matchMedia(
                              "(prefers-reduced-motion: reduce)",
                            ).matches
                              ? "auto"
                              : "smooth",
                            block: "start",
                          })
                      }
                    >
                      {heading.text}
                    </button>
                  ))}
                </nav>
              </>
            )}
            <h3 className="mb-4 text-base font-semibold">笔记信息</h3>
            <p className="flex items-center gap-2 text-sm text-ink-400">
              <CalendarDays size={16} />
              {formatCreatedDate(note.created_at)}
            </p>
            <p className="mt-4 flex items-center gap-2 text-sm text-ink-400">
              <FileText size={16} />
              {note.transcript.length.toLocaleString("zh-CN")} 字转录
            </p>
            <div className="mt-6 border-t border-ink-100 pt-4">
              <p className="break-all text-xs leading-6 text-ink-400">
                {sourceInput}
              </p>
              <CopyButton
                text={sourceInput}
                label="复制链接"
                className="button-tertiary mt-2 !px-0"
              />
            </div>
          </aside>
        )}
      </div>
      <div className="mobile-reading-actions">
        {actions}
        <a
          href={openableSourceUrl}
          target="_blank"
          rel="noreferrer"
          aria-label="打开源视频"
          className="icon-button"
        >
          <ExternalLink size={19} />
        </a>
      </div>
      <ErrorModal error={error} onClose={() => setError("")} />
    </AppLayout>
  );
}
