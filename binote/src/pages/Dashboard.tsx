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
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";
import * as api from "../lib/tauri";
import ErrorModal, { formatError } from "../components/ErrorModal";
import ConfirmModal from "../components/ConfirmModal";
import { useShare } from "../contexts/ShareContext";

type TaskStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

interface ActiveTask {
  taskId: string;
  bvid: string;
  url: string;
  title: string;
  progress: string;
  status: TaskStatus;
  error?: string | null;
}

const POLL_INTERVAL_MS = 2000;
// 终态任务在列表里停留多久后自动消失（毫秒）
const AUTO_REMOVE_MS = { completed: 4000, cancelled: 2500 } as const;

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

function getNoteSourceUrl(note: api.Note): string {
  return note.source_url?.trim() || `https://www.bilibili.com/video/${note.bvid}`;
}

export default function Dashboard() {
  const [input, setInput] = useState("");
  const [notes, setNotes] = useState<api.Note[]>([]);
  const [tasks, setTasks] = useState<ActiveTask[]>([]);
  const [error, setError] = useState("");
  const [hint, setHint] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; title: string } | null>(null);

  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchDeleteConfirm, setBatchDeleteConfirm] = useState(false);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTouchRef = useRef(false);
  const touchStartPosRef = useRef<{ x: number; y: number } | null>(null);
  const isLongPressActiveRef = useRef(false);

  const { pendingUrls, consumeShares, setIsProcessing } = useShare();
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hintTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const removeTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const isMountedRef = useRef(true);
  // 镜像最新 tasks，供轮询闭包读取（避免闭包捕获旧值）
  const tasksRef = useRef<ActiveTask[]>([]);
  tasksRef.current = tasks;
  // 同步登记"正在提交中"的 bvid，覆盖"去重检查 → 入队"之间的异步窗口（TOCTOU），
  // 防止分享队列一次性并发回放多条相同链接造成重复入队。
  const inFlightBvidsRef = useRef<Set<string>>(new Set());

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

  const patchTask = useCallback((taskId: string, patch: Partial<ActiveTask>) => {
    setTasks((prev) =>
      prev.map((t) => (t.taskId === taskId ? { ...t, ...patch } : t))
    );
  }, []);

  const removeTask = useCallback((taskId: string) => {
    setTasks((prev) => prev.filter((t) => t.taskId !== taskId));
    const timer = removeTimersRef.current.get(taskId);
    if (timer) {
      clearTimeout(timer);
      removeTimersRef.current.delete(taskId);
    }
  }, []);

  const scheduleRemove = useCallback(
    (taskId: string, delay: number) => {
      if (removeTimersRef.current.has(taskId)) return;
      const timer = setTimeout(() => {
        removeTimersRef.current.delete(taskId);
        if (isMountedRef.current) {
          setTasks((prev) => prev.filter((t) => t.taskId !== taskId));
        }
      }, delay);
      removeTimersRef.current.set(taskId, timer);
    },
    []
  );

  const ensurePolling = useCallback(() => {
    if (pollIntervalRef.current) return;
    pollIntervalRef.current = setInterval(async () => {
      const active = tasksRef.current.filter(
        (t) => t.status === "queued" || t.status === "running"
      );
      if (active.length === 0) {
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
        }
        return;
      }

      await Promise.all(
        active.map(async (t) => {
          try {
            const info = await api.getTaskStatus(t.taskId);
            if (!isMountedRef.current) return;

            if (info.status === "completed") {
              await loadNotes();
              if (!isMountedRef.current) return;
              patchTask(t.taskId, {
                status: "completed",
                progress: "已完成",
                error: info.error ?? null,
              });
              scheduleRemove(t.taskId, AUTO_REMOVE_MS.completed);
            } else if (info.status === "failed") {
              patchTask(t.taskId, {
                status: "failed",
                progress: "失败",
                error: info.error ?? "转写失败",
              });
            } else if (info.status === "cancelled") {
              patchTask(t.taskId, {
                status: "cancelled",
                progress: "已取消",
                error: info.error ?? null,
              });
              scheduleRemove(t.taskId, AUTO_REMOVE_MS.cancelled);
            } else {
              // queued / running：只同步状态；进度文本主要靠 onProgress 事件实时推送
              patchTask(t.taskId, { status: info.status as TaskStatus });
            }
          } catch (e) {
            // 单个任务查询失败不影响其它任务
            console.error(e);
          }
        })
      );
    }, POLL_INTERVAL_MS);
  }, [loadNotes, patchTask, scheduleRemove]);

  const startTranscription = useCallback(
    async (url: string) => {
      const trimmed = url.trim();
      if (!trimmed) return;

      setError("");
      let bvid: string | undefined;
      try {
        const resolved = await api.parseLink(trimmed);
        bvid = resolved;

        // 去重：同一视频若已在队列中（未结束）或正在提交中，不重复入队。
        // inFlightBvidsRef 覆盖"检查 → 入队"之间的异步窗口，防止并发回放重复提交。
        const existing = tasksRef.current.find(
          (t) => t.bvid === resolved && (t.status === "queued" || t.status === "running")
        );
        if (existing || inFlightBvidsRef.current.has(resolved)) {
          setHint(`「${existing?.title ?? resolved}」已在处理队列中`);
          if (hintTimeoutRef.current) clearTimeout(hintTimeoutRef.current);
          hintTimeoutRef.current = setTimeout(() => {
            if (isMountedRef.current) setHint("");
          }, 2500);
          return;
        }
        // 同步占位（紧跟检查、无 await），抢占该 bvid 的提交权
        inFlightBvidsRef.current.add(resolved);

        const taskId = await api.startTranscribe(resolved, trimmed);
        if (!isMountedRef.current) return;

        setTasks((prev) => [
          ...prev,
          {
            taskId,
            bvid: resolved,
            url: trimmed,
            title: resolved,
            progress: "正在准备…",
            status: "queued",
            error: null,
          },
        ]);
        ensurePolling();

        // 异步补全视频标题（失败则保留 bvid 占位，不影响转录）
        void api
          .getVideoInfo(resolved)
          .then((info) => {
            if (isMountedRef.current && info?.title) {
              patchTask(taskId, { title: info.title });
            }
          })
          .catch(() => {});
      } catch (e) {
        if (isMountedRef.current) {
          setError(formatError(e));
        }
      } finally {
        // 入队成功后去重交回 tasksRef；失败/取消/卸载也要释放占位
        if (bvid) inFlightBvidsRef.current.delete(bvid);
      }
    },
    [ensurePolling, patchTask]
  );

  // 进度事件按 task_id 路由：只更新属于本页任务、且仍在运行的那一条
  useEffect(() => {
    isMountedRef.current = true;
    loadNotes();

    let cleanup: (() => void) | undefined;
    let listenerCancelled = false;
    api
      .onProgress((taskId, message) => {
        if (!isMountedRef.current) return;
        setTasks((prev) =>
          prev.map((t) =>
            t.taskId === taskId && (t.status === "queued" || t.status === "running")
              ? { ...t, progress: message, status: "running" }
              : t
          )
        );
      })
      .then((fn) => {
        // 若注册兑现前组件已卸载，立即注销，避免监听器泄漏
        if (listenerCancelled) fn();
        else cleanup = fn;
      });

    return () => {
      isMountedRef.current = false;
      listenerCancelled = true;
      cleanup?.();
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
      if (hintTimeoutRef.current) clearTimeout(hintTimeoutRef.current);
      if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
      removeTimersRef.current.forEach((timer) => clearTimeout(timer));
      removeTimersRef.current.clear();
    };
  }, [loadNotes]);

  // 同步"是否有后台任务在处理"给 ShareContext
  useEffect(() => {
    const hasActive = tasks.some((t) => t.status === "queued" || t.status === "running");
    setIsProcessing(hasActive);
  }, [tasks, setIsProcessing]);

  // 消费分享队列：逐条入队转录（提交即入队，由后端并发闸排队）
  useEffect(() => {
    if (pendingUrls.length === 0) return;
    const urls = consumeShares();
    for (const url of urls) {
      void startTranscription(url);
    }
  }, [pendingUrls, consumeShares, startTranscription]);

  const handleSubmit = async () => {
    const value = input.trim();
    if (!value) return;
    setInput("");
    await startTranscription(value);
  };

  const handleCancelTask = async (taskId: string) => {
    try {
      await api.cancelTask(taskId);
      patchTask(taskId, { progress: "正在取消…" });
    } catch (e) {
      console.error(e);
    }
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

  const activeCount = tasks.filter(
    (t) => t.status === "queued" || t.status === "running"
  ).length;
  // 计算每个排队任务在队列中的位次
  let queueCursor = 0;
  const taskRows = tasks.map((t) => {
    const queuePosition = t.status === "queued" ? ++queueCursor : 0;
    return { task: t, queuePosition };
  });

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
            <div className="min-w-0 space-y-8">
              <div className="space-y-4">
                  <p className="editorial-kicker">Turn videos into readable notes</p>
                  <h2 className="title-display max-w-3xl">
                    把 B 站内容
                    <br />
                    变成一份真正值得阅读的笔记。
                  </h2>
                  <p className="max-w-2xl text-base leading-8 text-ink-500 sm:text-lg">
                    粘贴链接后，BiNote 会自动转录、整理、总结，并把内容归档成适合回看和复盘的阅读单元。支持同时处理多条视频。
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
                      />
                    </div>
                  </div>

                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-sm leading-7 text-ink-500">
                      支持直接粘贴链接，也支持 Android 分享到应用。可连续添加多条，自动排队处理。
                    </p>
                    <button
                      onClick={() => void handleSubmit()}
                      disabled={!input.trim()}
                      className="button-primary sm:min-w-[168px]"
                    >
                      <ArrowRight size={16} />
                      添加到队列
                    </button>
                  </div>

                  {hint && (
                    <p className="inline-flex items-center gap-2 self-start rounded-full border border-gold-300 bg-gold-100/70 px-3 py-1.5 text-xs font-semibold text-[#8e6532]">
                      <Clock3 size={13} />
                      {hint}
                    </p>
                  )}
                </div>
              </div>

              {tasks.length > 0 && (
                <div className="editorial-card-muted p-4 sm:p-5">
                  <div className="mb-3 flex items-center justify-between">
                    <p className="editorial-kicker">Processing Queue</p>
                    <div className="editorial-chip !px-2.5 !py-1 !text-[10px] !tracking-[0.2em]">
                      {activeCount > 0 ? `${activeCount} 个进行中` : "已全部完成"}
                    </div>
                  </div>
                  <ul className="space-y-2">
                    {taskRows.map(({ task, queuePosition }) => (
                      <li
                        key={task.taskId}
                        className="flex items-center gap-3 rounded-[20px] border border-ink-100/80 bg-paper-50/[0.85] px-4 py-3"
                      >
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border">
                          {task.status === "running" && (
                            <span className="flex h-9 w-9 items-center justify-center rounded-full border border-primary-200 bg-primary-50 text-primary-600">
                              <Loader2 size={16} className="animate-spin" />
                            </span>
                          )}
                          {task.status === "queued" && (
                            <span className="flex h-9 w-9 items-center justify-center rounded-full border border-ink-200 bg-canvas-50 text-ink-400">
                              <Clock3 size={16} />
                            </span>
                          )}
                          {task.status === "completed" && (
                            <span className="flex h-9 w-9 items-center justify-center rounded-full border border-sage-200 bg-sage-100/70 text-sage-700">
                              <Check size={16} strokeWidth={3} />
                            </span>
                          )}
                          {task.status === "failed" && (
                            <span className="flex h-9 w-9 items-center justify-center rounded-full border border-red-200 bg-red-50 text-red-600">
                              <TriangleAlert size={15} />
                            </span>
                          )}
                          {task.status === "cancelled" && (
                            <span className="flex h-9 w-9 items-center justify-center rounded-full border border-ink-200 bg-canvas-50 text-ink-400">
                              <X size={16} />
                            </span>
                          )}
                        </div>

                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-ink-800">{task.title}</p>
                          <p
                            className={`truncate text-xs leading-5 ${
                              task.status === "failed" ? "text-red-600" : "text-ink-400"
                            }`}
                          >
                            {task.status === "queued"
                              ? `排队中${queuePosition > 0 ? `（第 ${queuePosition} 位）` : "…"}`
                              : task.status === "failed"
                                ? task.error || "失败"
                                : task.progress}
                          </p>
                          <p className="truncate text-[11px] leading-5 text-ink-300">
                            源链接：{task.url}
                          </p>
                        </div>

                        {(task.status === "queued" || task.status === "running") && (
                          <button
                            onClick={() => void handleCancelTask(task.taskId)}
                            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-ink-100 bg-canvas-50 text-ink-400 transition-colors duration-200 hover:bg-red-50 hover:text-red-600"
                            title="取消任务"
                            aria-label={`取消 ${task.title}`}
                          >
                            <X size={15} />
                          </button>
                        )}
                        {(task.status === "failed" || task.status === "cancelled") && (
                          <button
                            onClick={() => removeTask(task.taskId)}
                            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-ink-100 bg-canvas-50 text-ink-400 transition-colors duration-200 hover:bg-ink-100"
                            title="移除"
                            aria-label={`移除 ${task.title}`}
                          >
                            <X size={15} />
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            <div className="min-w-0 grid gap-4">
              {latestNote && (
                <Link to={`/note/${latestNote.id}`} className="editorial-card-muted overflow-hidden block transition-colors duration-200 hover:bg-canvas-100/80">
                  <div className="space-y-3 p-5">
                    <p className="editorial-kicker">Latest Entry</p>
                    <h3 className="font-display text-2xl font-semibold leading-tight text-ink-900">
                      {latestNote.title}
                    </h3>
                    <p className="flex items-center gap-2 text-xs text-ink-400">
                      <LinkIcon size={13} className="shrink-0" />
                      <span className="min-w-0 truncate">{getNoteSourceUrl(latestNote)}</span>
                    </p>
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
                        <span className="font-semibold text-ink-800">贴入视频链接</span> — 支持手动粘贴和 Android 系统分享，可连续添加多条。
                      </p>
                    </div>
                    <div className="flex items-start gap-3">
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-ink-200 bg-white/70 text-xs font-semibold text-ink-700">
                        2
                      </div>
                      <p className="text-sm leading-6 text-ink-500">
                        <span className="font-semibold text-ink-800">自动转录与总结</span> — 优先字幕，必要时回退 ASR；按并发上限排队处理。
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
                每条记录都保留原始链接、原始转录、AI 总结和思维导图，方便回看、复盘和继续整理。
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
                const noteSourceUrl = getNoteSourceUrl(note);

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
                        <p className="flex items-center gap-2 text-xs text-ink-400">
                          <LinkIcon size={13} className="shrink-0" />
                          <span className="min-w-0 truncate">{noteSourceUrl}</span>
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
