import { useState, useEffect, useRef, useCallback } from "react";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronUp,
  Cloud,
  Cpu,
  Loader2,
  LogOut,
  Plug,
  QrCode,
  RefreshCw,
  Save,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
  Smartphone,
  User,
  X,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { Link } from "react-router-dom";
import * as api from "../lib/tauri";
import ErrorModal, { formatError } from "../components/ErrorModal";

type SessdataStatus = "idle" | "verifying" | "valid" | "expired" | "error";
type QrLoginState = "idle" | "loading" | "showing" | "scanned" | "success" | "expired" | "error";
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
        {state.status === "testing" ? <Loader2 size={16} className="animate-spin" /> : <Plug size={16} />}
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
    <div className="space-y-2">
      <label className="block text-sm font-semibold text-ink-700">{label}</label>
      {description && <p className="text-xs leading-6 text-ink-400">{description}</p>}
      {children}
    </div>
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
    bilibili_sessdata: null,
    bilibili_bili_jct: null,
    bilibili_refresh_token: null,
    bilibili_dede_user_id: null,
    bilibili_cookie_ts: null,
    auto_summary: true,
    auto_mindmap: true,
  });
  const [saved, setSaved] = useState(false);
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

  const [llmTest, setLlmTest] = useState<ConnectionTestState>(INITIAL_TEST_STATE);
  const [dashscopeTest, setDashscopeTest] = useState<ConnectionTestState>(INITIAL_TEST_STATE);
  const [sensevoiceTest, setSensevoiceTest] = useState<ConnectionTestState>(INITIAL_TEST_STATE);

  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const qrPollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const qrAutoCloseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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

  const loadConfig = useCallback(async () => {
    try {
      const data = await api.getConfig();
      if (isMountedRef.current) {
        setConfig(data);
      }
    } catch (e) {
      if (isMountedRef.current) {
        setError(formatError(e));
      }
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
  }, [checkLoginStatus, clearQrAutoCloseTimeout, clearSaveTimeout, loadConfig, stopQrPolling]);

  const handleSave = async () => {
    try {
      await api.saveConfig(config);
      if (!isMountedRef.current) return;

      setSaved(true);
      clearSaveTimeout();
      saveTimeoutRef.current = setTimeout(() => {
        if (isMountedRef.current) {
          setSaved(false);
        }
        saveTimeoutRef.current = null;
      }, 2000);
    } catch (e) {
      if (isMountedRef.current) {
        setError(formatError(e));
      }
    }
  };

  const startQrLogin = useCallback(async () => {
    stopQrPolling();
    clearQrAutoCloseTimeout();
    setQrLoginState("loading");
    setQrCodeUrl("");
    setQrMessage("");
    setShowQrModal(true);

    try {
      const info = await api.qrcodeGenerate();
      if (!isMountedRef.current) return;

      const sessionId = qrPollSessionRef.current + 1;
      qrPollSessionRef.current = sessionId;
      setQrCodeUrl(info.url);
      setQrLoginState("showing");
      qrPollTimeoutRef.current = setTimeout(() => {
        void pollQrCode(info.qrcode_key, sessionId);
      }, 2000);
    } catch (e) {
      if (!isMountedRef.current) return;
      setQrLoginState("error");
      setQrMessage(formatError(e));
    }
  }, [clearQrAutoCloseTimeout, stopQrPolling]);

  const pollQrCode = useCallback(
    async (key: string, sessionId: number) => {
      if (!isMountedRef.current || qrPollSessionRef.current !== sessionId) return;

      const scheduleNextPoll = () => {
        clearQrPollTimeout();
        qrPollTimeoutRef.current = setTimeout(() => {
          void pollQrCode(key, sessionId);
        }, 2000);
      };

      try {
        const result = await api.qrcodePoll(key);
        if (!isMountedRef.current || qrPollSessionRef.current !== sessionId) return;

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
            await loadConfig();
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
    [checkLoginStatus, clearQrAutoCloseTimeout, clearQrPollTimeout, loadConfig, stopQrPolling]
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
      await loadConfig();
    } catch (e) {
      if (isMountedRef.current) {
        setError(formatError(e));
      }
    }
  };

  const mapTestResult = (result: api.ConnectionTestResult): ConnectionTestState => ({
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
    const setter = provider === "dashscope" ? setDashscopeTest : setSensevoiceTest;

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

  const activeAsrProviderLabel = config.asr_provider === "dashscope" ? "DashScope" : "SenseVoice";
  const llmConfigured = Boolean(config.llm_api_key && config.llm_model);
  const qrFrameStateClass =
    qrLoginState === "expired"
      ? "border-ink-200 opacity-40"
      : qrLoginState === "scanned"
        ? "border-primary-300"
        : qrLoginState === "success"
          ? "border-sage-300"
          : "border-ink-100";

  return (
    <div className="app-shell">
      <header className="floating-topbar">
        <div className="topbar-inner">
          <Link to="/" className="button-secondary min-h-11 !px-4" aria-label="返回首页">
            <ArrowLeft size={18} />
            <span className="hidden sm:inline">返回</span>
          </Link>

          <div className="min-w-0 flex-1">
            <p className="editorial-kicker">Configuration Studio</p>
            <h1 className="truncate font-display text-2xl font-semibold leading-tight text-ink-900">
              设置
            </h1>
          </div>
        </div>
      </header>

      <main className="page-shell mt-header-offset pt-6 sm:pt-8">
        <section className="hero-panel ghost-overlay p-6 sm:p-8 lg:p-10">
          <div className="grid gap-8 lg:grid-cols-[1.05fr_0.95fr]">
            <div className="space-y-5">
              <div className="space-y-4">
                <p className="editorial-kicker">Configure your note pipeline</p>
                <h2 className="title-display max-w-3xl">
                  把账号、转录和模型配置
                  <br />
                  放在同一张工作台里。
                </h2>
                <p className="max-w-2xl text-base leading-8 text-ink-500 sm:text-lg">
                  这里决定 BiNote 如何获取字幕、如何做语音识别，以及用什么语言模型生成总结和导图。
                </p>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
              <div className="metric-block">
                <p className="editorial-kicker">B 站登录</p>
                <p className="mt-3 text-sm font-semibold text-ink-800">
                  {loginChecked ? (isLoggedIn ? `已登录${loginUname ? ` · ${loginUname}` : ""}` : "未登录") : "检测中"}
                </p>
              </div>
              <div className="metric-block">
                <p className="editorial-kicker">ASR 提供商</p>
                <p className="mt-3 text-sm font-semibold text-ink-800">{activeAsrProviderLabel}</p>
              </div>
              <div className="metric-block">
                <p className="editorial-kicker">LLM 配置</p>
                <p className="mt-3 text-sm font-semibold text-ink-800">{llmConfigured ? "已配置" : "未完成"}</p>
              </div>
            </div>
          </div>
        </section>

        <section className="mt-8 space-y-8">
          <div className="editorial-card p-5 sm:p-6 lg:p-8">
            <div className="flex flex-col gap-5 border-b border-ink-100 pb-6 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="editorial-kicker">Bilibili Access</p>
                <h2 className="section-display mt-2">B 站账号</h2>
                <p className="mt-2 max-w-2xl text-sm leading-7 text-ink-500">
                  登录后可以优先读取原生字幕，减少 ASR 调用，提升转录质量与速度。
                </p>
              </div>
              {loginChecked && isLoggedIn && (
                <div className="editorial-chip border-sage-200 bg-sage-100/70 text-sage-700">
                  <ShieldCheck size={14} />
                  已连接
                </div>
              )}
            </div>

            <div className="pt-6">
              {isLoggedIn ? (
                <div className="rounded-[28px] border border-sage-200 bg-sage-100/50 p-5 sm:p-6">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-start gap-4">
                      <div className="flex h-12 w-12 items-center justify-center rounded-full border border-sage-200 bg-white/75 text-sage-700">
                        <ShieldCheck size={20} />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-ink-800">当前已登录</p>
                        <p className="mt-1 text-sm leading-7 text-ink-500">
                          {loginUname ? `账号：${loginUname}` : "已获取有效凭证"}
                        </p>
                        <p className="mt-1 text-xs leading-6 text-ink-400">
                          {config.bilibili_refresh_token ? "支持自动刷新登录状态" : "当前为手动 Cookie，过期后需要重新输入"}
                        </p>
                      </div>
                    </div>

                    <button onClick={handleLogout} className="button-secondary">
                      <LogOut size={16} />
                      登出
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  {!loginChecked ? (
                    <div className="rounded-[28px] border border-ink-100 bg-white/70 p-5">
                      <div className="flex items-center gap-3 text-sm text-ink-500">
                        <Loader2 size={18} className="animate-spin text-primary-600" />
                        正在检查登录状态...
                      </div>
                    </div>
                  ) : (
                    <>
                      <button
                        onClick={() => void startQrLogin()}
                        disabled={qrLoginState === "loading"}
                        className="editorial-card-muted w-full cursor-pointer p-5 text-left transition-all duration-200 hover:border-primary-200 hover:bg-primary-50/30"
                      >
                        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                          <div className="flex h-14 w-14 items-center justify-center rounded-full border border-primary-200 bg-primary-50 text-primary-600">
                            {qrLoginState === "loading" ? <Loader2 size={24} className="animate-spin" /> : <QrCode size={24} />}
                          </div>
                          <div className="flex-1">
                            <p className="text-base font-semibold text-ink-900">扫码登录</p>
                            <p className="mt-2 text-sm leading-7 text-ink-500">
                              使用 B 站 App 扫码，自动获取 Cookie，并尽量支持后续续期。
                            </p>
                          </div>
                        </div>
                      </button>

                      <div className="rounded-[28px] border border-ink-100 bg-white/60">
                        <button
                          onClick={() => setShowManualInput((previous) => !previous)}
                          className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left"
                        >
                          <div>
                            <p className="text-sm font-semibold text-ink-800">手动输入 SESSDATA</p>
                            <p className="mt-1 text-xs leading-6 text-ink-400">适用于高级场景，但不支持自动刷新。</p>
                          </div>
                          {showManualInput ? <ChevronUp size={18} className="text-ink-400" /> : <ChevronDown size={18} className="text-ink-400" />}
                        </button>

                        {showManualInput && (
                          <div className="space-y-4 border-t border-ink-100 px-5 py-5">
                            <SectionField label="SESSDATA" description="从浏览器 Cookie 中复制。手动输入方案过期后需要重新获取。">
                              <input
                                type="password"
                                value={config.bilibili_sessdata || ""}
                                onChange={(event) => {
                                  setConfig({
                                    ...config,
                                    bilibili_sessdata: event.target.value || null,
                                    bilibili_bili_jct: null,
                                    bilibili_refresh_token: null,
                                    bilibili_dede_user_id: null,
                                    bilibili_cookie_ts: null,
                                  });
                                  setSessdataStatus("idle");
                                  setSessdataMsg("");
                                }}
                                placeholder="从浏览器 Cookie 中复制 SESSDATA..."
                                className="input-shell"
                              />
                            </SectionField>

                            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                              <button
                                onClick={() => void handleVerifySessdata()}
                                disabled={sessdataStatus === "verifying" || !config.bilibili_sessdata}
                                className="button-secondary"
                              >
                                {sessdataStatus === "verifying" ? <Loader2 size={16} className="animate-spin" /> : <User size={16} />}
                                {sessdataStatus === "verifying" ? "验证中..." : "验证 SESSDATA"}
                              </button>

                              {sessdataStatus === "valid" && (
                                <div className="inline-flex items-center gap-2 rounded-full border border-sage-200 bg-sage-100/70 px-4 py-2 text-sm font-semibold text-sage-700">
                                  <ShieldCheck size={16} />
                                  {sessdataMsg}
                                </div>
                              )}
                              {sessdataStatus === "expired" && (
                                <div className="inline-flex items-center gap-2 rounded-full border border-gold-300 bg-gold-100/80 px-4 py-2 text-sm font-semibold text-[#8e6532]">
                                  <ShieldX size={16} />
                                  {sessdataMsg}
                                </div>
                              )}
                              {sessdataStatus === "error" && (
                                <div className="inline-flex items-center gap-2 rounded-full border border-red-200 bg-red-50 px-4 py-2 text-sm font-semibold text-red-600">
                                  <ShieldAlert size={16} />
                                  {sessdataMsg}
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="grid gap-8 xl:grid-cols-2">
            <div className="editorial-card p-5 sm:p-6 lg:p-8">
              <div className="border-b border-ink-100 pb-6">
                <p className="editorial-kicker">Speech To Text</p>
                <h2 className="section-display mt-2">语音识别（ASR）</h2>
                <p className="mt-2 text-sm leading-7 text-ink-500">选择转录服务提供商，并填写对应的 API Key。</p>
              </div>

              <div className="space-y-5 pt-6">
                <div className="grid gap-4 sm:grid-cols-2">
                  <button
                    onClick={() => setConfig({ ...config, asr_provider: "dashscope" })}
                    className={`cursor-pointer rounded-[28px] border p-5 text-left transition-all duration-200 ${
                      config.asr_provider === "dashscope"
                        ? "border-primary-300 bg-primary-50/[0.35] shadow-soft"
                        : "border-ink-100 bg-white/[0.55] hover:border-ink-200 hover:bg-white/70"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className={`flex h-12 w-12 items-center justify-center rounded-full border ${
                        config.asr_provider === "dashscope"
                          ? "border-primary-200 bg-white text-primary-600"
                          : "border-ink-100 bg-canvas-100 text-ink-400"
                      }`}>
                        <Cloud size={20} />
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="inline-flex items-center gap-1 rounded-full border border-gold-300 bg-gold-100/80 px-2.5 py-1 text-[11px] font-semibold text-[#8e6532]">
                          ≤ 5 分钟
                        </span>
                        {config.asr_provider === "dashscope" && (
                          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary-500 text-white">
                            <Check size={14} />
                          </div>
                        )}
                      </div>
                    </div>
                    <p className="mt-5 text-base font-semibold text-ink-900">阿里云 DashScope</p>
                    <p className="mt-2 text-sm leading-7 text-ink-500">
                      准确度高，但<span className="font-semibold text-[#8e6532]">单次音频最长 5 分钟</span>，超过会失败，仅推荐用于短视频。
                    </p>
                  </button>

                  <button
                    onClick={() => setConfig({ ...config, asr_provider: "sensevoice" })}
                    className={`cursor-pointer rounded-[28px] border p-5 text-left transition-all duration-200 ${
                      config.asr_provider === "sensevoice"
                        ? "border-primary-300 bg-primary-50/[0.35] shadow-soft"
                        : "border-ink-100 bg-white/[0.55] hover:border-ink-200 hover:bg-white/70"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className={`flex h-12 w-12 items-center justify-center rounded-full border ${
                        config.asr_provider === "sensevoice"
                          ? "border-primary-200 bg-white text-primary-600"
                          : "border-ink-100 bg-canvas-100 text-ink-400"
                      }`}>
                        <Cpu size={20} />
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="inline-flex items-center gap-1 rounded-full border border-sage-200 bg-sage-100/80 px-2.5 py-1 text-[11px] font-semibold text-sage-700">
                          推荐
                        </span>
                        {config.asr_provider === "sensevoice" && (
                          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary-500 text-white">
                            <Check size={14} />
                          </div>
                        )}
                      </div>
                    </div>
                    <p className="mt-5 text-base font-semibold text-ink-900">SenseVoice（硅基流动）</p>
                    <p className="mt-2 text-sm leading-7 text-ink-500">
                      无明显时长限制，速度快、性价比高，长视频首选。
                    </p>
                  </button>
                </div>

                {config.asr_provider === "dashscope" && (
                  <SectionField label="DashScope API Key">
                    <input
                      type="password"
                      value={config.asr_api_key || ""}
                      onChange={(event) => {
                        setConfig({ ...config, asr_api_key: event.target.value });
                        setDashscopeTest(INITIAL_TEST_STATE);
                      }}
                      placeholder="sk-..."
                      className="input-shell"
                    />
                    <ConnectionTestRow
                      label="测试连接"
                      state={dashscopeTest}
                      onTest={() => void handleTestAsr("dashscope")}
                      disabled={!config.asr_api_key}
                    />
                  </SectionField>
                )}

                {config.asr_provider === "sensevoice" && (
                  <SectionField label="SenseVoice API Key">
                    <input
                      type="password"
                      value={config.sensevoice_api_key || ""}
                      onChange={(event) => {
                        setConfig({ ...config, sensevoice_api_key: event.target.value });
                        setSensevoiceTest(INITIAL_TEST_STATE);
                      }}
                      placeholder="sk-..."
                      className="input-shell"
                    />
                    <ConnectionTestRow
                      label="测试连接"
                      state={sensevoiceTest}
                      onTest={() => void handleTestAsr("sensevoice")}
                      disabled={!config.sensevoice_api_key}
                    />
                  </SectionField>
                )}
              </div>
            </div>

            <div className="editorial-card p-5 sm:p-6 lg:p-8">
              <div className="border-b border-ink-100 pb-6">
                <p className="editorial-kicker">Language Model</p>
                <h2 className="section-display mt-2">语言模型（LLM）</h2>
                <p className="mt-2 text-sm leading-7 text-ink-500">配置总结与思维导图所使用的模型服务。</p>
              </div>

              <div className="space-y-5 pt-6">
                <SectionField label="API Key">
                  <input
                    type="password"
                    value={config.llm_api_key || ""}
                    onChange={(event) => {
                      setConfig({ ...config, llm_api_key: event.target.value });
                      setLlmTest(INITIAL_TEST_STATE);
                    }}
                    placeholder="sk-..."
                    className="input-shell"
                  />
                </SectionField>

                <SectionField label="Base URL" description="如果你使用兼容 OpenAI 协议的服务，请填写完整地址。">
                  <input
                    type="text"
                    value={config.llm_base_url || ""}
                    onChange={(event) => {
                      setConfig({ ...config, llm_base_url: event.target.value });
                      setLlmTest(INITIAL_TEST_STATE);
                    }}
                    placeholder="https://api.openai.com/v1"
                    className="input-shell"
                  />
                </SectionField>

                <SectionField label="Model">
                  <input
                    type="text"
                    value={config.llm_model || ""}
                    onChange={(event) => {
                      setConfig({ ...config, llm_model: event.target.value });
                      setLlmTest(INITIAL_TEST_STATE);
                    }}
                    placeholder="gpt-4o-mini"
                    className="input-shell"
                  />
                </SectionField>

                <ConnectionTestRow
                  label="测试 LLM 连接"
                  state={llmTest}
                  onTest={() => void handleTestLlm()}
                  disabled={!config.llm_api_key}
                />

                <SectionField
                  label="转录后自动生成"
                  description="转录完成后默认自动调用 LLM 生成下列内容。关闭后仍可在笔记详情页手动补生成。"
                >
                  <div className="grid gap-3 sm:grid-cols-2">
                    <button
                      type="button"
                      onClick={() => setConfig({ ...config, auto_summary: !config.auto_summary })}
                      aria-pressed={config.auto_summary}
                      className={`flex items-center justify-between gap-3 rounded-[24px] border p-4 text-left transition-all duration-200 ${
                        config.auto_summary
                          ? "border-primary-300 bg-primary-50/[0.35] shadow-soft"
                          : "border-ink-100 bg-white/[0.55] hover:border-ink-200 hover:bg-white/70"
                      }`}
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-ink-900">AI 总结</p>
                        <p className="mt-1 text-xs leading-6 text-ink-500">
                          {config.auto_summary ? "已开启" : "已关闭"}
                        </p>
                      </div>
                      <div
                        className={`flex h-7 w-7 items-center justify-center rounded-full ${
                          config.auto_summary
                            ? "bg-primary-500 text-white"
                            : "border border-ink-200 bg-white text-ink-400"
                        }`}
                        aria-hidden="true"
                      >
                        {config.auto_summary ? <Check size={14} /> : <X size={14} />}
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => setConfig({ ...config, auto_mindmap: !config.auto_mindmap })}
                      aria-pressed={config.auto_mindmap}
                      className={`flex items-center justify-between gap-3 rounded-[24px] border p-4 text-left transition-all duration-200 ${
                        config.auto_mindmap
                          ? "border-primary-300 bg-primary-50/[0.35] shadow-soft"
                          : "border-ink-100 bg-white/[0.55] hover:border-ink-200 hover:bg-white/70"
                      }`}
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-ink-900">思维导图</p>
                        <p className="mt-1 text-xs leading-6 text-ink-500">
                          {config.auto_mindmap ? "已开启" : "已关闭"}
                        </p>
                      </div>
                      <div
                        className={`flex h-7 w-7 items-center justify-center rounded-full ${
                          config.auto_mindmap
                            ? "bg-primary-500 text-white"
                            : "border border-ink-200 bg-white text-ink-400"
                        }`}
                        aria-hidden="true"
                      >
                        {config.auto_mindmap ? <Check size={14} /> : <X size={14} />}
                      </div>
                    </button>
                  </div>
                </SectionField>
              </div>
            </div>
          </div>

          <div className="editorial-card-muted p-4 sm:p-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="editorial-kicker">Persist Changes</p>
                <p className="mt-2 text-sm leading-7 text-ink-500">
                  保存后立即生效。建议修改完账号、ASR 和 LLM 配置后统一保存一次。
                </p>
              </div>
              <button onClick={() => void handleSave()} className="button-primary sm:min-w-[180px]">
                {saved ? <Check size={18} /> : <Save size={18} />}
                {saved ? "已保存" : "保存配置"}
              </button>
            </div>
          </div>
        </section>
      </main>

      {showQrModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/[0.35] p-4 backdrop-blur-md">
          <div className="w-full max-w-md overflow-hidden rounded-[30px] border border-paper-200/80 bg-paper-50/[0.96] shadow-float ring-1 ring-white/70">
            <div className="flex items-start justify-between border-b border-ink-100 px-6 py-5">
              <div>
                <p className="editorial-kicker">QR Login</p>
                <h3 className="mt-1 font-display text-2xl font-semibold text-ink-900">扫码登录</h3>
              </div>
              <button onClick={closeQrModal} className="button-tertiary min-h-10 !px-3 !py-2" aria-label="关闭扫码登录弹窗">
                <X size={18} />
              </button>
            </div>

            <div className="space-y-5 p-6">
              <div className={`mx-auto flex w-fit items-center justify-center rounded-[28px] border-2 bg-white p-4 ${qrFrameStateClass}`}>
                {qrCodeUrl ? (
                  <QRCodeSVG value={qrCodeUrl} size={220} level="M" bgColor="#FFFFFF" fgColor="#1F1B18" />
                ) : (
                  <div className="flex h-[220px] w-[220px] items-center justify-center">
                    <Loader2 size={32} className="animate-spin text-primary-600" />
                  </div>
                )}
              </div>

              <div className="text-center">
                {qrLoginState === "showing" && <p className="text-sm leading-7 text-ink-500">等待扫码...</p>}
                {qrLoginState === "scanned" && (
                  <p className="inline-flex items-center gap-2 rounded-full border border-primary-200 bg-primary-50 px-4 py-2 text-sm font-semibold text-primary-700">
                    <Smartphone size={16} />
                    {qrMessage}
                  </p>
                )}
                {qrLoginState === "success" && (
                  <p className="inline-flex items-center gap-2 rounded-full border border-sage-200 bg-sage-100/70 px-4 py-2 text-sm font-semibold text-sage-700">
                    <ShieldCheck size={16} />
                    {qrMessage}
                  </p>
                )}
                {qrLoginState === "expired" && (
                  <p className="inline-flex items-center gap-2 rounded-full border border-gold-300 bg-gold-100/80 px-4 py-2 text-sm font-semibold text-[#8e6532]">
                    <ShieldX size={16} />
                    {qrMessage}
                  </p>
                )}
                {qrLoginState === "error" && (
                  <p className="inline-flex items-center gap-2 rounded-full border border-red-200 bg-red-50 px-4 py-2 text-sm font-semibold text-red-600">
                    <ShieldAlert size={16} />
                    {qrMessage}
                  </p>
                )}
              </div>

              {qrLoginState === "expired" && (
                <button onClick={() => void refreshQrCode()} className="button-primary w-full">
                  <RefreshCw size={16} />
                  刷新二维码
                </button>
              )}

              {(qrLoginState === "showing" || qrLoginState === "expired") && (
                <div className="rounded-[24px] border border-ink-100 bg-white/[0.65] p-4">
                  <p className="editorial-kicker">How To</p>
                  <div className="mt-3 space-y-2 text-sm leading-7 text-ink-500">
                    <p>1. 长按二维码保存图片，或直接截图。</p>
                    <p>2. 打开哔哩哔哩 App。</p>
                    <p>3. 点击左上角扫一扫，并选择相册中的图片。</p>
                    <p>4. 在手机上确认登录即可。</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <ErrorModal error={error} onClose={() => setError("")} />
    </div>
  );
}
