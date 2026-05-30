import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export interface VideoInfo {
  bvid: string;
  aid: number;
  cid: number;
  title: string;
  cover: string;
  duration: number;
}

export interface Note {
  id: string;
  bvid: string;
  title: string;
  cover: string;
  transcript: string;
  summary: string | null;
  mindmap: string | null;
  created_at: number;
  /** 转录来源: "subtitle" | "asr" | "mixed"，旧数据为 null */
  transcript_source: string | null;
  /** 未使用原生字幕或部分回退 ASR 的原因说明，旧数据为 null */
  transcript_reason: string | null;
}

export type AsrProvider = "dashscope" | "sensevoice";

export interface AppConfig {
  asr_provider: AsrProvider;
  asr_api_key: string | null;
  sensevoice_api_key: string | null;
  llm_api_key: string | null;
  llm_base_url: string | null;
  llm_model: string | null;
  /** B站 SESSDATA Cookie（用于获取字幕） */
  bilibili_sessdata: string | null;
  /** B站 bili_jct（CSRF token，扫码登录自动获取） */
  bilibili_bili_jct: string | null;
  /** B站 refresh_token（扫码登录自动获取） */
  bilibili_refresh_token: string | null;
  /** B站 DedeUserID */
  bilibili_dede_user_id: string | null;
  /** Cookie 获取时间戳 */
  bilibili_cookie_ts: number | null;
  /** 转录完成后自动生成 AI 总结（默认 true） */
  auto_summary: boolean;
  /** 转录完成后自动生成思维导图（默认 true） */
  auto_mindmap: boolean;
  /** 最大同时转录任务数（1-5，默认 2，修改后需重启应用生效） */
  max_concurrent_transcribe: number;
}

/** SESSDATA 验证结果 */
export interface LoginStatus {
  is_login: boolean;
  uname: string | null;
}

/** API 连通性测试结果
 *
 * severity:
 * - "ok"      连通成功
 * - "warning" 可达但受限（如 429 限流）
 * - "error"   失败
 */
export interface ConnectionTestResult {
  ok: boolean;
  severity: "ok" | "warning" | "error";
  message: string;
  latency_ms: number;
}

export interface TaskInfo {
  status: string;
  progress: string;
  note_id: string | null;
  error: string | null;
}

/** QR 码生成结果 */
export interface QrcodeInfo {
  url: string;
  qrcode_key: string;
}

/** B站登录凭证 */
export interface BiliCredentials {
  sessdata: string;
  bili_jct: string;
  dede_user_id: string;
  refresh_token: string;
}

/** QR 码轮询结果 */
export interface QrcodePollResult {
  /** "waiting" | "scanned" | "expired" | "success" */
  status: string;
  message: string;
  credentials: BiliCredentials | null;
}

export const getConfig = () => invoke<AppConfig>("get_config");
export const saveConfig = (config: AppConfig) => invoke("save_config", { config });

export const getNotes = () => invoke<Note[]>("get_notes");
export const getNote = (id: string) => invoke<Note | null>("get_note", { id });
export const deleteNote = (id: string) => invoke("delete_note", { id });

export const parseLink = (input: string) => invoke<string>("parse_link", { input });
export const getVideoInfo = (bvid: string) => invoke<VideoInfo>("get_video_info", { bvid });
export const transcribe = (bvid: string) => invoke<Note>("transcribe", { bvid });
export const summarize = (noteId: string) => invoke<Note>("summarize", { noteId });

export const startTranscribe = (bvid: string) => invoke<string>("start_transcribe", { bvid });
export const startSummarize = (noteId: string) => invoke<string>("start_summarize", { noteId });
export const startMindmap = (noteId: string) => invoke<string>("start_mindmap", { noteId });
export const getTaskStatus = (taskId: string) => invoke<TaskInfo>("get_task_status", { taskId });
export const cancelTask = (taskId: string) => invoke("cancel_task", { taskId });
export const consumeNotificationNavTarget = () => invoke<string | null>("consume_notification_nav_target");
export const verifySessdata = (sessdata: string) => invoke<LoginStatus>("verify_sessdata", { sessdata });

export const testLlmConnection = (
  apiKey: string,
  baseUrl: string | null,
  model: string | null,
) =>
  invoke<ConnectionTestResult>("test_llm_connection", {
    apiKey,
    baseUrl,
    model,
  });

export const testAsrConnection = (provider: AsrProvider, apiKey: string) =>
  invoke<ConnectionTestResult>("test_asr_connection", { provider, apiKey });

// ====== 扫码登录 ======
export const qrcodeGenerate = () => invoke<QrcodeInfo>("qrcode_generate");
export const qrcodePoll = (qrcodeKey: string) => invoke<QrcodePollResult>("qrcode_poll", { qrcodeKey });
export const getLoginStatus = () => invoke<LoginStatus>("get_login_status");
export const logoutBilibili = () => invoke("logout_bilibili");

/** 进度事件 payload：携带 task_id，使并发任务的进度能按任务分流，互不串台 */
export interface ProgressPayload {
  task_id: string;
  message: string;
}

export type ProgressKind = "transcribe" | "summarize" | "mindmap";

/**
 * 监听进度事件。回调携带 taskId，调用方据此把进度路由到对应任务，
 * 不属于自己任务的事件应被忽略（并发场景下避免串台）。
 */
export const onProgress = async (
  callback: (taskId: string, message: string, kind: ProgressKind) => void
) => {
  const unlisten1 = await listen<ProgressPayload>("transcribe:progress", (e) =>
    callback(e.payload.task_id, e.payload.message, "transcribe")
  );
  const unlisten2 = await listen<ProgressPayload>("summarize:progress", (e) =>
    callback(e.payload.task_id, e.payload.message, "summarize")
  );
  const unlisten3 = await listen<ProgressPayload>("mindmap:progress", (e) =>
    callback(e.payload.task_id, e.payload.message, "mindmap")
  );
  return () => {
    unlisten1();
    unlisten2();
    unlisten3();
  };
};
