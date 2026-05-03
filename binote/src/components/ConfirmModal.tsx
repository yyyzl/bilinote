import { useEffect, useRef } from "react";
import { AlertTriangle, X } from "lucide-react";

interface ConfirmModalProps {
  open: boolean;
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  onConfirm: () => void;
  onCancel: () => void;
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
  variant = "danger",
}: ConfirmModalProps) {
  const cancelBtnRef = useRef<HTMLButtonElement>(null);

  // 打开时聚焦取消按钮，防止误操作；同时禁用背景滚动
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
      // 延迟聚焦以确保 DOM 已渲染
      requestAnimationFrame(() => {
        cancelBtnRef.current?.focus();
      });
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  // ESC 关闭
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!open) return;
      if (e.key === "Escape") {
        onCancel();
      } else if (e.key === "Enter") {
        e.preventDefault();
        onConfirm();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onCancel, onConfirm]);

  if (!open) return null;

  const variantStyles = {
    danger: {
      icon: "border-red-200 bg-red-50 text-red-600",
      confirmBtn: "border-red-600 bg-red-500 hover:border-red-700 hover:bg-red-600 focus:ring-red-200",
      label: "Sensitive Action",
    },
    warning: {
      icon: "border-amber-200 bg-amber-50 text-amber-600",
      confirmBtn: "border-amber-500 bg-amber-500 hover:border-amber-600 hover:bg-amber-600 focus:ring-amber-200",
      label: "Careful Review",
    },
    default: {
      icon: "border-primary-200 bg-primary-50 text-primary-600",
      confirmBtn: "border-primary-600 bg-primary-500 hover:border-primary-700 hover:bg-primary-600 focus:ring-primary-200",
      label: "Confirm Action",
    },
  };

  const styles = variantStyles[variant];

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-modal-title"
      aria-describedby="confirm-modal-description"
    >
      {/* 背景遮罩 - 毛玻璃效果 */}
      <div
        className="fixed inset-0 bg-ink-900/[0.35] backdrop-blur-md transition-opacity"
        onClick={onCancel}
        aria-hidden="true"
      />

      {/* 弹窗容器 */}
      <div className="flex min-h-full items-center justify-center p-4">
        <div
          className="relative w-full max-w-md transform overflow-hidden rounded-[28px] border border-paper-200/90 bg-paper-50/[0.96] shadow-float ring-1 ring-white/70 transition-all"
          onClick={(e) => e.stopPropagation()}
        >
          {/* 关闭按钮 */}
          <button
            onClick={onCancel}
            className="button-tertiary absolute right-4 top-4 z-10 min-h-10 !px-3 !py-2"
            aria-label="关闭确认弹窗"
          >
            <X size={18} />
          </button>

          {/* 内容区域 */}
          <div className="px-6 pb-6 pt-8">
            {/* 图标 */}
            <div className="mb-6 flex justify-center">
              <div
                className={`flex h-14 w-14 items-center justify-center rounded-full border ${styles.icon}`}
              >
                <AlertTriangle size={28} strokeWidth={2} />
              </div>
            </div>

            <div className="text-center">
              <p className="editorial-kicker">{styles.label}</p>
              <h3 id="confirm-modal-title" className="mt-2 font-display text-2xl font-semibold leading-tight text-ink-900">
                {title}
              </h3>
              <p
                id="confirm-modal-description"
                className="mx-auto mt-3 max-w-sm text-sm leading-7 text-ink-500"
              >
                {message}
              </p>
            </div>
          </div>

          {/* 按钮区域 */}
          <div className="flex gap-3 px-6 pb-6">
            <button
              ref={cancelBtnRef}
              onClick={onCancel}
              className="button-secondary flex-1"
            >
              {cancelText}
            </button>
            <button
              onClick={onConfirm}
              className={`flex min-h-11 flex-1 items-center justify-center rounded-full border px-4 py-3 text-sm font-semibold text-white transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-canvas-50 ${styles.confirmBtn}`}
            >
              {confirmText}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
