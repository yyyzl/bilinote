import { useEffect, useRef, useState } from "react";
import { Loader2, Plug, ShieldCheck, ShieldAlert } from "lucide-react";
import * as api from "../lib/tauri";
import { formatError } from "./ErrorModal";

interface CodexSettingsProps {
  config: api.AppConfig;
  onChange: (config: api.AppConfig) => void;
}

export default function CodexSettings({ config, onChange }: CodexSettingsProps) {
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<api.ConnectionTestResult | null>(null);
  const mounted = useRef(true);
  const revision = useRef(0);
  const pending = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; revision.current += 1; };
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
        config.codex_model.trim(), config.codex_path?.trim() || null, config.codex_fast,
      );
      if (mounted.current && revision.current === current) setResult(response);
    } catch (error) {
      if (mounted.current && revision.current === current) {
        setResult({ ok: false, severity: "error", message: formatError(error), latency_ms: 0 });
      }
    } finally {
      pending.current = false;
      if (mounted.current) setTesting(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-ink-100 bg-paper-50 p-4 text-sm leading-7 text-ink-500">
        使用本机 Codex CLI 和 ChatGPT 订阅。首次使用，请先在终端运行
        <code className="mx-1 rounded bg-ink-100 px-1.5 py-0.5 text-xs text-ink-700">codex login</code>
        完成 ChatGPT 登录，再在这里测试连接。
      </div>

      <div className="space-y-2">
        <label htmlFor="codex-model" className="block text-sm font-semibold text-ink-700">模型名称</label>
        <input
          id="codex-model"
          type="text"
          value={config.codex_model || ""}
          onChange={(event) => onChange({ ...config, codex_model: event.target.value })}
          disabled={testing}
          placeholder="例如 gpt-6-luna"
          autoCapitalize="none"
          spellCheck={false}
          className="input-shell"
        />
        <p className="text-xs leading-6 text-ink-400">填写你在 Codex 中使用的模型名称，测试连接可验证该模型是否可用。</p>
      </div>

      <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-ink-100 p-4">
        <input
          type="checkbox"
          checked={config.codex_fast}
          disabled={testing}
          onChange={(event) => onChange({ ...config, codex_fast: event.target.checked })}
          className="mt-1 h-4 w-4 accent-sage-500"
        />
        <span>
          <span className="block text-sm font-semibold text-ink-700">Fast 模式</span>
          <span className="mt-1 block text-xs leading-6 text-ink-400">加快生成，会消耗更多订阅额度；模型不支持时请关闭后重试。</span>
        </span>
      </label>

      <details className="rounded-2xl border border-ink-100 p-4">
        <summary className="cursor-pointer text-sm font-semibold text-ink-700">高级选项</summary>
        <div className="mt-4 space-y-2">
          <label htmlFor="codex-path" className="block text-sm font-semibold text-ink-700">Codex 程序路径（可选）</label>
          <input
            id="codex-path"
            type="text"
            value={config.codex_path || ""}
            onChange={(event) => onChange({ ...config, codex_path: event.target.value })}
            disabled={testing}
            placeholder="留空自动检测；找不到时填写完整路径"
            spellCheck={false}
            className="input-shell"
          />
          <p className="text-xs leading-6 text-ink-400">填写程序文件路径，不要附加参数或引号。</p>
        </div>
      </details>

      <div className="space-y-3">
        <button
          type="button"
          onClick={() => void testConnection()}
          disabled={testing || !config.codex_model?.trim()}
          className="button-secondary"
        >
          {testing ? <Loader2 size={16} className="animate-spin" /> : <Plug size={16} />}
          {testing ? "正在验证 Codex..." : "测试 Codex 连接"}
        </button>
        <p className="text-xs leading-6 text-ink-400">使用当前填写的模型发送一条短请求，会消耗少量订阅额度，最多等待 60 秒。修改后请保存设置。</p>
        {result && (
          <div role="status" className={`flex items-start gap-2 rounded-2xl border px-4 py-3 text-sm font-semibold ${
            result.ok ? "border-sage-200 bg-sage-100/70 text-sage-700"
              : result.severity === "warning" ? "border-gold-300 bg-gold-100/80 text-[#8e6532]"
                : "border-red-200 bg-red-50 text-red-600"
          }`}>
            {result.ok ? <ShieldCheck size={16} className="mt-0.5 shrink-0" /> : <ShieldAlert size={16} className="mt-0.5 shrink-0" />}
            <span>{result.message}</span>
          </div>
        )}
      </div>
    </div>
  );
}
