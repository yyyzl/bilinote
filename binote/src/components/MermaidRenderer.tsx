import { useEffect, useRef, useState } from "react";
import mermaid from "mermaid";
import { AlertCircle, ZoomIn, ZoomOut, RotateCcw, RefreshCw } from "lucide-react";

interface Props {
  code: string;
  className?: string;
  onRegenerate?: () => void;
}

// 初始化 mermaid 配置（只执行一次）
let mermaidInitialized = false;
function initMermaid() {
  if (mermaidInitialized) return;
  mermaid.initialize({
    startOnLoad: false,
    theme: "base",
    securityLevel: "strict", // 使用 strict 模式防止 XSS
    mindmap: {
      padding: 20,
    },
    themeVariables: {
      fontFamily: "Manrope, system-ui, sans-serif",
      primaryColor: "#f5efe4",
      primaryTextColor: "#1f1b18",
      primaryBorderColor: "#d7a084",
      lineColor: "#8f7e6f",
      secondaryColor: "#fbf7ef",
      tertiaryColor: "#f2e2d8",
      clusterBkg: "#fffdf8",
      clusterBorder: "#d7a084",
    },
  });
  mermaidInitialized = true;
}
initMermaid();

export default function MermaidRenderer({ code, className, onRegenerate }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [scale, setScale] = useState(1);
  const renderIdRef = useRef(0);

  useEffect(() => {
    const render = async () => {
      if (!containerRef.current || !code) return;

      // 生成唯一 ID
      renderIdRef.current += 1;
      const id = `mermaid-${Date.now()}-${renderIdRef.current}`;

      try {
        const { svg } = await mermaid.render(id, code);
        if (containerRef.current) {
          containerRef.current.innerHTML = svg;
          setError(null);
        }
      } catch (e) {
        console.error("Mermaid render error:", e);
        setError(e instanceof Error ? e.message : "渲染失败");
      }
    };

    render();
  }, [code]);

  const handleZoomIn = () => setScale((s) => Math.min(s + 0.2, 3));
  const handleZoomOut = () => setScale((s) => Math.max(s - 0.2, 0.4));
  const handleReset = () => setScale(1);

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-10 text-center text-ink-500">
        <div className="flex h-14 w-14 items-center justify-center rounded-full border border-amber-200 bg-amber-50 text-amber-600">
          <AlertCircle size={28} />
        </div>
        <p className="mt-5 font-display text-2xl font-semibold text-ink-900">思维导图渲染失败</p>
        <p className="mt-2 text-sm leading-7 text-ink-500">Mermaid 语法可能有误，可以重新生成后再试。</p>
        {onRegenerate && (
          <button
            onClick={onRegenerate}
            className="button-primary mt-5"
          >
            <RefreshCw size={14} />
            重新生成
          </button>
        )}
        <details className="mt-5 w-full rounded-[24px] border border-ink-100 bg-white/[0.55] p-4 text-left">
          <summary className="cursor-pointer text-xs font-semibold uppercase tracking-[0.2em] text-ink-400 transition-colors hover:text-ink-600">
            查看原始代码
          </summary>
          <pre className="mt-4 max-h-40 overflow-auto rounded-[18px] border border-ink-100 bg-canvas-100/70 p-3 text-xs leading-6 text-ink-600">
            {code}
          </pre>
        </details>
      </div>
    );
  }

  return (
    <div className={className}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="editorial-kicker">Mindmap View</p>
          <p className="mt-1 text-sm text-ink-500">支持缩放查看节点结构，适合快速浏览视频脉络。</p>
        </div>

        {/* 缩放控制栏 */}
        <div className="flex items-center gap-1 rounded-full border border-ink-100 bg-white/[0.65] p-1">
          <button
            onClick={handleZoomOut}
            className="button-tertiary min-h-9 !rounded-full !px-3 !py-2"
            title="缩小"
            aria-label="缩小思维导图"
          >
            <ZoomOut size={16} />
          </button>
          <span className="min-w-[3.5rem] text-center text-xs font-semibold text-ink-400">
            {Math.round(scale * 100)}%
          </span>
          <button
            onClick={handleZoomIn}
            className="button-tertiary min-h-9 !rounded-full !px-3 !py-2"
            title="放大"
            aria-label="放大思维导图"
          >
            <ZoomIn size={16} />
          </button>
          <button
            onClick={handleReset}
            className="button-tertiary min-h-9 !rounded-full !px-3 !py-2"
            title="重置"
            aria-label="重置思维导图缩放"
          >
            <RotateCcw size={16} />
          </button>
        </div>
      </div>

      {/* 思维导图容器 */}
      <div className="rounded-[28px] border border-ink-100/80 bg-white/[0.55] p-4 sm:p-6">
        <div
          ref={containerRef}
          style={{
            transform: `scale(${scale})`,
            transformOrigin: "top left",
            transition: "transform 0.2s ease",
          }}
          className="overflow-auto rounded-[24px] border border-white/80 bg-paper-50/[0.88] p-3 sm:p-4 [&_svg]:max-w-none"
        />
      </div>
    </div>
  );
}
