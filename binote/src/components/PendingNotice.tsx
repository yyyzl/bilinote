import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

export default function PendingNotice({
  message,
  detail = "后台会继续处理，完成后自动更新。你也可以先查看原文或离开页面。",
  startedAt,
  onCancel,
  cancelling = false,
}: {
  message: string;
  detail?: string;
  startedAt?: number;
  onCancel?: () => void;
  cancelling?: boolean;
}) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const start = startedAt ?? Date.now();
    const update = () =>
      setElapsed(Math.max(0, Math.floor((Date.now() - start) / 1000)));
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [startedAt]);
  return (
    <div className="pending-notice" role="status">
      <Loader2
        size={20}
        className="mt-0.5 shrink-0 animate-spin"
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        <p className="break-words font-medium" aria-live="polite">
          {message}
        </p>
        <p className="mt-1 text-xs leading-6 text-ink-500">
          {detail}
          {elapsed >= 8 && <span className="ml-2">已等待 {elapsed} 秒</span>}
        </p>
      </div>
      {onCancel && (
        <button
          className="button-tertiary shrink-0"
          onClick={onCancel}
          disabled={cancelling}
        >
          {cancelling ? "正在取消…" : "取消生成"}
        </button>
      )}
    </div>
  );
}
