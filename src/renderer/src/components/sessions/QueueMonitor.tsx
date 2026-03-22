import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { DocumentListItem } from "@shared/types";
import { cn } from "@/lib/utils";
import { ListOrdered, Loader2, CheckCircle2, Clock3 } from "lucide-react";

interface QueueMonitorProps {
  documents: DocumentListItem[];
  queueSize: number;
  processingId: string | null;
  progressByDocId: Record<string, { progress: number; message: string }>;
}

export function QueueMonitor({
  documents,
  queueSize,
  processingId,
  progressByDocId,
}: QueueMonitorProps) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const isActive = queueSize > 0 || !!processingId;

  const processingDoc = useMemo(
    () => documents.find((doc) => doc.id === processingId) ?? null,
    [documents, processingId],
  );

  const queuedDocs = useMemo(
    () => documents.filter((doc) => doc.status === "QUEUED"),
    [documents],
  );

  const completedDocs = useMemo(
    () =>
      [...documents]
        .filter((doc) =>
          ["REVIEW", "APPROVED", "REJECTED", "EXPORTED", "ERROR"].includes(
            doc.status,
          ),
        )
        .sort((a, b) => Number(b.createdAt) - Number(a.createdAt)),
    [documents],
  );

  const currentlyRunning = useMemo(
    () =>
      documents.filter(
        (doc) => doc.status === "SCANNING" || doc.status === "PROCESSING",
      ),
    [documents],
  );

  const currentProgress = processingId ? progressByDocId[processingId] : undefined;
  const progressValue = Math.max(0, Math.min(100, currentProgress?.progress ?? 0));
  const progressLabel = currentProgress?.message ||
    (processingDoc ? "Extracting data..." : "Waiting for next document...");

  const currentName = processingDoc?.filename || "Preparing next document";

  return (
    <>
      {isActive && (
        <div className="fixed bottom-4 left-1/2 z-40 w-[min(760px,calc(100vw-2rem))] -translate-x-1/2 rounded-xl border border-border bg-card/95 px-4 py-3 shadow-lg backdrop-blur-sm">
          <div className="flex items-center gap-3">
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-3">
                <p className="truncate text-sm font-medium" title={currentName}>
                  {currentName}
                </p>
                <p className="shrink-0 text-xs text-muted-foreground">
                  {queueSize} in queue
                </p>
              </div>
              <p className="mt-0.5 truncate text-xs text-muted-foreground" title={progressLabel}>
                {progressLabel}
              </p>
              <Progress className="mt-2 h-1.5" value={progressValue} />
            </div>
            <Button size="sm" variant="outline" onClick={() => setSheetOpen(true)}>
              <ListOrdered className="mr-1.5 h-3.5 w-3.5" />
              View Queue
            </Button>
          </div>
        </div>
      )}

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side="right" className="w-[430px] sm:max-w-[430px]">
          <SheetHeader>
            <SheetTitle className="text-base">Processing Queue</SheetTitle>
            <SheetDescription>
              Track what is running now and what is waiting next.
            </SheetDescription>
          </SheetHeader>

          <div className="mt-5 space-y-5">
            <section>
              <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Running
              </div>
              {currentlyRunning.length === 0 ? (
                <p className="rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground">
                  Nothing is currently processing.
                </p>
              ) : (
                <div className="space-y-2">
                  {currentlyRunning.map((doc) => {
                    const p = progressByDocId[doc.id];
                    const value = Math.max(0, Math.min(100, p?.progress ?? 0));
                    return (
                      <div key={doc.id} className="rounded-md border p-2.5">
                        <p className="truncate text-sm font-medium" title={doc.filename}>
                          {doc.filename}
                        </p>
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">
                          {p?.message || "Processing..."}
                        </p>
                        <Progress className="mt-2 h-1.5" value={value} />
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            <section>
              <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <Clock3 className="h-3.5 w-3.5" />
                Queued ({queuedDocs.length})
              </div>
              {queuedDocs.length === 0 ? (
                <p className="rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground">
                  Queue is empty.
                </p>
              ) : (
                <div className="space-y-1.5">
                  {queuedDocs.map((doc) => (
                    <div
                      key={doc.id}
                      className={cn(
                        "rounded-md border px-3 py-2 text-sm",
                        doc.id === processingId && "border-primary/40",
                      )}
                    >
                      <p className="truncate" title={doc.filename}>
                        {doc.filename}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section>
              <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Completed ({completedDocs.length})
              </div>
              {completedDocs.length === 0 ? (
                <p className="rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground">
                  No processed files yet.
                </p>
              ) : (
                <div className="space-y-1.5">
                  {completedDocs.slice(0, 8).map((doc) => (
                    <div key={doc.id} className="rounded-md border px-3 py-2 text-sm">
                      <p className="truncate" title={doc.filename}>
                        {doc.filename}
                      </p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        {doc.status}
                      </p>
                    </div>
                  ))}
                  {completedDocs.length > 8 && (
                    <p className="px-1 text-xs text-muted-foreground">
                      +{completedDocs.length - 8} more processed file(s)
                    </p>
                  )}
                </div>
              )}
            </section>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
