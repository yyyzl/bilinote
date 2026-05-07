import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";

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
    document.execCommand("copy");
  } finally {
    document.body.removeChild(textarea);
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
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  const handleCopy = useCallback(async () => {
    if (!text) return;
    try {
      await writeClipboard(text);
      setCopied(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), 1600);
    } catch (err) {
      console.error("Copy failed:", err);
    }
  }, [text]);

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={className}
      aria-label={ariaLabel ?? label}
      title={ariaLabel ?? label}
    >
      {copied ? <Check size={size} /> : <Copy size={size} />}
      <span>{copied ? successLabel : label}</span>
    </button>
  );
}
