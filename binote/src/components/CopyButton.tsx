import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Copy, Loader2, TriangleAlert } from "lucide-react";

interface Props {
  text: string;
  label?: string;
  successLabel?: string;
  className?: string;
  size?: number;
  ariaLabel?: string;
}

async function writeClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // fallback below
    }
  }

  const previous = document.activeElement;
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  textarea.setSelectionRange(0, text.length);
  try {
    if (!document.execCommand("copy")) throw new Error("clipboard unavailable");
  } finally {
    document.body.removeChild(textarea);
    if (previous instanceof HTMLElement && previous.isConnected)
      previous.focus();
  }
}

export default function CopyButton({
  text,
  label = "复制",
  successLabel = "已复制",
  className = "button-secondary",
  size = 16,
  ariaLabel,
}: Props) {
  const [state, setState] = useState<"idle" | "copying" | "copied" | "error">(
    "idle",
  );
  const mountedRef = useRef(true);
  const pendingRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  const handleCopy = useCallback(async () => {
    if (!text || pendingRef.current) return;
    pendingRef.current = true;
    setState("copying");
    if (timerRef.current) clearTimeout(timerRef.current);
    try {
      await writeClipboard(text);
      if (mountedRef.current) setState("copied");
    } catch {
      if (mountedRef.current) setState("error");
    } finally {
      pendingRef.current = false;
      if (mountedRef.current)
        timerRef.current = setTimeout(() => setState("idle"), 2400);
    }
  }, [text]);

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={className}
      disabled={!text || state === "copying"}
      aria-busy={state === "copying"}
      aria-label={ariaLabel ?? label}
      title={ariaLabel ?? label}
    >
      {state === "copied" ? (
        <Check size={size} />
      ) : state === "copying" ? (
        <Loader2 size={size} className="animate-spin" />
      ) : state === "error" ? (
        <TriangleAlert size={size} />
      ) : (
        <Copy size={size} />
      )}
      <span aria-live="polite">
        {state === "copied"
          ? successLabel
          : state === "error"
            ? "复制失败，请重试"
            : state === "copying"
              ? "正在复制…"
              : label}
      </span>
    </button>
  );
}
