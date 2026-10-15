import { useEffect, useRef, useState } from "react";
import { Loader2, Plug, ShieldCheck, ShieldAlert } from "lucide-react";
import * as api from "../lib/tauri";
import { formatError } from "./ErrorModal";

interface CodexSettingsProps {
  config: api.AppConfig;
  onChange: (config: api.AppConfig) => void;
}

export default function CodexSettings({
  config,
  onChange,
}: CodexSettingsProps) {
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<api.ConnectionTestResult | null>(null);
  const mounted = useRef(true);
  const revision = useRef(0);
  const pending = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      revision.current += 1;
    };
  }, []);

  useEffect(() => {
    revision.current += 1;
    setResult(null);
  }, [config.codex_model, config.codex_path, config.codex_fast]);

  const testConnection = async () => {
    if (pending.current || !config.codex_model?.trim()) return;
    pending.current = true;
    const current = ++revision.current;
    setTesting(true);
    setResult(null);
    try {
      const response = await api.testCodexConnection(
        config.codex_model.trim(),
        config.codex_path?.trim() || null,
        config.codex_fast,
      );
      if (mounted.current && revision.current === current) setResult(response);
    } catch (error) {
      if (mounted.current && revision.current === current) {
        setResult({
          ok: false,
          severity: "error",
          message: formatError(error),
          latency_ms: 0,
        });
      }
    } finally {
      pending.current = false;
      if (mounted.current) setTesting(false);
    }
  };

  return (
    <div className="space-y-5">
      <p className="text-xs leading-6 text-ink-400">
        使用本机已登录的 Codex 与 ChatGPT 订阅。
      </p>
      <div className="space-y-2">
        <label
          htmlFor="codex-model"
          className="block text-sm font-semibold text-ink-700"
        >
          模型名称
        </label>
        <input
          id="codex-model"
          value={config.codex_model || ""}
          onChange={(event) =>
            onChange({ ...config, codex_model: event.target.value })
          }
          disabled={testing}
          placeholder="填写你在 Codex 中使用的模型名称"
          autoCapitalize="none"
          spellCheck={false}
          className="input-shell"
        />
      </div>
      <fieldset>
        <legend className="mb-3 text-sm font-semibold text-ink-700">
          响应速度
        </legend>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          {(
            [
              { fast: false, label: "标准" },
              { fast: true, label: "Fast" },
            ] as const
          ).map((option) => (
            <label
              key={option.label}
              className="flex cursor-pointer items-center gap-2 text-sm"
            >
              <input
                type="radio"
                name="codex-speed"
                checked={config.codex_fast === option.fast}
                disabled={testing}
                onChange={() =>
                  onChange({ ...config, codex_fast: option.fast })
                }
                className="h-5 w-5 accent-primary-500"
              />
              {option.label}
            </label>
          ))}
          <span className="text-[11px] text-ink-400">
            Fast 消耗更多订阅额度
          </span>
        </div>
      </fieldset>
      <details className="border-t border-ink-100 pt-3">
        <summary className="w-fit cursor-pointer text-xs text-ink-500">
          高级选项
        </summary>
        <div className="mt-4 space-y-3">
          <p className="text-xs leading-6 text-ink-400">
            首次使用请在终端运行{" "}
            <code className="rounded bg-canvas-100 px-1.5 py-0.5 text-ink-600">
              codex login
            </code>{" "}
            完成 ChatGPT 登录，再测试连接。
          </p>
          <label
            htmlFor="codex-path"
            className="block text-sm font-semibold text-ink-700"
          >
            Codex 程序路径（可选）
          </label>
          <input
            id="codex-path"
            value={config.codex_path || ""}
            onChange={(event) =>
              onChange({ ...config, codex_path: event.target.value })
            }
            disabled={testing}
            placeholder="留空自动检测；找不到时填写完整路径"
            spellCheck={false}
            className="input-shell"
          />
          <p className="text-xs leading-6 text-ink-400">
            仅填写程序文件路径。模型不支持 Fast 时，切换标准模式重试。
          </p>
        </div>
      </details>
      <div className="space-y-3">
        <button
          type="button"
          onClick={() => void testConnection()}
          disabled={testing || !config.codex_model?.trim()}
          className="button-secondary !border-primary-200 !bg-primary-50 !text-primary-700"
        >
          {testing ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <Plug size={16} />
          )}
          {testing ? "正在验证 Codex…" : "测试 Codex 连接"}
        </button>
        <p className="text-[11px] leading-6 text-ink-400">
          正式测试会发送短请求，消耗少量订阅额度，最多等待 60 秒。
        </p>
        {result && (
          <div
            role="status"
            className={`flex items-start gap-2 rounded-lg border px-4 py-3 text-sm ${result.ok ? "border-primary-200 bg-primary-50 text-primary-700" : result.severity === "warning" ? "border-gold-300 bg-gold-100 text-[#8e6532]" : "border-red-200 bg-red-50 text-red-700"}`}
          >
            {result.ok ? (
              <ShieldCheck size={16} className="mt-0.5 shrink-0" />
            ) : (
              <ShieldAlert size={16} className="mt-0.5 shrink-0" />
            )}
            <span>{result.message}</span>
          </div>
        )}
      </div>
    </div>
  );
}
