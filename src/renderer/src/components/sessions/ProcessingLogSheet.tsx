import { useEffect, useRef, useState, useCallback } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Ban, Terminal } from "lucide-react";
import { useWebSocket } from "@/hooks/useWebSocket";
import type { WsEvent } from "@shared/types";

interface LogEntry {
  line: string;
  timestamp: string;
  docId: string;
}

interface ProcessingLogSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Optionally filter to a specific document ID */
  documentId?: string | null;
}

export function ProcessingLogSheet({
  open,
  onOpenChange,
  documentId,
}: ProcessingLogSheetProps) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const visibleLogs = documentId
    ? logs.filter((entry) => entry.docId === documentId)
    : logs;

  const handleWs = useCallback(
    (event: WsEvent) => {
      if (event.event !== "processing:log") return;
      const { id, line, timestamp } = event.data;
      // If filtering to a specific doc, skip others
      if (documentId && id !== documentId) return;
      setLogs((prev) => {
        const next = [...prev, { line, timestamp, docId: id }];
        // Keep last 500 lines to avoid memory bloat
        return next.length > 500 ? next.slice(-500) : next;
      });
    },
    [documentId],
  );

  useWebSocket(handleWs);

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  const clearLogs = () => {
    if (!documentId) {
      setLogs([]);
      return;
    }
    setLogs((prev) => prev.filter((entry) => entry.docId !== documentId));
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-[480px] sm:max-w-[480px] p-0 flex flex-col"
      >
        <SheetHeader className="p-4 pb-2 flex-none border-b">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Terminal className="h-4 w-4 text-muted-foreground" />
              <SheetTitle className="text-sm">Processing Logs</SheetTitle>
            </div>
          </div>
          <SheetDescription className="text-xs">
            Live OCR output{" "}
            {documentId
              ? `for ${documentId.slice(0, 8)}...`
              : "for all documents"}
          </SheetDescription>
        </SheetHeader>

        <ScrollArea className="flex-1" ref={scrollRef}>
          <div className="relative p-3 font-mono text-[11px] leading-relaxed bg-zinc-950 min-h-full">
            <Button
              variant="ghost"
              size="icon"
              className="absolute top-2 right-4 h-7 w-7 text-zinc-300 hover:text-zinc-100 hover:bg-zinc-800"
              onClick={clearLogs}
              title="Clear logs"
            >
              <Ban className="h-3.5 w-3.5" />
            </Button>
            {visibleLogs.length === 0 ? (
              <p className="text-zinc-600 italic">
                Waiting for processing logs...
              </p>
            ) : (
              visibleLogs.map((entry, i) => (
                <div key={i} className="flex gap-2">
                  <span className="text-zinc-600 select-none shrink-0">
                    {new Date(entry.timestamp).toLocaleTimeString()}
                  </span>
                  <span
                    className={
                      entry.line.startsWith("ERROR")
                        ? "text-red-400"
                        : entry.line.includes("complete") ||
                            entry.line.includes("Completed")
                          ? "text-green-400"
                          : "text-zinc-300"
                    }
                  >
                    {entry.line}
                  </span>
                </div>
              ))
            )}
            <div ref={bottomRef} />
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
