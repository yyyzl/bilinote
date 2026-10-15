import { useRef } from "react";
import { TriangleAlert } from "lucide-react";
import DialogFrame from "./DialogFrame";

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
  const lastError = useRef(error);
  if (error) lastError.current = error;
  return (
    <DialogFrame open={Boolean(error)} title="操作未完成" onClose={onClose}>
      <div className="flex gap-3 text-sm leading-7 text-ink-600">
        <TriangleAlert size={22} className="mt-1 shrink-0 text-amber-600" />
        <p>这次操作没有完成。可以关闭提示后重试，或查看下方原因。</p>
      </div>
      <details className="mt-5 rounded-xl border border-ink-100 bg-canvas-50 p-4">
        <summary className="cursor-pointer text-sm font-medium text-ink-600">
          查看错误详情
        </summary>
        <pre className="mt-3 max-h-[40vh] whitespace-pre-wrap break-all text-xs leading-6 text-ink-500">
          {lastError.current}
        </pre>
      </details>
      <button onClick={onClose} className="button-secondary mt-6 w-full">
        知道了
      </button>
    </DialogFrame>
  );
}
