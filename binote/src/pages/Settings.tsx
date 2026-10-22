import { useState, useEffect, useRef, useCallback } from "react";
import {
  ArrowLeft,
  Check,
  Loader2,
  Plug,
  QrCode,
  RefreshCw,
  Save,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
} from "lucide-react";
import AppLayout from "../components/AppLayout";
import LoadingState, { LoadFailure } from "../components/LoadingState";
import DialogFrame from "../components/DialogFrame";
import { QRCodeSVG } from "qrcode.react";
import * as api from "../lib/tauri";
import ErrorModal, { formatError } from "../components/ErrorModal";
import CodexSettings from "../components/CodexSettings";
import SummaryTemplateSettings, { SummaryTemplateSelect } from "../components/SummaryTemplateSettings";
import { validateSummaryTemplates } from "../lib/summary-templates";

type SessdataStatus = "idle" | "verifying" | "valid" | "expired" | "error";
type QrLoginState =
  "idle" | "loading" | "showing" | "scanned" | "success" | "expired" | "error";
type ConnectionTestStatus = "idle" | "testing" | "ok" | "warning" | "error";

interface ConnectionTestState {
  status: ConnectionTestStatus;
  message: string;
}

const INITIAL_TEST_STATE: ConnectionTestState = { status: "idle", message: "" };

function ConnectionTestRow({
  label,
  state,
  onTest,
  disabled,
}: {
  label: string;
  state: ConnectionTestState;
  onTest: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <button
        onClick={onTest}
        disabled={state.status === "testing" || disabled}
        className="button-secondary"
      >
        {state.status === "testing" ? (
          <Loader2 size={16} className="animate-spin" />
        ) : (
          <Plug size={16} />
        )}
        {state.status === "testing" ? "测试中..." : label}
      </button>

      {state.status === "ok" && (
        <div className="inline-flex items-center gap-2 rounded-full border border-sage-200 bg-sage-100/70 px-4 py-2 text-sm font-semibold text-sage-700">
          <ShieldCheck size={16} />
          {state.message}
        </div>
      )}
      {state.status === "warning" && (
        <div className="inline-flex items-center gap-2 rounded-full border border-gold-300 bg-gold-100/80 px-4 py-2 text-sm font-semibold text-[#8e6532]">
          <ShieldX size={16} />
          {state.message}
        </div>
      )}
      {state.status === "error" && (
        <div className="inline-flex items-center gap-2 rounded-full border border-red-200 bg-red-50 px-4 py-2 text-sm font-semibold text-red-600">
          <ShieldAlert size={16} />
          {state.message}
        </div>
      )}
    </div>
  );
}

function SectionField({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-2">
      <span className="block text-sm font-semibold text-ink-700">{label}</span>
      {description && (
        <span className="block text-xs leading-6 text-ink-400">
          {description}
        </span>
      )}
      {children}
    </label>
  );
}

