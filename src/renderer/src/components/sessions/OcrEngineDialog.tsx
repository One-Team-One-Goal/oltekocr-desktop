import { useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Download, Trash2, Cpu, Loader2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";

// ─── Data ─────────────────────────────────────────────────────────────────────

interface OcrEngine {
  id: string;
  name: string;
  description: string;
  recommended?: boolean;
  downloaded: boolean;
  size: string;
}

const INITIAL_ENGINES: OcrEngine[] = [
  {
    id: "rapidocr",
    name: "rapid-ocr-v3.7.0",
    description:
      "Fast but inaccurate on complex layouts. Best for simple, single-column documents.",
    recommended: true,
    downloaded: true,
    size: "45 MB",
  },
  {
    id: "paddleocr",
    name: "PaddleOCR",
    description:
      "Good layout detection with strong table and multi-column support. Slower than RapidOCR.",
    downloaded: false,
    size: "180 MB",
  },
  {
    id: "tesseract",
    name: "Tesseract 5",
    description:
      "Open-source classic OCR engine. Widely compatible with moderate speed and accuracy.",
    downloaded: false,
    size: "22 MB",
  },
  {
    id: "easyocr",
    name: "EasyOCR",
    description:
      "Supports 80+ languages. Best choice for multilingual and mixed-language documents.",
    downloaded: false,
    size: "320 MB",
  },
  {
    id: "doctr",
    name: "docTR",
    description:
      "Deep learning-based engine. Excellent accuracy on dense and complex text layouts.",
    downloaded: false,
    size: "210 MB",
  },
];

// ─── Props ────────────────────────────────────────────────────────────────────

interface OcrEngineDialogProps {
  open: boolean;
  onClose: () => void;
  onSelectionChange?: (name: string) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function OcrEngineDialog({
  open,
  onClose,
  onSelectionChange,
}: OcrEngineDialogProps) {
  const [engines, setEngines] = useState<OcrEngine[]>(INITIAL_ENGINES);
  const [selectedId, setSelectedId] = useState("rapidocr");

  useEffect(() => {
    const selected = engines.find((e) => e.id === selectedId);
    if (selected) onSelectionChange?.(selected.name);
  }, [selectedId]);
  const [pendingDownloadId, setPendingDownloadId] = useState<string | null>(
    null,
  );
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  const downloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelActiveDownload = (
    engineId: string,
    engineName: string,
    notice: { update: (patch: any) => void },
  ) => {
    if (downloadTimerRef.current) {
      clearTimeout(downloadTimerRef.current);
      downloadTimerRef.current = null;
    }
    setDownloading((current) => (current === engineId ? null : current));
    notice.update({
      title: "OCR Download Cancelled",
      description: `${engineName} was cancelled.`,
      duration: 3000,
      actionLabel: undefined,
      onAction: undefined,
    });
  };

  const startDownload = (engineId: string, selectAfter = false) => {
    setDownloading(engineId);
    const engineName =
      engines.find((engine) => engine.id === engineId)?.name ?? engineId;
    let noticeRef: { update: (patch: any) => void } | null = null;
    const notice = toast({
      title: "Downloading OCR Engine",
      description: `${engineName} download started...`,
      duration: 0,
      actionLabel: "Cancel",
      onAction: () => {
        if (noticeRef) cancelActiveDownload(engineId, engineName, noticeRef);
      },
    });
    noticeRef = notice;
    // Mock download — replace with real API call when available
    downloadTimerRef.current = setTimeout(() => {
      setEngines((prev) =>
        prev.map((e) => (e.id === engineId ? { ...e, downloaded: true } : e)),
      );
      if (selectAfter) setSelectedId(engineId);
      setDownloading((current) => (current === engineId ? null : current));
      downloadTimerRef.current = null;
      notice.update({
        title: "OCR Engine Ready",
        description: `${engineName} download complete.`,
        duration: 3000,
        actionLabel: undefined,
        onAction: undefined,
      });
    }, 2000);
  };

  const handleSelect = (engine: OcrEngine) => {
    if (!engine.downloaded) {
      setPendingDownloadId(engine.id);
    } else {
      setSelectedId(engine.id);
    }
  };

  const handleDownloadConfirm = () => {
    if (!pendingDownloadId) return;
    const id = pendingDownloadId;
    setPendingDownloadId(null);
    startDownload(id, true);
  };

  const handleDeleteConfirm = () => {
    if (!pendingDeleteId) return;
    setEngines((prev) =>
      prev.map((e) =>
        e.id === pendingDeleteId ? { ...e, downloaded: false } : e,
      ),
    );
    if (selectedId === pendingDeleteId) setSelectedId("rapidocr");
    setPendingDeleteId(null);
  };

  const pendingDownloadEngine = pendingDownloadId
    ? engines.find((e) => e.id === pendingDownloadId)
    : null;
  const pendingDeleteEngine = pendingDeleteId
    ? engines.find((e) => e.id === pendingDeleteId)
    : null;

  return (
    <>
      {/* Main engine list dialog */}
      <Dialog
        open={open && !pendingDownloadId && !pendingDeleteId}
        onOpenChange={(v) => !v && onClose()}
      >
        <DialogContent className="sm:max-w-[540px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Cpu className="h-4 w-4" />
              OCR Engine
            </DialogTitle>
            <DialogDescription>
              Choose the OCR engine for processing documents in this session.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2 max-h-[400px] overflow-y-auto pr-1">
            {engines.map((engine) => {
              const isSelected = selectedId === engine.id;
              const isDownloading = downloading === engine.id;
              return (
                <div
                  key={engine.id}
                  className={cn(
                    "flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition-colors",
                    isSelected
                      ? "border-primary bg-primary/5"
                      : "border-border hover:bg-muted/50",
                  )}
                  onClick={() => handleSelect(engine)}
                >
                  {/* Radio indicator */}
                  <div className="mt-0.5 shrink-0">
                    <div
                      className={cn(
                        "h-4 w-4 rounded-full border-2 flex items-center justify-center",
                        isSelected
                          ? "border-primary"
                          : "border-muted-foreground/40",
                      )}
                    >
                      {isSelected && (
                        <div className="h-2 w-2 rounded-full bg-primary" />
                      )}
                    </div>
                  </div>

                  {/* Engine info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold">
                        {engine.name}
                      </span>
                      {engine.recommended && (
                        <Badge
                          variant="secondary"
                          className="text-[10px] px-1.5 py-0 h-4 bg-green-100 text-green-700"
                        >
                          Recommended
                        </Badge>
                      )}
                      {!engine.downloaded && !isDownloading && (
                        <Badge
                          variant="outline"
                          className="text-[10px] px-1.5 py-0 h-4 text-muted-foreground"
                        >
                          Not downloaded
                        </Badge>
                      )}
                      {isDownloading && (
                        <Badge
                          variant="outline"
                          className="text-[10px] px-1.5 py-0 h-4 text-blue-600 border-blue-300"
                        >
                          Downloading…
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                      {engine.description}
                    </p>
                    <span className="text-[10px] text-muted-foreground mt-1 block">
                      Model size: {engine.size}
                    </span>
                  </div>

                  {/* Action buttons */}
                  <div
                    className="shrink-0 flex items-center ml-2"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {engine.downloaded ? (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-destructive"
                        disabled={isSelected}
                        title={
                          isSelected
                            ? "Cannot delete the active engine"
                            : "Delete model files"
                        }
                        onClick={() => setPendingDeleteId(engine.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs gap-1"
                        disabled={isDownloading}
                        onClick={() => startDownload(engine.id)}
                      >
                        {isDownloading ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Download className="h-3 w-3" />
                        )}
                        {isDownloading ? "Downloading…" : "Download"}
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={onClose}>Apply</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Download permission dialog */}
      <Dialog
        open={!!pendingDownloadId}
        onOpenChange={(v) => !v && setPendingDownloadId(null)}
      >
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Download model?</DialogTitle>
            <DialogDescription>
              <strong>{pendingDownloadEngine?.name}</strong> (
              {pendingDownloadEngine?.size}) needs to be downloaded before it
              can be used. This may take a moment depending on your connection.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setPendingDownloadId(null)}
            >
              Cancel
            </Button>
            <Button onClick={handleDownloadConfirm}>Download</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation dialog */}
      <Dialog
        open={!!pendingDeleteId}
        onOpenChange={(v) => !v && setPendingDeleteId(null)}
      >
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Delete model files?</DialogTitle>
            <DialogDescription>
              This will remove all downloaded files for{" "}
              <strong>{pendingDeleteEngine?.name}</strong> (
              {pendingDeleteEngine?.size}). You can re-download it at any time.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingDeleteId(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDeleteConfirm}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
