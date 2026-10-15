import { useState, useEffect, useRef, useCallback } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  Check,
  CheckSquare,
  ChevronDown,
  Link as LinkIcon,
  Loader2,
  Search,
  Trash2,
  TriangleAlert,
  X,
  MoreHorizontal,
} from "lucide-react";
import AppLayout from "../components/AppLayout";
import LoadingState, { LoadFailure } from "../components/LoadingState";
import PendingNotice from "../components/PendingNotice";
import { getNotePreview } from "../lib/note-preview";
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
  kind: "transcribe" | "summarize" | "mindmap";
  noteId?: string | null;
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
  return getNotePreview(note);
}

function getNoteSourceUrl(note: api.Note): string {
  return (
    note.source_url?.trim() || `https://www.bilibili.com/video/${note.bvid}`
  );
}

export default function Dashboard() {
  const [input, setInput] = useState("");
  const [search, setSearch] = useState("");
  const [tasksExpanded, setTasksExpanded] = useState(false);
  const [notes, setNotes] = useState<api.Note[]>([]);
  const [notesLoaded, setNotesLoaded] = useState(false);
  const [notesError, setNotesError] = useState("");
  const [tasksLoaded, setTasksLoaded] = useState(false);
  const [tasksError, setTasksError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const submitLockRef = useRef(false);
  const inputRef = useRef("");
  inputRef.current = input;
  const [deleting, setDeleting] = useState(false);
  const deleteLockRef = useRef(false);
  const cancelPendingRef = useRef(new Set<string>());
  const [cancellingTasks, setCancellingTasks] = useState<string[]>([]);
  const dismissPendingRef = useRef(new Set<string>());
  const [dismissingTasks, setDismissingTasks] = useState<string[]>([]);
  const pollBusyRef = useRef(false);
  const retryLockRef = useRef(false);
  const [retryingTaskId, setRetryingTaskId] = useState<string | null>(null);
  const [tasks, setTasks] = useState<ActiveTask[]>([]);
  const [error, setError] = useState("");
  const [hint, setHint] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<{
    id: string;
    title: string;
  } | null>(null);

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
  const removeTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map(),
  );
  const isMountedRef = useRef(true);
  // 镜像最新 tasks，供轮询闭包读取（避免闭包捕获旧值）
  const tasksRef = useRef<ActiveTask[]>([]);
  tasksRef.current = tasks;
  // 同步登记"正在提交中"的 bvid，覆盖"去重检查 → 入队"之间的异步窗口（TOCTOU），
  // 防止分享队列一次性并发回放多条相同链接造成重复入队。
  const inFlightBvidsRef = useRef<Set<string>>(new Set());

  const loadNotes = useCallback(async () => {
    if (isMountedRef.current) setNotesError("");
    try {
      const data = await api.getNotes();
      if (isMountedRef.current) setNotes(data);
      return true;
    } catch (e) {
      if (isMountedRef.current) setNotesError(formatError(e));
      return false;
    } finally {
      if (isMountedRef.current) setNotesLoaded(true);
    }
  }, []);

  const finishCancel = useCallback((taskId: string) => {
    cancelPendingRef.current.delete(taskId);
    setCancellingTasks((previous) => previous.filter((id) => id !== taskId));
  }, []);

  const patchTask = useCallback(
    (taskId: string, patch: Partial<ActiveTask>) => {
      setTasks((prev) =>
        prev.map((t) => (t.taskId === taskId ? { ...t, ...patch } : t)),
      );
    },
    [],
  );

  const removeTask = useCallback((taskId: string) => {
    setTasks((prev) => prev.filter((t) => t.taskId !== taskId));
    const timer = removeTimersRef.current.get(taskId);
    if (timer) {
      clearTimeout(timer);
      removeTimersRef.current.delete(taskId);
    }
  }, []);

  const scheduleRemove = useCallback((taskId: string, delay: number) => {
    if (removeTimersRef.current.has(taskId)) return;
    const timer = setTimeout(() => {
      removeTimersRef.current.delete(taskId);
      if (isMountedRef.current) {
        setTasks((prev) => prev.filter((t) => t.taskId !== taskId));
      }
    }, delay);
    removeTimersRef.current.set(taskId, timer);
  }, []);

  const ensurePolling = useCallback(() => {
    if (pollIntervalRef.current) return;
    pollIntervalRef.current = setInterval(async () => {
      if (pollBusyRef.current) return;
      const active = tasksRef.current.filter(
        (t) => t.status === "queued" || t.status === "running",
      );
      if (active.length === 0) {
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
        }
        return;
      }

      pollBusyRef.current = true;
      try {
        await Promise.all(
          active.map(async (t) => {
            try {
              const info = await api.getTaskStatus(t.taskId);
              if (!isMountedRef.current) return;

              if (["completed", "failed", "cancelled"].includes(info.status))
                finishCancel(t.taskId);
              if (info.status === "completed") {
                await loadNotes();
                if (!isMountedRef.current) return;
                patchTask(t.taskId, {
                  status: "completed",
                  progress: "已完成",
                  error: info.error ?? null,
                  noteId: info.note_id,
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
          }),
        );
      } finally {
        pollBusyRef.current = false;
      }
    }, POLL_INTERVAL_MS);
  }, [loadNotes, patchTask, scheduleRemove, finishCancel]);

  // 页面重建（路由切换 / Android Activity 重建）后从后端任务注册表恢复进行中的转录队列。
  // 后端任务一直在跑，只是前端组件卸载时丢了内存态；这里按 taskId 合并，避免重复条目。
  const rehydrateTasks = useCallback(async () => {
    if (isMountedRef.current) {
      setTasksLoaded(false);
      setTasksError("");
    }
    try {
      const entries = await api.listTasks();
      if (!isMountedRef.current) return;

      const active = entries.filter(
        (e) =>
          ["transcribe", "summarize", "mindmap"].includes(e.kind) &&
          ["queued", "running", "failed"].includes(e.status),
      );
      if (active.length === 0) return;

      setTasks((prev) => {
        const known = new Set(prev.map((t) => t.taskId));
        const restored = active
          .filter((e) => !known.has(e.task_id))
          .map<ActiveTask>((e) => ({
            taskId: e.task_id,
            bvid: e.bvid ?? "",
            url:
              e.source_url ??
              (e.bvid ? `https://www.bilibili.com/video/${e.bvid}` : ""),
            kind: e.kind as ActiveTask["kind"],
            noteId: e.note_id,
            title: e.bvid ?? (e.kind === "summarize" ? "总结任务" : "导图任务"),
            progress: e.progress,
            status: e.status as TaskStatus,
            error: e.error,
          }));
        return restored.length > 0 ? [...prev, ...restored] : prev;
      });
      ensurePolling();

      // 异步补全视频标题（与新建任务同一策略：失败保留 bvid 占位）
      for (const e of active) {
        if (e.note_id) {
          void api
            .getNote(e.note_id)
            .then((note) => {
              if (isMountedRef.current && note)
                patchTask(e.task_id, { title: note.title });
            })
            .catch(() => {});
          continue;
        }
        if (!e.bvid) continue;
        void api
          .getVideoInfo(e.bvid)
          .then((info) => {
            if (isMountedRef.current && info?.title) {
              patchTask(e.task_id, { title: info.title });
            }
          })
          .catch(() => {});
      }
    } catch (e) {
      if (isMountedRef.current) setTasksError(formatError(e));
    } finally {
      if (isMountedRef.current) setTasksLoaded(true);
    }
  }, [ensurePolling, patchTask]);

  const startTranscription = useCallback(
    async (url: string) => {
      const trimmed = url.trim();
      if (!trimmed || !tasksLoaded || tasksError) return false;

      setError("");
      let bvid: string | undefined;
      try {
        const resolved = await api.parseLink(trimmed);
        if (!isMountedRef.current) return false;
        bvid = resolved;

        // 去重：同一视频若已在队列中（未结束）或正在提交中，不重复入队。
        // inFlightBvidsRef 覆盖"检查 → 入队"之间的异步窗口，防止并发回放重复提交。
        const existing = tasksRef.current.find(
          (t) =>
            t.bvid === resolved &&
            (t.status === "queued" || t.status === "running"),
        );
        if (existing || inFlightBvidsRef.current.has(resolved)) {
          setHint(`「${existing?.title ?? resolved}」已在处理队列中`);
          if (hintTimeoutRef.current) clearTimeout(hintTimeoutRef.current);
          hintTimeoutRef.current = setTimeout(() => {
            if (isMountedRef.current) setHint("");
          }, 2500);
          return false;
        }
        // 同步占位（紧跟检查、无 await），抢占该 bvid 的提交权
        inFlightBvidsRef.current.add(resolved);

        const taskId = await api.startTranscribe(resolved, trimmed);
        // 已成功入队；离开页面仅停止 UI 更新，重试调用方仍须清理旧失败记录。
        if (!isMountedRef.current) return true;

        setTasks((prev) => [
          ...prev,
          {
            taskId,
            kind: "transcribe",
            noteId: null,
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
        return true;
      } catch (e) {
        if (isMountedRef.current) setError(formatError(e));
        return false;
      } finally {
        // 入队成功后去重交回 tasksRef；失败/取消/卸载也要释放占位
        if (bvid) inFlightBvidsRef.current.delete(bvid);
      }
    },
    [ensurePolling, patchTask, tasksLoaded, tasksError],
  );

  // 进度事件按 task_id 路由：只更新属于本页任务、且仍在运行的那一条
  useEffect(() => {
    isMountedRef.current = true;
    loadNotes();
    void rehydrateTasks();

    let cleanup: (() => void) | undefined;
    let listenerCancelled = false;
    api
      .onProgress((taskId, message) => {
        if (!isMountedRef.current) return;
        setTasks((prev) =>
          prev.map((t) =>
            t.taskId === taskId &&
            (t.status === "queued" || t.status === "running")
              ? { ...t, progress: message, status: "running" }
              : t,
          ),
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
  }, [loadNotes, rehydrateTasks]);

  // 同步"是否有后台任务在处理"给 ShareContext
  useEffect(() => {
    const hasActive = tasks.some(
      (t) => t.status === "queued" || t.status === "running",
    );
    setIsProcessing(hasActive);
  }, [tasks, setIsProcessing]);

  // 消费分享队列：逐条入队转录（提交即入队，由后端并发闸排队）
  useEffect(() => {
    if (!tasksLoaded || tasksError || pendingUrls.length === 0) return;
    const urls = consumeShares();
    for (const url of urls) {
      void startTranscription(url);
    }
  }, [pendingUrls, consumeShares, startTranscription, tasksLoaded, tasksError]);

  const handleSubmit = async () => {
    const value = input.trim();
    if (!value || submitLockRef.current || !tasksLoaded || tasksError) return;
    submitLockRef.current = true;
    setSubmitting(true);
    try {
      if (await startTranscription(value)) {
        if (isMountedRef.current && inputRef.current.trim() === value)
          setInput("");
      }
    } finally {
      submitLockRef.current = false;
      if (isMountedRef.current) setSubmitting(false);
    }
  };

  const handleCancelTask = async (taskId: string) => {
    if (cancelPendingRef.current.has(taskId)) return;
    cancelPendingRef.current.add(taskId);
    setCancellingTasks((previous) => [...previous, taskId]);
    try {
      await api.cancelTask(taskId);
      if (isMountedRef.current) patchTask(taskId, { progress: "正在取消…" });
    } catch (e) {
      if (isMountedRef.current) {
        finishCancel(taskId);
        setError(formatError(e));
      }
    }
  };

  const handleRetryTask = async (task: ActiveTask) => {
    if (retryLockRef.current) return;
    const existing = tasksRef.current.some(
      (item) =>
        item.taskId !== task.taskId &&
        ["queued", "running"].includes(item.status) &&
        item.kind === task.kind &&
        (task.kind === "transcribe"
          ? item.bvid === task.bvid
          : item.noteId === task.noteId),
    );
    if (existing) {
      setError("这个任务已经在后台处理中，请查看现有任务的进度。");
      return;
    }
    retryLockRef.current = true;
    setRetryingTaskId(task.taskId);
    try {
      if (task.kind === "transcribe") {
        if (await startTranscription(task.url)) {
          await api.dismissTask(task.taskId);
          if (isMountedRef.current) removeTask(task.taskId);
        }
      } else if (task.noteId) {
        const taskId = await (task.kind === "summarize"
          ? api.startSummarize(task.noteId)
          : api.startMindmap(task.noteId));
        await api.dismissTask(task.taskId);
        if (!isMountedRef.current) return;
        setTasks((previous) =>
          previous.map((item) =>
            item.taskId === task.taskId
              ? {
                  ...item,
                  taskId,
                  status: "queued",
                  progress: "正在准备…",
                  error: null,
                }
              : item,
          ),
        );
        ensurePolling();
      }
    } catch (e) {
      if (isMountedRef.current) setError(formatError(e));
    } finally {
      retryLockRef.current = false;
      if (isMountedRef.current) setRetryingTaskId(null);
    }
  };

  const handleDismissTask = async (taskId: string) => {
    if (dismissPendingRef.current.has(taskId)) return;
    dismissPendingRef.current.add(taskId);
    setDismissingTasks((previous) => [...previous, taskId]);
    try {
      await api.dismissTask(taskId);
      if (isMountedRef.current) removeTask(taskId);
    } catch (e) {
      if (isMountedRef.current) setError(formatError(e));
    } finally {
      dismissPendingRef.current.delete(taskId);
      if (isMountedRef.current)
        setDismissingTasks((previous) =>
          previous.filter((id) => id !== taskId),
        );
    }
  };

  const handleDeleteClick = (note: api.Note, event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setDeleteTarget({ id: note.id, title: note.title });
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget || deleteLockRef.current) return;
    deleteLockRef.current = true;
    setDeleting(true);
    try {
      await api.deleteNote(deleteTarget.id);
      if (!isMountedRef.current) return;
      setNotes((previous) =>
        previous.filter((note) => note.id !== deleteTarget.id),
      );
      setDeleteTarget(null);
      await loadNotes();
    } catch (e) {
      if (isMountedRef.current) setError(formatError(e));
    } finally {
      deleteLockRef.current = false;
      if (isMountedRef.current) setDeleting(false);
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
    if (deleteLockRef.current || selectedIds.size === 0) return;
    deleteLockRef.current = true;
    setDeleting(true);
    try {
      for (const id of selectedIds) {
        await api.deleteNote(id);
        if (!isMountedRef.current) return;
        setNotes((previous) => previous.filter((note) => note.id !== id));
        setSelectedIds((previous) => {
          const next = new Set(previous);
          next.delete(id);
          return next;
        });
      }
      setBatchDeleteConfirm(false);
      exitSelectionMode();
      await loadNotes();
    } catch (e) {
      if (isMountedRef.current) setError(formatError(e));
    } finally {
      deleteLockRef.current = false;
      if (isMountedRef.current) setDeleting(false);
    }
  };

  const handleCardClick = (event: React.MouseEvent, noteId: string) => {
    if (selectionMode) {
      event.preventDefault();
      toggleSelect(noteId);
    }
  };

  const activeCount = tasks.filter(
    (t) => t.status === "queued" || t.status === "running",
  ).length;
  const currentTask = tasks.find(
    (t) => t.status === "running" || t.status === "queued",
  );
  const failedCount = tasks.filter((task) => task.status === "failed").length;
  const query = search.trim().toLocaleLowerCase();
  const visibleNotes = notes.filter((note) =>
    [note.title, buildExcerpt(note), note.transcript, note.summary ?? ""]
      .join(" ")
      .toLocaleLowerCase()
      .includes(query),
  );

  return (
    <AppLayout>
      <header className="page-header">
        <h1>笔记库</h1>
        <span className="text-sm text-ink-600 sm:text-base">
          {notesLoaded
            ? `${notes.length} 篇笔记，持续积累中`
            : "正在整理笔记库…"}
        </span>
      </header>
      <section className="composer panel" aria-labelledby="import-heading">
        <h2 id="import-heading">把视频，变成你的知识</h2>
        <p className="composer-description">
          粘贴 B站链接，自动转录、总结，整理成可回看的笔记。
        </p>
        <form
          className="import-form"
          onSubmit={(event) => {
            event.preventDefault();
            void handleSubmit();
          }}
        >
          <label className="link-input">
            <LinkIcon size={24} aria-hidden="true" />
            <input
              aria-label="B站视频链接"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="粘贴视频链接 / BV 号 / 分享文字"
            />
          </label>
          <button
            type="submit"
            disabled={
              !input.trim() || submitting || !tasksLoaded || Boolean(tasksError)
            }
            aria-busy={submitting}
            className="button-primary import-button"
          >
            {submitting ? "正在提交…" : "开始转录"}
            {submitting ? (
              <Loader2 size={22} className="animate-spin" />
            ) : (
              <ArrowRight size={22} />
            )}
          </button>
        </form>
        <p className="composer-hint">
          优先使用官方字幕 · 无字幕时自动语音转写 · 支持多 P 视频
        </p>
      </section>
      {hint && (
        <p role="status" className="mt-3 text-sm text-primary-700">
          {hint}
        </p>
      )}
      {!tasksLoaded || tasksError || tasks.length > 0 || tasksExpanded ? (
        <section className="task-panel" aria-label="后台任务">
          <div className="task-summary">
            <div className="min-w-0 flex-1">
              <p
                className="flex flex-wrap items-center gap-x-3 gap-y-1 font-semibold"
                aria-live="polite"
              >
                {activeCount > 0 ? (
                  <span className="inline-flex items-center gap-2">
                    <Loader2
                      size={16}
                      className="shrink-0 animate-spin text-primary-600"
                    />
                    {activeCount} 个任务正在处理
                  </span>
                ) : failedCount > 0 ? (
                  <span className="inline-flex items-center gap-2 text-red-700">
                    <TriangleAlert size={16} className="shrink-0" />
                    {failedCount} 个任务未完成
                  </span>
                ) : tasksError ? (
                  "后台任务暂时无法读取"
                ) : !tasksLoaded ? (
                  "正在读取后台任务…"
                ) : (
                  "后台任务已处理完"
                )}
                {activeCount > 0 && failedCount > 0 && (
                  <span className="text-xs font-normal text-red-700">
                    {failedCount} 个未完成
                  </span>
                )}
              </p>
              <p className="mt-1 truncate text-sm text-ink-500">
                {currentTask
                  ? tasksExpanded
                    ? "后台持续处理，可以继续浏览和整理笔记。"
                    : `${currentTask.title} · ${currentTask.progress}`
                  : failedCount > 0
                    ? "可以重试未完成的任务，已有笔记不受影响。"
                    : "当前没有待处理的任务。"}
              </p>
            </div>
            <button
              className="task-toggle"
              aria-expanded={tasksExpanded}
              aria-controls="library-task-details"
              onClick={() => setTasksExpanded((expanded) => !expanded)}
            >
              {tasksExpanded ? "收起任务" : "查看任务"}
              <ChevronDown size={16} aria-hidden="true" />
            </button>
          </div>
          {tasksExpanded && (
            <div id="library-task-details" className="task-details">
              <div className="task-list">
                {!tasksLoaded && (
                  <PendingNotice
                    message="正在读取后台任务…"
                    detail="正在恢复本机任务状态。"
                  />
                )}
                {tasksError && (
                  <LoadFailure
                    title="任务暂时无法加载"
                    message="可以重新读取后台任务，正在运行的任务不会因此停止。"
                    retryLabel="重新读取任务"
                    onRetry={() => {
                      setTasksLoaded(false);
                      void rehydrateTasks();
                    }}
                  />
                )}
                {tasksLoaded && !tasksError && tasks.length === 0 && (
                  <p className="py-12 text-center text-ink-400">
                    当前没有待处理的任务。
                  </p>
                )}
                {tasks.map((task) => (
                  <article key={task.taskId} className="task-item">
                    <div className="min-w-0 flex-1">
                      <p className="mb-1 flex flex-wrap items-center gap-x-2 text-xs leading-5 text-ink-500">
                        <span>
                          {task.kind === "summarize"
                            ? "生成总结"
                            : task.kind === "mindmap"
                              ? "生成导图"
                              : "视频转录"}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span role="status" className="break-words">
                          {task.progress}
                        </span>
                      </p>
                      <h3 className="break-words font-semibold leading-6">
                        {task.title}
                      </h3>
                      {task.error && (
                        <p className="mt-2 break-words text-sm leading-6 text-red-700">
                          {task.error}
                        </p>
                      )}
                    </div>
                    <div className="task-actions">
                      {task.status === "failed" &&
                        (task.url || task.noteId) && (
                          <button
                            className="button-secondary"
                            disabled={retryingTaskId !== null}
                            onClick={() => void handleRetryTask(task)}
                          >
                            {retryingTaskId === task.taskId ? (
                              <>
                                <Loader2 size={15} className="animate-spin" />
                                正在重试…
                              </>
                            ) : (
                              "重试任务"
                            )}
                          </button>
                        )}
                      {task.noteId && (
                        <Link
                          className="button-tertiary"
                          to={`/note/${task.noteId}`}
                        >
                          查看笔记
                          <ArrowRight size={15} />
                        </Link>
                      )}
                      {task.status === "queued" || task.status === "running" ? (
                        <button
                          className="button-secondary"
                          aria-label={`${cancellingTasks.includes(task.taskId) ? "正在取消" : "取消任务"} ${task.title}`}
                          disabled={cancellingTasks.includes(task.taskId)}
                          onClick={() => void handleCancelTask(task.taskId)}
                        >
                          {cancellingTasks.includes(task.taskId)
                            ? "正在取消…"
                            : "取消任务"}
                        </button>
                      ) : (
                        <button
                          className="button-tertiary"
                          disabled={dismissingTasks.includes(task.taskId)}
                          onClick={() => void handleDismissTask(task.taskId)}
                        >
                          {dismissingTasks.includes(task.taskId)
                            ? "正在移除…"
                            : "移除记录"}
                        </button>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            </div>
          )}
        </section>
      ) : (
        <div className="h-5" />
      )}
      <section aria-labelledby="library-heading">
        <div className="library-toolbar">
          <h2
            id="library-heading"
            className="flex shrink-0 items-center gap-3 text-xl font-bold sm:text-[28px]"
          >
            全部笔记
            <span className="count-pill">
              {notesLoaded ? notes.length : "…"}
            </span>
          </h2>
          <label className="search-field">
            <Search size={20} />
            <input
              type="search"
              aria-label="搜索笔记"
              placeholder="搜索笔记内容…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <button
            className="icon-button shrink-0"
            aria-label={selectionMode ? "退出多选" : "多选笔记"}
            onClick={() =>
              selectionMode ? exitSelectionMode() : setSelectionMode(true)
            }
          >
            <CheckSquare size={21} />
          </button>
        </div>
        {selectionMode && (
          <div className="mb-3 flex flex-wrap items-center gap-3 rounded-xl border border-primary-200 bg-primary-50 p-3 text-sm">
            <span>已选 {selectedIds.size} 篇</span>
            <button className="button-tertiary" onClick={handleSelectAll}>
              全选所有笔记
            </button>
            <button
              className="button-secondary text-red-700"
              disabled={selectedIds.size === 0}
              onClick={() => setBatchDeleteConfirm(true)}
            >
              <Trash2 size={16} />
              删除所选
            </button>
            <button
              className="icon-button ml-auto"
              aria-label="退出多选"
              onClick={exitSelectionMode}
            >
              <X size={18} />
            </button>
          </div>
        )}
        {notesError && notes.length > 0 && (
          <p role="alert" className="mb-3 text-sm text-amber-700">
            刷新暂时失败，仍显示已加载的笔记。
            <button className="ml-2 underline" onClick={() => void loadNotes()}>
              重新加载笔记
            </button>
          </p>
        )}
        <div className="notes-panel panel" aria-busy={!notesLoaded}>
          {!notesLoaded ? (
            <LoadingState kind="library" />
          ) : notesError && notes.length === 0 ? (
            <LoadFailure
              title="笔记库暂时无法加载"
              message="没有读取到本地内容，你的笔记没有被清空。"
              retryLabel="重新加载笔记"
              onRetry={() => {
                setNotesLoaded(false);
                void loadNotes();
              }}
            />
          ) : visibleNotes.length === 0 ? (
            <div className="empty-state">
              <h3>{query ? "没有找到相关笔记" : "从第一条视频开始"}</h3>
              <p>
                {query
                  ? "换个关键词试试，标题和正文都可以搜索。"
                  : "将视频链接粘贴到上方，知识会慢慢积累在这里。"}
              </p>
            </div>
          ) : (
            visibleNotes.map((note) => (
              <article
                key={note.id}
                data-note-row
                className={`note-row ${selectedIds.has(note.id) ? "bg-primary-50" : ""}`}
              >
                {selectionMode && (
                  <button
                    className="icon-button"
                    aria-label={`${selectedIds.has(note.id) ? "取消选择" : "选择"} ${note.title}`}
                    aria-pressed={selectedIds.has(note.id)}
                    onClick={() => toggleSelect(note.id)}
                  >
                    {selectedIds.has(note.id) ? (
                      <Check size={20} />
                    ) : (
                      <span className="h-5 w-5 rounded border border-ink-300" />
                    )}
                  </button>
                )}
                <Link
                  className="note-main"
                  to={`/note/${note.id}`}
                  title={getNoteSourceUrl(note)}
                  onClick={(event) => handleCardClick(event, note.id)}
                  onMouseDown={() => handleMouseDown(note.id)}
                  onMouseUp={handleMouseUp}
                  onMouseLeave={handleMouseLeave}
                  onTouchStart={(event) => handleTouchStart(note.id, event)}
                  onTouchMove={handleTouchMove}
                  onTouchEnd={handleTouchEnd}
                  onTouchCancel={handleTouchEnd}
                  onContextMenu={(event) => event.preventDefault()}
                >
                  <h3 className="note-title">{note.title}</h3>
                  <p className="note-preview">{buildExcerpt(note)}</p>
                </Link>
                <div className="note-status">
                  <div className="flex flex-wrap gap-2">
                    {note.summary && <span className="badge">AI 总结</span>}
                    {note.mindmap && <span className="badge">思维导图</span>}
                    {!note.summary && !note.mindmap && (
                      <span className="badge badge-neutral">已转录</span>
                    )}
                  </div>
                  <time
                    className="note-date"
                    dateTime={new Date(note.created_at * 1000).toISOString()}
                  >
                    {formatNoteDate(note.created_at)}
                  </time>
                </div>
                <div className="row-actions">
                  <Link
                    className="icon-button bg-canvas-50"
                    to={`/note/${note.id}`}
                    aria-label={`打开笔记 ${note.title}`}
                  >
                    <ArrowRight size={20} />
                  </Link>
                  <details className="relative">
                    <summary
                      className="icon-button list-none"
                      aria-label={`笔记操作 ${note.title}`}
                    >
                      <MoreHorizontal size={20} />
                    </summary>
                    <div className="note-menu">
                      <button
                        onClick={(event) => handleDeleteClick(note, event)}
                        className="flex items-center gap-2 text-red-700"
                      >
                        <Trash2 size={15} />
                        删除笔记
                      </button>
                    </div>
                  </details>
                </div>
              </article>
            ))
          )}
        </div>
      </section>

      <ConfirmModal
        open={Boolean(deleteTarget)}
        busy={deleting}
        title="删除笔记"
        message={`确定删除「${deleteTarget?.title ?? ""}」吗？删除后无法恢复。`}
        onConfirm={() => void handleDeleteConfirm()}
        onCancel={() => setDeleteTarget(null)}
        confirmText="删除"
      />
      <ConfirmModal
        open={batchDeleteConfirm}
        busy={deleting}
        title="删除所选笔记"
        message={`确定删除选中的 ${selectedIds.size} 篇笔记吗？删除后无法恢复。`}
        onConfirm={() => void handleBatchDeleteConfirm()}
        onCancel={() => setBatchDeleteConfirm(false)}
        confirmText="删除"
      />
      <ErrorModal error={error} onClose={() => setError("")} />
    </AppLayout>
  );
}
