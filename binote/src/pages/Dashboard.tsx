import { useState, useEffect, useRef, useCallback } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  Check,
  CheckSquare,
  Clock3,
  FileText,
  Link as LinkIcon,
  Loader2,
  NotebookText,
  Search,
  Settings,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import * as api from "../lib/tauri";
import ErrorModal, { formatError } from "../components/ErrorModal";
import ConfirmModal from "../components/ConfirmModal";
import { useShare } from "../contexts/ShareContext";

function formatNoteDate(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function buildExcerpt(note: api.Note): string {
  const source = note.summary ?? note.transcript;
  return source.replace(/\s+/g, " ").trim().slice(0, 120);
}

export default function Dashboard() {
  const [input, setInput] = useState("");
  const [notes, setNotes] = useState<api.Note[]>([]);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; title: string } | null>(null);

  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchDeleteConfirm, setBatchDeleteConfirm] = useState(false);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTouchRef = useRef(false);
  const touchStartPosRef = useRef<{ x: number; y: number } | null>(null);
  const isLongPressActiveRef = useRef(false);

  const { pendingUrl, consumeShare, isProcessing, setIsProcessing } = useShare();
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const successTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMountedRef = useRef(true);
  const loadingRef = useRef(loading);
  loadingRef.current = loading;

  const loadNotes = useCallback(async () => {
    try {
      const data = await api.getNotes();
      if (isMountedRef.current) {
        setNotes(data);
      }
    } catch (e) {
      console.error(e);
    }
  }, []);

  const clearAllTimers = useCallback(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    if (successTimeoutRef.current) {
      clearTimeout(successTimeoutRef.current);
      successTimeoutRef.current = null;
    }
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  const startTranscription = useCallback(
    async (url: string) => {
      if (loadingRef.current) return;

      setInput(url);
      setLoading(true);
      setIsProcessing(true);
      setError("");
      setProgress("正在连接 Bilibili...");

      try {
        const bvid = await api.parseLink(url);
        const taskId = await api.startTranscribe(bvid);
        clearAllTimers();

        pollIntervalRef.current = setInterval(async () => {
          if (!isMountedRef.current) {
            clearAllTimers();
            return;
          }

          try {
            const taskInfo = await api.getTaskStatus(taskId);
            if (!isMountedRef.current) return;

            setProgress(taskInfo.progress);

            if (taskInfo.status === "completed") {
              clearAllTimers();
              await loadNotes();
              if (!isMountedRef.current) return;

              setInput("");
              setProgress("完成，已归档到笔记库。");
              successTimeoutRef.current = setTimeout(() => {
                if (isMountedRef.current) {
                  setProgress("");
                }
                successTimeoutRef.current = null;
              }, 2000);
              setLoading(false);
              setIsProcessing(false);
            } else if (taskInfo.status === "failed" || taskInfo.status === "cancelled") {
              clearAllTimers();
              if (isMountedRef.current) {
                setError(taskInfo.error || "转写失败");
                setLoading(false);
                setIsProcessing(false);
              }
            }
          } catch (e) {
            clearAllTimers();
            if (isMountedRef.current) {
              setError(formatError(e));
              setLoading(false);
              setIsProcessing(false);
            }
          }
        }, 2000);
      } catch (e: unknown) {
        if (isMountedRef.current) {
          setError(formatError(e));
          setLoading(false);
          setIsProcessing(false);
        }
      }
    },
    [clearAllTimers, loadNotes, setIsProcessing]
  );

  useEffect(() => {
    isMountedRef.current = true;
    loadNotes();

    let cleanup: (() => void) | undefined;
    api.onProgress((msg) => {
      if (isMountedRef.current) {
        setProgress(msg);
      }
    }).then((fn) => {
      cleanup = fn;
    });

    return () => {
      isMountedRef.current = false;
      cleanup?.();
      clearAllTimers();
    };
  }, [loadNotes, clearAllTimers]);

  useEffect(() => {
    if (pendingUrl && !loading) {
      const url = consumeShare();
      if (url) {
        void startTranscription(url);
      }
    }
  }, [pendingUrl, loading, consumeShare, startTranscription]);

  const handleSubmit = async () => {
    if (!input.trim()) return;
    await startTranscription(input);
  };

  const handleDeleteClick = (note: api.Note, event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setDeleteTarget({ id: note.id, title: note.title });
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;

    try {
      await api.deleteNote(deleteTarget.id);
      await loadNotes();
    } catch (e) {
      console.error(e);
    } finally {
      setDeleteTarget(null);
    }
  };

  const clearLongPressTimer = () => {
    isLongPressActiveRef.current = false;
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const exitSelectionMode = useCallback(() => {
    setSelectionMode(false);
    setSelectedIds(new Set());
    clearLongPressTimer();
  }, []);

  useEffect(() => {
    if (!selectionMode) return;

    window.history.pushState({ selectionMode: true }, "");

    const handlePopState = () => {
      exitSelectionMode();
    };

    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, [selectionMode, exitSelectionMode]);

  const startLongPressTimer = (noteId: string) => {
    clearLongPressTimer();
    isLongPressActiveRef.current = true;
    longPressTimerRef.current = setTimeout(() => {
      setSelectionMode(true);
      setSelectedIds(new Set([noteId]));
      isLongPressActiveRef.current = false;
    }, 500);
  };

  const handleTouchStart = (noteId: string, event: React.TouchEvent) => {
    if (selectionMode) return;
    isTouchRef.current = true;
    const touch = event.touches[0];
    touchStartPosRef.current = { x: touch.clientX, y: touch.clientY };
    startLongPressTimer(noteId);
  };

  const handleTouchMove = (event: React.TouchEvent) => {
    if (!touchStartPosRef.current) return;
    if (isLongPressActiveRef.current) {
      event.preventDefault();
    }

    const touch = event.touches[0];
    const deltaX = Math.abs(touch.clientX - touchStartPosRef.current.x);
    const deltaY = Math.abs(touch.clientY - touchStartPosRef.current.y);
    if (deltaX > 20 || deltaY > 20) {
      clearLongPressTimer();
      touchStartPosRef.current = null;
    }
  };

  const handleTouchEnd = () => {
    clearLongPressTimer();
    touchStartPosRef.current = null;
    setTimeout(() => {
      isTouchRef.current = false;
    }, 300);
  };

  const handleMouseDown = (noteId: string) => {
    if (selectionMode || isTouchRef.current) return;
    startLongPressTimer(noteId);
  };

  const handleMouseUp = () => {
    if (isTouchRef.current) return;
    clearLongPressTimer();
  };

  const handleMouseLeave = () => {
    if (isTouchRef.current) return;
    clearLongPressTimer();
  };

  const toggleSelect = (noteId: string) => {
    setSelectedIds((previous) => {
      const next = new Set(previous);
      if (next.has(noteId)) {
        next.delete(noteId);
      } else {
        next.add(noteId);
      }
      return next;
    });
  };

  const handleSelectAll = () => {
    setSelectedIds(new Set(notes.map((note) => note.id)));
  };

  const handleBatchDeleteConfirm = async () => {
    try {
      for (const id of selectedIds) {
        await api.deleteNote(id);
      }
      await loadNotes();
    } catch (e) {
      console.error(e);
    } finally {
      setBatchDeleteConfirm(false);
      exitSelectionMode();
    }
  };

  const handleCardClick = (event: React.MouseEvent, noteId: string) => {
    if (selectionMode) {
      event.preventDefault();
      toggleSelect(noteId);
    }
  };

  const noteCount = notes.length;
  const summaryCount = notes.filter((note) => note.summary).length;
  const mindmapCount = notes.filter((note) => note.mindmap).length;
  const latestNote = notes[0];

  return (
    <div className="app-shell">
      <header className="floating-topbar">
        <div className="topbar-inner">
          <div className="flex min-w-0 flex-1 items-center gap-4">
            <div className="min-w-0">
              <p className="editorial-kicker">Bilibili Note Studio</p>
              <h1 className="truncate font-display text-2xl font-semibold leading-tight text-ink-900">
                BiNote
              </h1>
            </div>
          </div>

          <div className="hidden items-center gap-2 md:flex">
            <div className="editorial-chip">
              <span className="h-2 w-2 rounded-full bg-sage-500" />
              内容转写工作台
            </div>
          </div>

          <Link to="/settings" className="button-secondary min-h-11 !px-4" aria-label="打开设置页面">
            <Settings size={18} />
            <span className="hidden sm:inline">设置</span>
          </Link>
        </div>
      </header>

      {selectionMode && (
        <div className="fixed left-4 right-4 top-[calc(env(safe-area-inset-top)+6rem)] z-30 mx-auto max-w-4xl rounded-full border border-ink-200 bg-paper-50/[0.94] px-4 py-3 shadow-soft backdrop-blur-md sm:px-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full border border-primary-200 bg-primary-50 text-primary-600">
                <CheckSquare size={18} />
              </div>
              <div>
                <p className="text-sm font-semibold text-ink-800">已选择 {selectedIds.size} 条笔记</p>
                <p className="text-xs text-ink-400">长按进入，多选后可以批量删除。</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button onClick={handleSelectAll} className="button-secondary min-h-10 !px-4 !py-2">
                全选
              </button>
              <button onClick={exitSelectionMode} className="button-tertiary min-h-10 !px-4 !py-2">
                <X size={16} />
                取消
              </button>
              <button
                onClick={() => setBatchDeleteConfirm(true)}
                disabled={selectedIds.size === 0}
                className="inline-flex min-h-10 items-center justify-center gap-2 rounded-full border border-red-200 bg-red-50 px-4 py-2 text-sm font-semibold text-red-600 transition-colors duration-200 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Trash2 size={16} />
                删除
              </button>
            </div>
          </div>
        </div>
      )}

      <main className={`page-shell ${selectionMode ? "mt-[calc(var(--navbar-total-height)+5.5rem)]" : "mt-header-offset"} pt-6 sm:pt-8`}>
        <section className="hero-panel ghost-overlay">
          <div className="surface-grid p-6 sm:p-8 lg:p-10">
            <div className="space-y-8">
              <div className="space-y-4">
                  <p className="editorial-kicker">Turn videos into readable notes</p>
                  <h2 className="title-display max-w-3xl">
                    把 B 站内容
                    <br />
                    变成一份真正值得阅读的笔记。
                  </h2>
                  <p className="max-w-2xl text-base leading-8 text-ink-500 sm:text-lg">
                    粘贴链接后，BiNote 会自动转录、整理、总结，并把内容归档成适合回看和复盘的阅读单元。
                  </p>
              </div>

              <div className="editorial-card p-4 sm:p-5">
                <div className="flex flex-col gap-4">
                  <div className="space-y-2">
                    <label htmlFor="video-link" className="editorial-kicker">
                      Video Link
                    </label>
                    <div className="relative">
                      <div className="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 text-ink-300">
                        <LinkIcon size={18} />
                      </div>
                      <input
                        id="video-link"
                        type="text"
                        value={input}
                        onChange={(event) => setInput(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            void handleSubmit();
                          }
                        }}
                        placeholder="粘贴 B 站视频链接，例如 https://www.bilibili.com/video/BV..."
                        className="input-shell pl-12 pr-5"
                        disabled={loading}
                      />
                    </div>
                  </div>

                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-sm leading-7 text-ink-500">
                      支持直接粘贴链接，也支持 Android 分享到应用后自动开始处理。
                    </p>
                    <button
                      onClick={() => void handleSubmit()}
                      disabled={loading || !input.trim()}
                      className="button-primary sm:min-w-[168px]"
                    >
                      {loading ? <Loader2 size={16} className="animate-spin" /> : <ArrowRight size={16} />}
                      {loading ? "处理中" : "开始解析"}
                    </button>
                  </div>
                </div>
              </div>

              {(loading || progress || error) && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="editorial-card-muted p-4">
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5 flex h-10 w-10 items-center justify-center rounded-full border border-primary-200 bg-primary-50 text-primary-600">
                        {loading ? <Loader2 size={18} className="animate-spin" /> : <Sparkles size={18} />}
                      </div>
                      <div className="min-w-0">
                        <p className="editorial-kicker">Task Status</p>
                        <p className="mt-2 text-sm font-semibold text-ink-800">
                          {progress || (loading ? "正在处理中..." : "等待下一次操作")}
                        </p>
                        <p className="mt-2 text-xs leading-6 text-ink-400">
                          {isProcessing ? "当前正在后台处理新的分享或转录任务。" : "当前没有进行中的后台任务。"}
                        </p>
                      </div>
                    </div>
                  </div>

                  {error && (
                    <button
                      onClick={() => setError(error)}
                      className="editorial-card-muted flex cursor-pointer items-start gap-3 border-red-100 bg-red-50/70 p-4 text-left transition-colors duration-200 hover:bg-red-50"
                    >
                      <div className="mt-0.5 h-3 w-3 rounded-full bg-red-500" />
                      <div>
                        <p className="editorial-kicker text-red-500">Action Required</p>
                        <p className="mt-2 text-sm font-semibold text-red-700">出现错误，点击查看详情</p>
                      </div>
                    </button>
                  )}
                </div>
              )}
            </div>

            <div className="grid gap-4">
              {latestNote && (
                <Link to={`/note/${latestNote.id}`} className="editorial-card-muted overflow-hidden block transition-colors duration-200 hover:bg-canvas-100/80">
                  <div className="space-y-3 p-5">
                    <p className="editorial-kicker">Latest Entry</p>
                    <h3 className="font-display text-2xl font-semibold leading-tight text-ink-900">
                      {latestNote.title}
                    </h3>
                    <p className="text-sm leading-7 text-ink-500">{buildExcerpt(latestNote)}...</p>
                  </div>
                </Link>
              )}

              <details className="group/details">
                <summary className="editorial-card-muted flex cursor-pointer list-none items-center justify-between p-4 transition-colors duration-200 hover:bg-canvas-100/80 [&::-webkit-details-marker]:hidden">
                  <div className="flex items-center gap-3">
                    <p className="editorial-kicker">统计 &amp; 使用指南</p>
                    <div className="flex items-center gap-2 text-xs text-ink-400">
                      <span>{noteCount} 笔记</span>
                      <span>·</span>
                      <span>{summaryCount} 总结</span>
                      <span>·</span>
                      <span>{mindmapCount} 导图</span>
                    </div>
                  </div>
                  <ArrowRight size={14} className="text-ink-400 transition-transform duration-200 group-open/details:rotate-90" />
                </summary>
                <div className="space-y-4 px-4 pb-4 pt-2">
                  <div className="grid grid-cols-3 gap-3">
                    <div className="metric-block">
                      <p className="text-xs uppercase tracking-[0.2em] text-ink-400">笔记</p>
                      <p className="mt-3 font-display text-3xl leading-none text-ink-900">{noteCount}</p>
                    </div>
                    <div className="metric-block">
                      <p className="text-xs uppercase tracking-[0.2em] text-ink-400">总结</p>
                      <p className="mt-3 font-display text-3xl leading-none text-ink-900">{summaryCount}</p>
                    </div>
                    <div className="metric-block">
                      <p className="text-xs uppercase tracking-[0.2em] text-ink-400">导图</p>
                      <p className="mt-3 font-display text-3xl leading-none text-ink-900">{mindmapCount}</p>
                    </div>
                  </div>

                  <div className="divider-soft" />

                  <div className="space-y-3">
                    <p className="editorial-kicker">Workflow</p>
                    <div className="flex items-start gap-3">
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-ink-200 bg-white/70 text-xs font-semibold text-ink-700">
                        1
                      </div>
                      <p className="text-sm leading-6 text-ink-500">
                        <span className="font-semibold text-ink-800">贴入视频链接</span> — 支持手动粘贴和 Android 系统分享。
                      </p>
                    </div>
                    <div className="flex items-start gap-3">
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-ink-200 bg-white/70 text-xs font-semibold text-ink-700">
                        2
                      </div>
                      <p className="text-sm leading-6 text-ink-500">
                        <span className="font-semibold text-ink-800">自动转录与总结</span> — 优先字幕，必要时回退 ASR。
                      </p>
                    </div>
                    <div className="flex items-start gap-3">
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-ink-200 bg-white/70 text-xs font-semibold text-ink-700">
                        3
                      </div>
                      <p className="text-sm leading-6 text-ink-500">
                        <span className="font-semibold text-ink-800">沉淀为笔记资产</span> — 统一沉淀为可阅读、可复盘的笔记库。
                      </p>
                    </div>
                  </div>
                </div>
              </details>
            </div>
          </div>
        </section>

        <ErrorModal error={error} onClose={() => setError("")} />
        <ConfirmModal
          open={batchDeleteConfirm}
          title="批量删除"
          message={`确定要删除选中的 ${selectedIds.size} 个笔记吗？此操作无法撤销。`}
          confirmText="删除"
          cancelText="取消"
          variant="danger"
          onConfirm={handleBatchDeleteConfirm}
          onCancel={() => setBatchDeleteConfirm(false)}
        />
        <ConfirmModal
          open={!!deleteTarget}
          title="删除笔记"
          message={`确定要删除「${deleteTarget?.title || ""}」吗？此操作无法撤销。`}
          confirmText="删除"
          cancelText="取消"
          variant="danger"
          onConfirm={handleDeleteConfirm}
          onCancel={() => setDeleteTarget(null)}
        />

        <section className="mt-10 space-y-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="editorial-kicker">Note Library</p>
              <h2 className="section-display mt-2">我的笔记库</h2>
              <p className="mt-2 max-w-2xl text-sm leading-7 text-ink-500">
                每条记录都保留原始转录、AI 总结和思维导图，方便回看、复盘和继续整理。
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="editorial-chip">
                <NotebookText size={14} />
                {noteCount} 篇记录
              </div>
              {selectionMode && (
                <div className="editorial-chip border-primary-200 bg-primary-50 text-primary-600">
                  <CheckSquare size={14} />
                  多选模式
                </div>
              )}
            </div>
          </div>

          {noteCount === 0 ? (
            <div className="editorial-card flex min-h-[320px] flex-col items-center justify-center px-6 py-12 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-full border border-ink-100 bg-white/70 text-ink-400">
                <Search size={28} />
              </div>
              <p className="mt-6 font-display text-2xl font-semibold text-ink-900">还没有笔记</p>
              <p className="mt-3 max-w-md text-sm leading-7 text-ink-500">
                从上方贴入一个 B 站链接开始。生成后的内容会自动沉淀到这里，形成你的个人内容档案。
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
              {notes.map((note) => {
                const isSelected = selectedIds.has(note.id);
                const summaryReady = Boolean(note.summary);
                const mindmapReady = Boolean(note.mindmap);

                return (
                  <Link
                    key={note.id}
                    to={selectionMode ? "#" : `/note/${note.id}`}
                    onClick={(event) => handleCardClick(event, note.id)}
                    onMouseDown={() => handleMouseDown(note.id)}
                    onMouseUp={handleMouseUp}
                    onMouseLeave={handleMouseLeave}
                    onTouchStart={(event) => handleTouchStart(note.id, event)}
                    onTouchMove={handleTouchMove}
                    onTouchEnd={handleTouchEnd}
                    onTouchCancel={handleTouchEnd}
                    onContextMenu={(event) => event.preventDefault()}
                    style={{ touchAction: "manipulation" }}
                    className={`group relative flex h-full cursor-pointer flex-col overflow-hidden rounded-[28px] border bg-paper-50/[0.9] shadow-soft ring-1 ring-white/70 transition-all duration-300 ${
                      selectionMode && isSelected
                        ? "border-primary-300 bg-primary-50/40"
                        : "border-ink-100/80 hover:-translate-y-1.5 hover:shadow-panel"
                    }`}
                  >
                    <div className="flex flex-1 flex-col gap-4 p-5">
                      <div className={`flex items-center justify-between ${selectionMode ? "" : ""}`}>
                        <span className="rounded-full border border-ink-100 bg-canvas-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-600">
                          {formatNoteDate(note.created_at)}
                        </span>
                        <div className="flex items-center gap-2">
                          {selectionMode && (
                            <div
                              className={`flex h-7 w-7 items-center justify-center rounded-full border transition-all ${
                                isSelected
                                  ? "border-primary-500 bg-primary-500 text-white"
                                  : "border-ink-200 bg-paper-50/90 text-transparent"
                              }`}
                            >
                              <Check size={15} strokeWidth={3} />
                            </div>
                          )}
                          {!selectionMode && (
                            <button
                              onClick={(event) => handleDeleteClick(note, event)}
                              className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-ink-100 bg-canvas-50 text-ink-400 transition-colors duration-200 hover:bg-red-50 hover:text-red-600"
                              title="删除笔记"
                              aria-label={`删除笔记 ${note.title}`}
                            >
                              <Trash2 size={14} />
                            </button>
                          )}
                        </div>
                      </div>
                      <div className="space-y-3">
                        <div className="flex flex-wrap gap-2">
                          <span className="editorial-chip !px-2.5 !py-1 !text-[10px] !tracking-[0.2em]">
                            <Clock3 size={12} />
                            Archive
                          </span>
                          {summaryReady && (
                            <span className="rounded-full border border-sage-200 bg-sage-100/70 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-sage-700">
                              AI 总结
                            </span>
                          )}
                          {mindmapReady && (
                            <span className="rounded-full border border-gold-300 bg-gold-100/70 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-[#8e6532]">
                              思维导图
                            </span>
                          )}
                        </div>

                        <h3 className="font-display text-xl font-semibold leading-tight tracking-[-0.03em] text-ink-900 transition-colors duration-200 group-hover:text-primary-700">
                          {note.title}
                        </h3>
                        <p className="text-sm leading-7 text-ink-500">
                          {buildExcerpt(note)}
                          ...
                        </p>
                      </div>

                      <div className="mt-auto">
                        <div className="divider-soft" />
                        <div className="mt-4 flex items-center justify-between text-sm text-ink-400">
                          <div className="flex items-center gap-2">
                            <FileText size={15} />
                            <span>查看详情</span>
                          </div>
                          <div className="flex items-center gap-2 text-ink-600 transition-transform duration-200 group-hover:translate-x-1">
                            <span className="font-semibold">Open</span>
                            <ArrowRight size={16} />
                          </div>
                        </div>
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
