import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

export function Toaster() {
  const { toasts, dismiss } = useToast();

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex max-h-[80vh] w-[360px] flex-col gap-2">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={cn(
            "pointer-events-auto rounded-lg border bg-background/95 shadow-lg backdrop-blur px-3 py-2",
            toast.variant === "destructive" &&
              "border-red-500/40 text-red-500 dark:text-red-400",
          )}
        >
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium truncate">{toast.title}</p>
              {toast.description && (
                <p className="text-xs text-muted-foreground mt-0.5 whitespace-pre-wrap break-words">
                  {toast.description}
                </p>
              )}
              {toast.actionLabel && toast.onAction && (
                <button
                  type="button"
                  className="mt-2 inline-flex rounded border px-2 py-0.5 text-[11px] font-medium hover:bg-muted"
                  onClick={toast.onAction}
                >
                  {toast.actionLabel}
                </button>
              )}
            </div>
            <button
              type="button"
              className="shrink-0 rounded p-1 text-muted-foreground hover:text-foreground"
              onClick={() => dismiss(toast.id)}
              aria-label="Close notification"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