export default function Settings() {
  const [config, setConfig] = useState<api.AppConfig>({
    asr_provider: "sensevoice",
    asr_api_key: null,
    sensevoice_api_key: null,
    llm_api_key: null,
    llm_base_url: null,
    llm_model: null,
    llm_provider: "api",
    codex_model: null,
    codex_path: null,
    codex_fast: false,
    bilibili_sessdata: null,
    bilibili_bili_jct: null,
    bilibili_refresh_token: null,
    bilibili_dede_user_id: null,
    bilibili_cookie_ts: null,
    auto_summary: true,
    auto_mindmap: true,
    summary_templates: [],
    default_summary_template_id: null,
    max_concurrent_transcribe: 2,
  });
  const [saved, setSaved] = useState(false);
  const [templateDefaults, setTemplateDefaults] = useState<api.SummaryTemplateDefaults | null>(null);
  const [showTemplates, setShowTemplates] = useState(false);
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
  const [saveError, setSaveError] = useState("");
  const headingRef = useRef<HTMLHeadingElement>(null);
  const manageTemplatesRef = useRef<HTMLButtonElement>(null);
  const templateViewOpenedRef = useRef(false);
  const [configLoaded, setConfigLoaded] = useState(false);
  const [configLoadError, setConfigLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const saveLockRef = useRef(false);
  const savedConfigRef = useRef<api.AppConfig | null>(null);
  const currentConfigRef = useRef(config);
  currentConfigRef.current = config;
  const dirtyRef = useRef(false);
  const dirty =
    savedConfigRef.current !== null &&
    JSON.stringify(config) !== JSON.stringify(savedConfigRef.current);
  dirtyRef.current = dirty;
  const loadRequestRef = useRef(0);
  const [codexSupported, setCodexSupported] = useState(false);
  const [error, setError] = useState("");
  const [sessdataStatus, setSessdataStatus] = useState<SessdataStatus>("idle");
  const [sessdataMsg, setSessdataMsg] = useState("");

  const [qrLoginState, setQrLoginState] = useState<QrLoginState>("idle");
  const [qrCodeUrl, setQrCodeUrl] = useState<string>("");
  const [qrMessage, setQrMessage] = useState<string>("");
  const [showQrModal, setShowQrModal] = useState(false);
  const [showManualInput, setShowManualInput] = useState(false);

  const [loginChecked, setLoginChecked] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [loginUname, setLoginUname] = useState<string>("");

  const [llmTest, setLlmTest] =
    useState<ConnectionTestState>(INITIAL_TEST_STATE);
  const [dashscopeTest, setDashscopeTest] =
    useState<ConnectionTestState>(INITIAL_TEST_STATE);
  const [sensevoiceTest, setSensevoiceTest] =
    useState<ConnectionTestState>(INITIAL_TEST_STATE);

  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const qrPollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const qrAutoCloseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const qrPollSessionRef = useRef(0);
  const isMountedRef = useRef(true);

  const clearSaveTimeout = useCallback(() => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    }
  }, []);

  const clearQrPollTimeout = useCallback(() => {
    if (qrPollTimeoutRef.current) {
      clearTimeout(qrPollTimeoutRef.current);
      qrPollTimeoutRef.current = null;
    }
  }, []);

  const clearQrAutoCloseTimeout = useCallback(() => {
    if (qrAutoCloseTimeoutRef.current) {
      clearTimeout(qrAutoCloseTimeoutRef.current);
      qrAutoCloseTimeoutRef.current = null;
    }
  }, []);

  const stopQrPolling = useCallback(() => {
    qrPollSessionRef.current += 1;
    clearQrPollTimeout();
  }, [clearQrPollTimeout]);

  const loadConfig = useCallback(async (refreshLogin = false) => {
    const request = ++loadRequestRef.current;
    if (isMountedRef.current) setConfigLoadError("");
    try {
      const [loaded, supported, defaults] = await Promise.all([
        api.getConfig(),
        api.supportsCodex(),
        api.getSummaryTemplateDefaults(),
      ]);
      if (!isMountedRef.current || request !== loadRequestRef.current) return;
      const data = {
        ...loaded,
        summary_templates: loaded.summary_templates ?? [],
        default_summary_template_id: loaded.default_summary_template_id ?? null,
      };
      setTemplateDefaults(defaults);
      if (!savedConfigRef.current) setEditingTemplateId(data.default_summary_template_id);
      // 登录检查可能比输入更晚完成，刷新不得覆盖用户刚编辑的字段。
      if (!dirtyRef.current || !savedConfigRef.current) {
        savedConfigRef.current = data;
        currentConfigRef.current = data;
        setConfig(data);
      } else {
        const current = currentConfigRef.current;
        const baseline = savedConfigRef.current;
        const authKeys = [
          "bilibili_sessdata",
          "bilibili_bili_jct",
          "bilibili_refresh_token",
          "bilibili_dede_user_id",
          "bilibili_cookie_ts",
        ] as const;
        const auth = Object.fromEntries(
          authKeys.map((key) => [key, data[key]]),
        );
        const patch = Object.fromEntries(
          authKeys
            .filter((key) => refreshLogin || current[key] === baseline[key])
            .map((key) => [key, data[key]]),
        );
        savedConfigRef.current = { ...baseline, ...auth };
        const updated = { ...current, ...patch };
        currentConfigRef.current = updated;
        setConfig(updated);
      }
      setCodexSupported(supported);
      setConfigLoaded(true);
    } catch (e) {
      if (isMountedRef.current && request === loadRequestRef.current)
        setConfigLoadError(formatError(e));
    }
  }, []);

  const checkLoginStatus = useCallback(async () => {
    try {
      const status = await api.getLoginStatus();
      if (!isMountedRef.current) return;

      setLoginChecked(true);
      setIsLoggedIn(status.is_login);
      setLoginUname(status.uname || "");
      if (status.is_login) {
        await loadConfig();
      }
    } catch (e) {
      if (isMountedRef.current) {
        setLoginChecked(true);
        setIsLoggedIn(false);
        setLoginUname("");
        setError(formatError(e));
      }
    }
  }, [loadConfig]);

  useEffect(() => {
    isMountedRef.current = true;
    void loadConfig();
    void checkLoginStatus();

    return () => {
      isMountedRef.current = false;
      clearSaveTimeout();
      stopQrPolling();
      clearQrAutoCloseTimeout();
    };
  }, [
    checkLoginStatus,
    clearQrAutoCloseTimeout,
    clearSaveTimeout,
    loadConfig,
    stopQrPolling,
  ]);

  const handleSave = async () => {
    if (!configLoaded || !templateDefaults || saveLockRef.current) return;
    const snapshot = { ...currentConfigRef.current };
    if (!validateSummaryTemplates(snapshot.summary_templates, snapshot.default_summary_template_id, templateDefaults.limits).valid) return;
    saveLockRef.current = true;
    setSaving(true);
    setSaved(false);
    setSaveError("");
    try {
      await api.saveConfig(snapshot);
      if (!isMountedRef.current) return;

      savedConfigRef.current = snapshot;
      setSaved(true);
      clearSaveTimeout();
      saveTimeoutRef.current = setTimeout(() => {
        if (isMountedRef.current) {
          setSaved(false);
        }
        saveTimeoutRef.current = null;
      }, 2000);
    } catch (e) {
      if (isMountedRef.current) setSaveError(formatError(e));
    } finally {
      saveLockRef.current = false;
      if (isMountedRef.current) setSaving(false);
    }
  };

  const startQrLogin = useCallback(async () => {
    stopQrPolling();
    const requestSession = qrPollSessionRef.current;
    clearQrAutoCloseTimeout();
    setQrLoginState("loading");
    setQrCodeUrl("");
    setQrMessage("");
    setShowQrModal(true);

    try {
      const info = await api.qrcodeGenerate();
      if (!isMountedRef.current || qrPollSessionRef.current !== requestSession)
        return;

      const sessionId = qrPollSessionRef.current + 1;
      qrPollSessionRef.current = sessionId;
      setQrCodeUrl(info.url);
      setQrLoginState("showing");
      qrPollTimeoutRef.current = setTimeout(() => {
        void pollQrCode(info.qrcode_key, sessionId);
      }, 2000);
    } catch (e) {
      if (!isMountedRef.current || qrPollSessionRef.current !== requestSession)
        return;
      setQrLoginState("error");
      setQrMessage(formatError(e));
    }
  }, [clearQrAutoCloseTimeout, stopQrPolling]);

  const pollQrCode = useCallback(
    async (key: string, sessionId: number) => {
      if (!isMountedRef.current || qrPollSessionRef.current !== sessionId)
        return;

      const scheduleNextPoll = () => {
        clearQrPollTimeout();
        qrPollTimeoutRef.current = setTimeout(() => {
          void pollQrCode(key, sessionId);
        }, 2000);
      };

      try {
        const result = await api.qrcodePoll(key);
        if (!isMountedRef.current || qrPollSessionRef.current !== sessionId)
          return;

        switch (result.status) {
          case "waiting":
            scheduleNextPoll();
            break;
          case "scanned":
            setQrLoginState("scanned");
            setQrMessage("已扫码，请在手机上确认...");
            scheduleNextPoll();
            break;
          case "expired":
            setQrLoginState("expired");
            setQrMessage("二维码已过期，请刷新");
            stopQrPolling();
            break;
          case "success":
            setQrLoginState("success");
            setQrMessage("登录成功！");
            stopQrPolling();
            await loadConfig(true);
            await checkLoginStatus();
            clearQrAutoCloseTimeout();
            qrAutoCloseTimeoutRef.current = setTimeout(() => {
              if (isMountedRef.current) {
                setShowQrModal(false);
                setQrCodeUrl("");
                setQrMessage("");
                setQrLoginState("idle");
              }
              qrAutoCloseTimeoutRef.current = null;
            }, 1500);
            break;
          default:
            scheduleNextPoll();
            break;
        }
      } catch (e) {
        if (isMountedRef.current && qrPollSessionRef.current === sessionId) {
          scheduleNextPoll();
        } else if (isMountedRef.current) {
          setError(formatError(e));
        }
      }
    },
    [
      checkLoginStatus,
      clearQrAutoCloseTimeout,
      clearQrPollTimeout,
      loadConfig,
      stopQrPolling,
    ],
  );

  const closeQrModal = () => {
    stopQrPolling();
    clearQrAutoCloseTimeout();
    setShowQrModal(false);
    setQrCodeUrl("");
    setQrMessage("");
    setQrLoginState("idle");
  };

  const refreshQrCode = async () => {
    stopQrPolling();
    await startQrLogin();
  };

  const handleLogout = async () => {
    try {
      await api.logoutBilibili();
      if (!isMountedRef.current) return;

      setIsLoggedIn(false);
      setLoginUname("");
      setSessdataStatus("idle");
      setSessdataMsg("");
      await loadConfig(true);
    } catch (e) {
      if (isMountedRef.current) {
        setError(formatError(e));
      }
    }
  };

  const mapTestResult = (
    result: api.ConnectionTestResult,
  ): ConnectionTestState => ({
    status: result.severity,
    message: result.message,
  });

  const handleTestLlm = async () => {
    if (!config.llm_api_key) {
      setLlmTest({ status: "error", message: "请先填写 API Key" });
      return;
    }
    setLlmTest({ status: "testing", message: "" });
    try {
      const result = await api.testLlmConnection(
        config.llm_api_key,
        config.llm_base_url,
        config.llm_model,
      );
      if (isMountedRef.current) {
        setLlmTest(mapTestResult(result));
      }
    } catch (e) {
      if (isMountedRef.current) {
        setLlmTest({ status: "error", message: formatError(e) });
      }
    }
  };

  const handleTestAsr = async (provider: api.AsrProvider) => {
    const apiKey =
      provider === "dashscope" ? config.asr_api_key : config.sensevoice_api_key;
    const setter =
      provider === "dashscope" ? setDashscopeTest : setSensevoiceTest;

    if (!apiKey) {
      setter({ status: "error", message: "请先填写 API Key" });
      return;
    }
    setter({ status: "testing", message: "" });
    try {
      const result = await api.testAsrConnection(provider, apiKey);
      if (isMountedRef.current) {
        setter(mapTestResult(result));
      }
    } catch (e) {
      if (isMountedRef.current) {
        setter({ status: "error", message: formatError(e) });
      }
    }
  };

  const handleVerifySessdata = async () => {
    const sessdata = config.bilibili_sessdata;
    if (!sessdata) {
      setSessdataStatus("error");
      setSessdataMsg("请先输入 SESSDATA");
      return;
    }

    setSessdataStatus("verifying");
    setSessdataMsg("");
    try {
      const result = await api.verifySessdata(sessdata);
      if (!isMountedRef.current) return;

      if (result.is_login) {
        setSessdataStatus("valid");
        setSessdataMsg(`验证成功，欢迎 ${result.uname || "用户"}`);
        setIsLoggedIn(true);
        setLoginUname(result.uname || "");
      } else {
        setSessdataStatus("expired");
        setSessdataMsg("SESSDATA 已过期，请重新获取");
      }
    } catch (e) {
      if (!isMountedRef.current) return;
      setSessdataStatus("error");
      setSessdataMsg(formatError(e));
    }
  };


  const templateValidation = templateDefaults
    ? validateSummaryTemplates(config.summary_templates, config.default_summary_template_id, templateDefaults.limits)
    : null;

  const changeTemplates = useCallback((templates: api.SummaryTemplate[], defaultId: string | null) => {
    const updated = { ...currentConfigRef.current, summary_templates: templates, default_summary_template_id: defaultId };
    // Keep late account refreshes and click-time saves in sync before React commits.
    currentConfigRef.current = updated;
    dirtyRef.current = JSON.stringify(updated) !== JSON.stringify(savedConfigRef.current);
    setConfig(updated);
    setSaved(false);
  }, []);

  const changeDefaultTemplate = useCallback((id: string | null) => {
    changeTemplates(currentConfigRef.current.summary_templates, id);
  }, [changeTemplates]);

  useEffect(() => {
    if (showTemplates) {
      window.scrollTo({ top: 0 });
      headingRef.current?.focus({ preventScroll: true });
    } else if (templateViewOpenedRef.current) {
      manageTemplatesRef.current?.focus();
    }
    templateViewOpenedRef.current = showTemplates;
  }, [showTemplates]);

  const asrProvider = config.asr_provider;
  const asrKey =
    asrProvider === "dashscope"
      ? config.asr_api_key
      : config.sensevoice_api_key;
  const asrTest = asrProvider === "dashscope" ? dashscopeTest : sensevoiceTest;

  const header = (
    <header className="page-header settings-header !items-start">
      <div>
        <h1 ref={headingRef} tabIndex={-1} className="outline-none">{showTemplates ? "总结模板" : "设置"}</h1>
        <p className={`mt-3 text-sm leading-6 text-ink-500 sm:text-base ${showTemplates ? "hidden sm:block" : ""}`}>
          {showTemplates ? "把总结写成适合自己的笔记。" : "从视频到笔记，按你的方式工作。"}
        </p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-2 sm:flex-row sm:items-center sm:gap-4">
        <span className="order-2 text-xs text-ink-600 sm:order-1">{dirty ? "未保存的修改" : saving ? "正在保存" : ""}</span>
        <div className="order-1 sm:order-2">
      <button
        className="button-primary shrink-0 !px-4 !text-sm sm:!px-6 sm:!text-base"
        aria-label="保存设置"
        aria-busy={saving}
        disabled={!configLoaded || saving || !templateValidation?.valid}
        onClick={() => void handleSave()}
      >
        {saving ? (
          <Loader2 size={18} className="animate-spin" />
        ) : saved && !dirty ? (
          <Check size={18} />
        ) : (
          <Save size={18} />
        )}
        {saving ? "保存中…" : saved && !dirty ? "已保存" : "保存设置"}
      </button>
        </div>
      </div>
    </header>
  );
  if (!configLoaded)
    return (
      <AppLayout>
        {header}
        {configLoadError ? (
          <div className="panel">
            <LoadFailure
              title="设置暂时无法读取"
              message="没有加载到原有配置，暂时不能保存。请重新读取后再继续。"
              retryLabel="重新读取设置"
              onRetry={() => void loadConfig()}
            />
          </div>
        ) : (
          <LoadingState kind="settings" />
        )}
      </AppLayout>
    );

  return (
    <AppLayout>
      {showTemplates && (
        <button type="button" className="back-line !mb-3 !min-h-10" onClick={() => setShowTemplates(false)}>
          <ArrowLeft size={16} aria-hidden="true" />返回设置
        </button>
      )}
      {header}
      {saveError && (
        <div role="alert" className="mb-5 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm leading-6 text-red-800">
          <p>设置未保存，请重试。你的修改仍然保留。</p>
          <button type="button" className="button-tertiary !text-red-800" onClick={() => setError(saveError)}>查看详情</button>
        </div>
      )}
      {showTemplates && templateDefaults && templateValidation && (
        <SummaryTemplateSettings
          templates={config.summary_templates} defaultId={config.default_summary_template_id}
          defaults={templateDefaults} editingId={editingTemplateId}
          onSelect={setEditingTemplateId} onChange={changeTemplates} validation={templateValidation}
        />
      )}
      {!showTemplates && <>
      <div className="settings-grid">
        <section
          className="settings-group"
          aria-labelledby="transcription-heading"
        >
          <p className="mb-1 text-xs leading-6 text-ink-400">
            视频 → 可阅读的原文
          </p>
          <h2 id="transcription-heading">视频转录</h2>
          <p className="settings-subtitle">先获取内容，再交给 AI 整理。</p>
          <div className="mt-6 rounded-lg bg-[#f1f6e9] px-4 py-3">
            <h3 className="text-sm font-semibold text-primary-700">
              优先使用官方字幕
            </h3>
            <p className="mt-1 text-xs leading-6 text-ink-500">
              有字幕时直接读取；无法获取时，自动使用下方语音识别服务。
            </p>
          </div>
          <div className="mt-5 border-b border-ink-100 pb-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold">
                  B站账号{" "}
                  <span
                    className={`ml-2 rounded px-2 py-1 text-[11px] font-normal ${isLoggedIn ? "bg-primary-50 text-primary-600" : "bg-canvas-100 text-ink-400"}`}
                  >
                    {!loginChecked
                      ? "检查中"
                      : isLoggedIn
                        ? "已登录"
                        : "未登录"}
                  </span>
                </h3>
                <p className="mt-2 text-xs leading-6 text-ink-400">
                  {isLoggedIn
                    ? loginUname || "登录凭证有效"
                    : "登录后可获取需要权限的官方字幕。"}
                </p>
              </div>
              {isLoggedIn ? (
                <button
                  className="button-secondary !min-h-10 !px-3 !text-xs"
                  onClick={() => void handleLogout()}
                >
                  退出登录
                </button>
              ) : (
                <button
                  className="button-secondary !min-h-10 !px-3 !text-xs"
                  onClick={() => void startQrLogin()}
                >
                  <QrCode size={16} />
                  扫码登录
                </button>
              )}
            </div>
            <details
              className="mt-4 text-xs text-ink-500"
              open={showManualInput}
              onToggle={(event) => setShowManualInput(event.currentTarget.open)}
            >
              <summary className="w-fit cursor-pointer py-1 text-ink-400">
                手动填写 SESSDATA
              </summary>
              <div className="mt-3 space-y-3">
                <SectionField
                  label="SESSDATA"
                  description="从浏览器 Cookie 复制；手动验证后请保存设置。"
                >
                  <input
                    type="password"
                    autoComplete="off"
                    value={config.bilibili_sessdata || ""}
                    onChange={(event) => {
                      setConfig({
                        ...config,
                        bilibili_sessdata: event.target.value,
                      });
                      setSessdataStatus("idle");
                    }}
                    className="input-shell"
                  />
                </SectionField>
                <button
                  className="button-secondary"
                  disabled={
                    sessdataStatus === "verifying" || !config.bilibili_sessdata
                  }
                  onClick={() => void handleVerifySessdata()}
                >
                  {sessdataStatus === "verifying" ? "验证中…" : "验证登录"}
                </button>
                {sessdataMsg && (
                  <p
                    role="status"
                    className={`text-xs leading-6 ${sessdataStatus === "valid" ? "text-primary-700" : "text-red-700"}`}
                  >
                    {sessdataMsg}
                  </p>
                )}
              </div>
            </details>
          </div>
          <div className="space-y-5 pt-6">
            <div>
              <h3 className="text-base font-semibold">语音识别</h3>
              <p className="mt-1 text-xs leading-6 text-ink-400">
                仅在没有可用官方字幕时使用。
              </p>
            </div>
            <SectionField label="识别引擎">
              <select
                className="input-shell"
                value={asrProvider}
                onChange={(event) =>
                  setConfig({
                    ...config,
                    asr_provider: event.target.value as api.AsrProvider,
                  })
                }
              >
                <option value="sensevoice">SenseVoice · 硅基流动</option>
                <option value="dashscope">DashScope · 阿里云</option>
              </select>
            </SectionField>
            <p className="!mt-2 text-xs leading-6 text-ink-400">
              {asrProvider === "dashscope"
                ? "单次音频最长 5 分钟，适合短视频。"
                : "适合长视频，使用硅基流动的 API Key。"}
            </p>
            <SectionField
              label={
                asrProvider === "dashscope"
                  ? "DashScope API Key"
                  : "SenseVoice API Key"
              }
            >
              <input
                type="password"
                autoComplete="off"
                value={asrKey || ""}
                onChange={(event) => {
                  setConfig({
                    ...config,
                    [asrProvider === "dashscope"
                      ? "asr_api_key"
                      : "sensevoice_api_key"]: event.target.value,
                  });
                  (asrProvider === "dashscope"
                    ? setDashscopeTest
                    : setSensevoiceTest)(INITIAL_TEST_STATE);
                }}
                placeholder="输入 API Key"
                className="input-shell"
              />
            </SectionField>
            <ConnectionTestRow
              label="测试语音识别连接"
              state={asrTest}
              onTest={() => void handleTestAsr(asrProvider)}
              disabled={!asrKey}
            />
          </div>
        </section>
        <section
          className="settings-group"
          aria-labelledby="generation-heading"
        >
          <p className="mb-1 text-xs leading-6 text-ink-400">
            原文 → 结构化笔记
          </p>
          <h2 id="generation-heading">AI 笔记生成</h2>
          <p className="settings-subtitle">
            把转录整理成总结与清晰的知识结构。
          </p>
          <div className="mt-6 space-y-5">
            {codexSupported && (
              <div
                className="provider-choices"
                role="group"
                aria-label="AI 接入方式"
              >
                {(
                  [
                    {
                      value: "api",
                      label: "API 服务",
                      description: "兼容 OpenAI 协议",
                    },
                    {
                      value: "codex",
                      label: "Codex 订阅",
                      description: "使用本机已登录的订阅",
                    },
                  ] as const
                ).map((provider) => (
                  <button
                    key={provider.value}
                    className="provider-choice"
                    type="button"
                    aria-label={provider.label}
                    aria-pressed={config.llm_provider === provider.value}
                    onClick={() =>
                      setConfig({ ...config, llm_provider: provider.value })
                    }
                  >
                    <strong className="block text-base font-semibold">
                      {provider.label}
                    </strong>
                    <small className="mt-1 block text-xs leading-5 text-ink-400">
                      {provider.description}
                    </small>
                  </button>
                ))}
              </div>
            )}
            {config.llm_provider === "codex" ? (
              codexSupported ? (
                <CodexSettings config={config} onChange={setConfig} />
              ) : (
                <div className="space-y-3 rounded-lg bg-canvas-50 p-4 text-sm leading-7 text-ink-500">
                  <p>当前设备支持 API 服务，请切换后继续生成笔记。</p>
                  <button
                    className="button-secondary"
                    onClick={() =>
                      setConfig({ ...config, llm_provider: "api" })
                    }
                  >
                    使用 API 服务
                  </button>
                </div>
              )
            ) : (
              <>
                <SectionField label="API Key">
                  <input
                    type="password"
                    autoComplete="off"
                    value={config.llm_api_key || ""}
                    onChange={(event) => {
                      setConfig({ ...config, llm_api_key: event.target.value });
                      setLlmTest(INITIAL_TEST_STATE);
                    }}
                    className="input-shell"
                    placeholder="输入模型服务的 API Key"
                  />
                </SectionField>
                <SectionField label="Base URL">
                  <input
                    value={config.llm_base_url || ""}
                    onChange={(event) => {
                      setConfig({
                        ...config,
                        llm_base_url: event.target.value,
                      });
                      setLlmTest(INITIAL_TEST_STATE);
                    }}
                    className="input-shell"
                    placeholder="https://api.openai.com/v1"
                    autoCapitalize="none"
                    spellCheck={false}
                  />
                </SectionField>
                <SectionField label="模型名称">
                  <input
                    value={config.llm_model || ""}
                    onChange={(event) => {
                      setConfig({ ...config, llm_model: event.target.value });
                      setLlmTest(INITIAL_TEST_STATE);
                    }}
                    className="input-shell"
                    placeholder="填写服务支持的模型名称"
                    autoCapitalize="none"
                    spellCheck={false}
                  />
                </SectionField>
                <ConnectionTestRow
                  label="测试模型连接"
                  state={llmTest}
                  onTest={() => void handleTestLlm()}
                  disabled={!config.llm_api_key}
                />
              </>
            )}
            {templateDefaults && (
              <section className="border-t border-ink-100 pt-5" aria-label="总结模板设置">
                <SummaryTemplateSelect
                  templates={config.summary_templates} value={config.default_summary_template_id}
                  defaults={templateDefaults} onChange={changeDefaultTemplate} error={templateValidation?.selectionError}
                />
                {templateValidation && !templateValidation.valid && (
                  <p id="summary-template-validation" role="alert" className="mt-3 text-sm leading-6 text-red-700">{templateValidation.message}</p>
                )}
                <button ref={manageTemplatesRef} type="button" className="button-secondary mt-4" onClick={() => setShowTemplates(true)}>管理模板</button>
              </section>
            )}
            <div className="border-t border-ink-100 pt-5">
              <h3 className="text-base font-semibold">转录完成后</h3>
              <p className="mb-4 mt-1 text-xs leading-6 text-ink-400">
                自动生成所需内容，也可以在笔记里手动生成。
              </p>
              {(
                [
                  {
                    key: "auto_summary",
                    label: "自动生成总结",
                    description: "提炼内容重点，同时生成列表预览",
                  },
                  {
                    key: "auto_mindmap",
                    label: "自动生成思维导图",
                    description: "梳理核心概念与层级关系",
                  },
                ] as const
              ).map((setting) => (
                <div
                  key={setting.key}
                  className="flex items-center justify-between gap-4 py-3"
                >
                  <div>
                    <p className="text-sm font-medium">{setting.label}</p>
                    <p className="mt-1 text-xs leading-5 text-ink-400">
                      {setting.description}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="setting-switch"
                    role="switch"
                    aria-label={setting.label}
                    aria-checked={config[setting.key]}
                    onClick={() =>
                      setConfig({
                        ...config,
                        [setting.key]: !config[setting.key],
                      })
                    }
                  />
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
      <section className="mt-6 flex flex-wrap items-center justify-between gap-4 border-b border-ink-100 px-1 pb-6 pt-1">
        <div>
          <h2 className="text-base font-semibold">同时处理上限</h2>
          <p className="mt-2 text-xs leading-6 text-ink-400">
            转录与 AI 生成分别使用此上限，超出后排队。修改后重启应用生效。
          </p>
        </div>
        <div className="flex gap-2" role="group" aria-label="同时处理上限">
          {[1, 2, 3, 4, 5].map((count) => (
            <button
              key={count}
              className={`h-10 w-10 rounded-lg border text-sm ${config.max_concurrent_transcribe === count ? "border-primary-300 bg-primary-50 font-semibold text-primary-700" : "border-ink-100 bg-white text-ink-500"}`}
              aria-label={`${count} 个任务`}
              aria-pressed={config.max_concurrent_transcribe === count}
              onClick={() =>
                setConfig({ ...config, max_concurrent_transcribe: count })
              }
            >
              {count}
            </button>
          ))}
        </div>
      </section>
      </>}
      <p role="status" className="mt-4 text-sm leading-6 text-ink-600">
        {saving
          ? "正在保存设置…"
          : dirty
            ? "还有未保存的修改"
            : saved
              ? showTemplates ? "设置已保存。" : "设置已保存。并发上限变更需重启后生效。"
              : "修改完成后，点击右上角保存设置。"}
      </p>
      <DialogFrame open={showQrModal} title="扫码登录" onClose={closeQrModal}>
        <p className="mb-5 text-sm leading-7 text-ink-500">
          使用哔哩哔哩 App 扫码，并在手机上确认登录。
        </p>
        <div className="mx-auto flex h-[252px] w-[252px] max-w-full items-center justify-center rounded-xl border border-ink-100 bg-white p-4">
          {qrCodeUrl ? (
            <QRCodeSVG
              value={qrCodeUrl}
              size={220}
              level="M"
              bgColor="#FFFFFF"
              fgColor="#15271D"
            />
          ) : (
            <Loader2 size={32} className="animate-spin text-primary-600" />
          )}
        </div>
        <p
          role="status"
          className="mt-5 break-words text-center text-sm leading-7 text-ink-500"
        >
          {qrMessage || "等待扫码…"}
        </p>
        {(qrLoginState === "expired" || qrLoginState === "error") && (
          <button
            className="button-primary mt-5 w-full"
            onClick={() => void refreshQrCode()}
          >
            <RefreshCw size={16} />
            刷新二维码
          </button>
        )}
        <p className="mt-5 text-xs leading-6 text-ink-400">
          同一部手机上使用时，可以截图后在 B站扫一扫中从相册识别。
        </p>
      </DialogFrame>
      <ErrorModal error={error} onClose={() => setError("")} />
    </AppLayout>
  );
}
