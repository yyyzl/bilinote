import { useRef } from "react";
import { Loader2 } from "lucide-react";
import DialogFrame from "./DialogFrame";

interface ConfirmModalProps {
  open: boolean;
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
  variant?: "danger" | "warning" | "default";
}

export default function ConfirmModal({
  open,
  title = "确认操作",
  message,
  confirmText = "确认",
  cancelText = "取消",
  onConfirm,
  onCancel,
  busy = false,
  variant = "danger",
}: ConfirmModalProps) {
  const cancelBtnRef = useRef<HTMLButtonElement>(null);
  return (
    <DialogFrame
      open={open}
      title={title}
      onClose={onCancel}
      busy={busy}
      initialFocusRef={cancelBtnRef}
    >
      <p className="text-sm leading-7 text-ink-500">{message}</p>
      <div className="mt-7 flex gap-3">
        <button
          ref={cancelBtnRef}
          disabled={busy}
          onClick={onCancel}
          className="button-secondary flex-1"
        >
          {cancelText}
        </button>
        <button
          disabled={busy}
          onClick={onConfirm}
          className={`button-primary flex-1 ${variant === "danger" ? "!bg-red-600 !text-white hover:!bg-red-700" : ""}`}
        >
          {busy && <Loader2 size={16} className="animate-spin" />}
          {busy ? "正在处理…" : confirmText}
        </button>
      </div>
    </DialogFrame>
  );
}
