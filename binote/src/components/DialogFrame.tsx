import {
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { X } from "lucide-react";
import { createPortal } from "react-dom";

interface DialogFrameProps {
  title: string;
  children: ReactNode;
  onClose: () => void;
  open?: boolean;
  busy?: boolean;
  initialFocusRef?: RefObject<HTMLElement>;
}

const dialogStack: symbol[] = [];
let originalOverflow = "";

export default function DialogFrame({
  title,
  children,
  onClose,
  open = true,
  busy = false,
  initialFocusRef,
}: DialogFrameProps) {
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const [present, setPresent] = useState(open);
  const [closing, setClosing] = useState(false);
  const current = useRef({ onClose, open, busy });
  current.current = { onClose, open, busy };

  useEffect(() => {
    if (open) {
      setPresent(true);
      setClosing(false);
      return;
    }
    setClosing(true);
    const timer = setTimeout(
      () => setPresent(false),
      window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 160,
    );
    return () => clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if (!present || !open) return;
    const previous = document.activeElement;
    const token = Symbol("dialog");
    if (!dialogStack.length) originalOverflow = document.body.style.overflow;
    dialogStack.push(token);
    document.body.style.overflow = "hidden";
    (initialFocusRef?.current ?? panel.current)?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (dialogStack[dialogStack.length - 1] !== token) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        if (current.current.open && !current.current.busy)
          current.current.onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const elements = panel.current?.querySelectorAll<HTMLElement>(
        'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex="0"]',
      );
      const first = elements?.[0];
      const last = elements?.[elements.length - 1];
      if (!first) {
        event.preventDefault();
        panel.current?.focus();
      } else if (
        event.shiftKey &&
        (document.activeElement === first ||
          document.activeElement === panel.current)
      ) {
        event.preventDefault();
        last?.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last ||
          document.activeElement === panel.current)
      ) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", keydown);
    return () => {
      const wasTop = dialogStack[dialogStack.length - 1] === token;
      dialogStack.splice(dialogStack.indexOf(token), 1);
      if (!dialogStack.length) document.body.style.overflow = originalOverflow;
      document.removeEventListener("keydown", keydown);
      if (wasTop && previous instanceof HTMLElement && previous.isConnected)
        previous.focus();
    };
  }, [present, open, initialFocusRef]);

  if (!present) return null;
  const dismiss = () => {
    if (!busy && open) onClose();
  };
  return createPortal(
    <div
      data-state={closing ? "closing" : "open"}
      className="dialog-overlay fixed inset-0 z-50 flex items-center justify-center bg-[#12251b]/35 p-4"
      onClick={dismiss}
    >
      <div
        ref={panel}
        role="dialog"
        aria-hidden={!open}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={busy}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        className="dialog-surface max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-6 shadow-float outline-none"
      >
        <div className="mb-6 flex items-center justify-between gap-4">
          <h2 id={titleId} className="text-2xl font-bold">
            {title}
          </h2>
          <button
            onClick={dismiss}
            disabled={busy}
            className="icon-button"
            aria-label={`关闭${title}`}
          >
            <X size={22} />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
