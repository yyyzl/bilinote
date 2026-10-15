import { RefreshCw, TriangleAlert } from "lucide-react";

export default function LoadingState({
  kind,
}: {
  kind: "library" | "settings" | "reader";
}) {
  const label =
    kind === "library"
      ? "正在加载笔记库"
      : kind === "settings"
        ? "正在读取设置"
        : "正在加载笔记";
  return (
    <div
      role="status"
      aria-label={label}
      className={`loading-skeleton skeleton-${kind}`}
    >
      <span className="sr-only">{label}</span>
      <div aria-hidden="true">
        {kind === "library" ? (
          Array.from({ length: 4 }, (_, i) => (
            <div className="skeleton-row" key={i}>
              <div className="skeleton-line w-2/3 !h-5" />
              <div className="skeleton-line mt-4 w-5/6" />
            </div>
          ))
        ) : kind === "settings" ? (
          <div className="settings-grid">
            {[0, 1].map((i) => (
              <div className="settings-group" key={i}>
                <div className="skeleton-line mb-8 w-1/3 !h-7" />
                {[0, 1, 2].map((j) => (
                  <div key={j} className="skeleton-line mb-7 !h-14 w-full" />
                ))}
              </div>
            ))}
          </div>
        ) : (
          <>
            <div className="skeleton-line mb-6 w-2/3 !h-9" />
            <div className="skeleton-line mb-8 w-1/3" />
            <div className="panel space-y-6 p-6 sm:p-8">
              <div className="skeleton-line mb-8 w-1/4 !h-7" />
              {["w-full", "w-5/6", "w-full", "w-2/3", "w-full", "w-5/6"].map(
                (width, i) => (
                  <div className={`skeleton-line ${width}`} key={i} />
                ),
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export function LoadFailure({
  title,
  message,
  retryLabel,
  onRetry,
}: {
  title: string;
  message: string;
  retryLabel: string;
  onRetry: () => void;
}) {
  return (
    <div className="empty-state load-failure" role="alert">
      <TriangleAlert
        size={28}
        className="text-primary-600"
        aria-hidden="true"
      />
      <h3>{title}</h3>
      <p>{message}</p>
      <button className="button-secondary mt-4" onClick={onRetry}>
        <RefreshCw size={16} />
        {retryLabel}
      </button>
    </div>
  );
}
