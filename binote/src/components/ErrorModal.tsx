import { useEffect } from "react";
import { AlertTriangle, X } from "lucide-react";

interface ErrorModalProps {
  error: string | null;
  onClose: () => void;
}

export function formatError(e: unknown): string {
  if (!e) return "未知错误";
  if (typeof e === "string") return e;
  if (e instanceof Error) return `${e.name}: ${e.message}\n${e.stack || ""}`;
  try {
    return JSON.stringify(e, null, 2);
  } catch {
    return String(e);
  }
}

export default function ErrorModal({ error, onClose }: ErrorModalProps) {
  useEffect(() => {
    if (!error) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [error, onClose]);

  if (!error) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/[0.35] p-4 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-labelledby="error-modal-title"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl overflow-hidden rounded-[28px] border border-paper-200/80 bg-paper-50/[0.96] shadow-float ring-1 ring-white/70"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-ink-100/80 px-6 py-5">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-full border border-red-200 bg-red-50 text-red-500">
              <AlertTriangle size={20} />
            </div>
            <div>
              <p className="editorial-kicker">Error Report</p>
              <h3 id="error-modal-title" className="mt-1 font-display text-2xl font-semibold text-ink-900">
                发生错误
              </h3>
              <p className="mt-2 max-w-xl text-sm leading-6 text-ink-500">
                操作没有成功完成。下面是详细错误信息，方便你定位问题。
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="button-tertiary min-h-10 self-start !px-3 !py-2"
            aria-label="关闭错误详情"
          >
            <X size={18} />
          </button>
        </div>

        <div className="space-y-4 p-6">
          <div className="editorial-chip border-red-200 bg-red-50 text-red-600">
            <span className="h-2 w-2 rounded-full bg-red-500" />
            Technical Details
          </div>
          <pre className="max-h-[56vh] overflow-auto rounded-[24px] border border-red-100 bg-red-50/60 p-4 font-mono text-sm leading-7 text-red-700 whitespace-pre-wrap break-all">
            {error}
          </pre>
          <div className="flex justify-end">
            <button onClick={onClose} className="button-secondary">
              关闭
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
