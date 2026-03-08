import { useCallback, useEffect, useState } from "react";
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
import { Download, Trash2, FileSearch, Loader2 } from "lucide-react";
import { modelsApi, sessionsApi, type ModelStatus } from "@/api/client";

// ─── Props ────────────────────────────────────────────────────────────────────

interface PdfModelDialogProps {
  open: boolean;
  onClose: () => void;
  sessionId?: string;
  currentModel?: string;
  onSelectionChange?: (name: string) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function PdfModelDialog({
  open,
  onClose,
  sessionId,
  currentModel,
  onSelectionChange,
}: PdfModelDialogProps) {
  const [models, setModels] = useState<ModelStatus[]>([]);
  const [selectedId, setSelectedId] = useState(currentModel || "docling");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // Sync selectedId when currentModel prop changes
  useEffect(() => {
    if (currentModel) setSelectedId(currentModel);
  }, [currentModel]);

  // Fetch real model list from backend whenever the dialog opens
  const fetchModels = useCallback(async () => {
    setLoading(true);
    try {
      const list = await modelsApi.list();
      setModels(list);
    } catch (err) {
      console.error("Failed to fetch models:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) fetchModels();
  }, [open, fetchModels]);

  useEffect(() => {
    const selected = models.find((m) => m.id === selectedId);
    if (selected) onSelectionChange?.(selected.name);
  }, [selectedId, models, onSelectionChange]);

  const [pendingDownloadId, setPendingDownloadId] = useState<string | null>(
    null,
  );
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const startDownload = async (modelId: string, selectAfter = false) => {
    setDownloading(modelId);
    try {
      await modelsApi.install(modelId);
      setModels((prev) =>
        prev.map((m) => (m.id === modelId ? { ...m, downloaded: true } : m)),
      );
      if (selectAfter) setSelectedId(modelId);
    } catch (err) {
      console.error("Model install failed:", err);
    } finally {
      setDownloading(null);
    }
  };

  const handleSelect = (model: ModelStatus) => {
    if (!model.downloaded) {
      setPendingDownloadId(model.id);
    } else {
      setSelectedId(model.id);
    }
  };

  const handleDownloadConfirm = () => {
    if (!pendingDownloadId) return;
    const id = pendingDownloadId;
    setPendingDownloadId(null);
    startDownload(id, true);
  };

  const handleDeleteConfirm = async () => {
    if (!pendingDeleteId) return;
    const id = pendingDeleteId;
    setPendingDeleteId(null);
    setDeleting(id);
    try {
      await modelsApi.uninstall(id);
      setModels((prev) =>
        prev.map((m) => (m.id === id ? { ...m, downloaded: false } : m)),
      );
      if (selectedId === id) setSelectedId("docling");
    } catch (err) {
      console.error("Model uninstall failed:", err);
    } finally {
      setDeleting(null);
    }
  };

  const pendingDownloadModel = pendingDownloadId
    ? models.find((m) => m.id === pendingDownloadId)
    : null;
  const pendingDeleteModel = pendingDeleteId
    ? models.find((m) => m.id === pendingDeleteId)
    : null;

  return (
    <>
      {/* Main model list dialog */}
      <Dialog
        open={open && !pendingDownloadId && !pendingDeleteId}
        onOpenChange={(v) => !v && onClose()}
      >
        <DialogContent className="sm:max-w-[540px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileSearch className="h-4 w-4" />
              Document Extraction Model
            </DialogTitle>
            <DialogDescription>
              Choose the model used to extract text and tables from documents
              (PDF, DOCX, HTML, images, and more).
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2 max-h-[400px] overflow-y-auto pr-1">
            {loading && models.length === 0 && (
              <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Loading models…
              </div>
            )}
            {models.map((model) => {
              const isSelected = selectedId === model.id;
              const isDownloading = downloading === model.id;
              const isDeleting = deleting === model.id;
              return (
                <div
                  key={model.id}
                  className={cn(
                    "flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition-colors",
                    isSelected
                      ? "border-primary bg-primary/5"
                      : "border-border hover:bg-muted/50",
                  )}
                  onClick={() => handleSelect(model)}
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

                  {/* Model info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold">
                        {model.name}
                      </span>
                      {model.recommended && (
                        <Badge
                          variant="secondary"
                          className="text-[10px] px-1.5 py-0 h-4 bg-green-100 text-green-700"
                        >
                          Recommended
                        </Badge>
                      )}
                      {!model.downloaded && !isDownloading && (
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
                          Installing…
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                      {model.description}
                    </p>
                    <span className="text-[10px] text-muted-foreground mt-1 block">
                      Model size: {model.size}
                    </span>
                  </div>

                  {/* Action buttons */}
                  <div
                    className="shrink-0 flex items-center ml-2"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {model.downloaded ? (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-destructive"
                        disabled={isSelected || isDeleting}
                        title={
                          isSelected
                            ? "Cannot delete the active model"
                            : "Delete model files"
                        }
                        onClick={() => setPendingDeleteId(model.id)}
                      >
                        {isDeleting ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5" />
                        )}
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs gap-1"
                        disabled={isDownloading}
                        onClick={() => startDownload(model.id)}
                      >
                        {isDownloading ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Download className="h-3 w-3" />
                        )}
                        {isDownloading ? "Installing…" : "Download"}
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
            <Button
              disabled={saving}
              onClick={async () => {
                if (sessionId) {
                  setSaving(true);
                  try {
                    await sessionsApi.updateExtractionModel(
                      sessionId,
                      selectedId,
                    );
                  } catch (err) {
                    console.error("Failed to save extraction model:", err);
                  } finally {
                    setSaving(false);
                  }
                }
                onClose();
              }}
            >
              {saving ? "Saving…" : "Apply"}
            </Button>
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
              <strong>{pendingDownloadModel?.name}</strong> (
              {pendingDownloadModel?.size}) will be installed via pip. This may
              take a moment depending on your connection.
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
              This will remove the local files for{" "}
              <strong>{pendingDeleteModel?.name}</strong>. You can re-download
              them later.
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
