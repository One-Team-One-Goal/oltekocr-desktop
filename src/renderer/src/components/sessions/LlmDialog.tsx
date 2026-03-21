import { useCallback, useEffect, useRef, useState } from "react";
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
import {
  Download,
  Trash2,
  BrainCircuit,
  Loader2,
  RotateCcw,
} from "lucide-react";
import {
  modelsApi,
  settingsApi,
  type LlmInstallProgress,
  type LlmModelStatus,
  type LlmRecommendation,
} from "@/api/client";
import { toast } from "@/hooks/use-toast";

// ─── Data ─────────────────────────────────────────────────────────────────────

// ─── Props ────────────────────────────────────────────────────────────────────

interface LlmDialogProps {
  open: boolean;
  onClose: () => void;
  onSelectionChange?: (name: string) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function LlmDialog({
  open,
  onClose,
  onSelectionChange,
}: LlmDialogProps) {
  const [models, setModels] = useState<LlmModelStatus[]>([]);
  const [recommendation, setRecommendation] =
    useState<LlmRecommendation | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState("qwen2.5:3b");
  const [error, setError] = useState<string | null>(null);
  const [savingSelection, setSavingSelection] = useState(false);

  const refreshModels = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [list, rec, settings] = await Promise.all([
        modelsApi.listLlm(),
        modelsApi.llmRecommendation(),
        settingsApi.get(),
      ]);
      setModels(list);
      setRecommendation(rec);
      const savedSelection = settings?.llm?.defaultModel;
      const recommended = list.find((m) => m.recommended);
      const recommendedInstalled = list.find(
        (m) => m.recommended && m.downloaded,
      );
      setSelectedId((current) => {
        if (savedSelection && list.some((m) => m.id === savedSelection)) {
          return savedSelection;
        }
        if (recommendedInstalled) return recommendedInstalled.id;
        if (recommended) return recommended.id;
        if (
          rec?.recommendedId &&
          list.some((m) => m.id === rec.recommendedId)
        ) {
          return rec.recommendedId;
        }
        if (current && list.some((m) => m.id === current)) return current;
        if (list.some((m) => m.id === "phi4-mini" && m.downloaded))
          return "phi4-mini";
        return list[0]?.id ?? current;
      });
    } catch (err: any) {
      setError(err?.message ?? "Failed to load local LLM models.");
      setModels([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      refreshModels();
    }
  }, [open, refreshModels]);

  const [pendingDownloadId, setPendingDownloadId] = useState<string | null>(
    null,
  );
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const cancelledInstallsRef = useRef<Set<string>>(new Set());

  const formatProgressText = useCallback((p: LlmInstallProgress): string => {
    const progressPart =
      p.downloadedMb !== null && p.totalMb !== null
        ? `${p.downloadedMb.toFixed(1)} MB / ${p.totalMb.toFixed(1)} MB`
        : p.percent !== null
          ? `${p.percent}%`
          : "Preparing...";
    const speedPart =
      p.speedMbps !== null ? `, ${p.speedMbps.toFixed(2)} MB/s` : "";
    const remainingMb =
      p.downloadedMb !== null && p.totalMb !== null
        ? Math.max(p.totalMb - p.downloadedMb, 0)
        : null;
    const remainingPart =
      remainingMb !== null ? `, ${remainingMb.toFixed(1)} MB left` : "";
    const etaPart = p.eta ? `, ETA ${p.eta}` : "";
    return `${progressPart}${speedPart}${remainingPart}${etaPart}`;
  }, []);

  const cancelActiveDownload = async (modelId: string) => {
    cancelledInstallsRef.current.add(modelId);
    try {
      await modelsApi.cancelInstallLlm(modelId);
    } catch {
      // ignore: install call may already be exiting
    }
    toast({
      title: "Cancelling LLM Download",
      description: `${modelId} cancellation requested...`,
      duration: 3000,
    });
    setDownloading((current) => (current === modelId ? null : current));
  };

  const startDownload = async (modelId: string, selectAfter = false) => {
    if (downloading && downloading !== modelId) {
      toast({
        title: "Download In Progress",
        description: `Please wait for ${downloading} to finish or cancel it first.`,
        duration: 3000,
      });
      return;
    }
    cancelledInstallsRef.current.delete(modelId);
    setDownloading(modelId);
    const notice = toast({
      title: "Downloading LLM Model",
      description: `${modelId} download started...`,
      duration: 0,
    });

    const progressTimer = setInterval(async () => {
      try {
        const progress = await modelsApi.installLlmProgress(modelId);
        notice.update({
          title: "Downloading LLM Model",
          description: `${modelId}: ${formatProgressText(progress)}`,
          duration: 0,
          actionLabel: undefined,
          onAction: undefined,
        });
      } catch {
        // Keep existing toast text if polling fails temporarily.
      }
    }, 1000);

    try {
      const result = await modelsApi.installLlm(modelId);
      clearInterval(progressTimer);
      if (cancelledInstallsRef.current.has(modelId)) {
        notice.update({
          title: "LLM Download Cancelled",
          description: `${modelId} was cancelled.`,
          duration: 3000,
          actionLabel: undefined,
          onAction: undefined,
        });
        return;
      }
      if (!result.ok) {
        setError(result.log || `Failed to install ${modelId}`);
        notice.update({
          title: "LLM Download Failed",
          description: result.log || `Unable to install ${modelId}.`,
          variant: "destructive",
          duration: 6000,
          actionLabel: undefined,
          onAction: undefined,
        });
        return;
      }
      await refreshModels();
      if (selectAfter) setSelectedId(modelId);
      notice.update({
        title: "LLM Download Complete",
        description: `${modelId} is ready to use.`,
        duration: 3000,
        actionLabel: undefined,
        onAction: undefined,
      });
    } catch (err: any) {
      clearInterval(progressTimer);
      if (cancelledInstallsRef.current.has(modelId)) {
        notice.update({
          title: "LLM Download Cancelled",
          description: `${modelId} was cancelled.`,
          duration: 3000,
          actionLabel: undefined,
          onAction: undefined,
        });
        return;
      }
      setError(err?.message ?? `Failed to install ${modelId}`);
      notice.update({
        title: "LLM Download Failed",
        description: err?.message ?? `Unable to install ${modelId}.`,
        variant: "destructive",
        duration: 6000,
        actionLabel: undefined,
        onAction: undefined,
      });
    } finally {
      clearInterval(progressTimer);
      cancelledInstallsRef.current.delete(modelId);
      setDownloading((current) => (current === modelId ? null : current));
    }
  };

  const handleSelect = (model: LlmModelStatus) => {
    if (downloading) {
      return;
    }
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
    void startDownload(id, true);
  };

  const handleDeleteConfirm = async () => {
    if (!pendingDeleteId) return;
    const id = pendingDeleteId;
    setPendingDeleteId(null);
    setRemoving(id);
    try {
      const result = await modelsApi.uninstallLlm(id);
      if (!result.ok) {
        setError(result.log || `Failed to remove ${id}`);
        return;
      }
      await refreshModels();
      if (selectedId === id) {
        setSelectedId("qwen2.5:3b");
      }
    } catch (err: any) {
      setError(err?.message ?? `Failed to remove ${id}`);
    } finally {
      setRemoving(null);
    }
  };

  const handleApply = async () => {
    setSavingSelection(true);
    setError(null);
    try {
      await settingsApi.update({
        llm: {
          defaultModel: selectedId,
        },
      });
      const selected = models.find((model) => model.id === selectedId);
      if (selected) {
        onSelectionChange?.(selected.name);
      }
      toast({
        title: "LLM Model Updated",
        description: `${selectedId} will be used for field extraction.`,
        duration: 3000,
      });
      onClose();
    } catch (err: any) {
      setError(err?.message ?? "Failed to save the selected LLM model.");
    } finally {
      setSavingSelection(false);
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
              <BrainCircuit className="h-4 w-4" />
              Local LLM Model
            </DialogTitle>
            <DialogDescription>
              Choose a local Ollama model used for field extraction.
            </DialogDescription>
          </DialogHeader>

          {recommendation && (
            <div className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              Recommended:{" "}
              <span className="font-medium text-foreground">
                {recommendation.recommendedId}
              </span>{" "}
              based on {recommendation.ramGb} GB RAM and{" "}
              {recommendation.logicalCores} CPU threads.
            </div>
          )}

          <p className="text-[11px] text-muted-foreground -mt-1">
            Lower models are still available below and can be downloaded any
            time.
          </p>

          <div className="flex items-center justify-end">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={refreshModels}
              disabled={loading}
            >
              {loading ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <RotateCcw className="h-3 w-3" />
              )}
            </Button>
          </div>

          {error && <p className="text-xs text-destructive -mt-2">{error}</p>}

          <div className="space-y-2 max-h-[400px] overflow-y-auto pr-1">
            {loading && models.length === 0 && (
              <div className="text-xs text-muted-foreground py-2">
                Loading local models...
              </div>
            )}
            {models.map((model) => {
              const isSelected = selectedId === model.id;
              const isDownloading = downloading === model.id;
              const hasActiveDownload = !!downloading;
              const isRemoving = removing === model.id;
              return (
                <div
                  key={model.id}
                  className={cn(
                    "flex items-start gap-3 rounded-lg border p-3 transition-colors",
                    hasActiveDownload && !isDownloading
                      ? "cursor-not-allowed opacity-80"
                      : "cursor-pointer",
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
                          Downloading…
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                      {model.description}
                    </p>
                    <span className="text-[10px] text-muted-foreground mt-1 block">
                      {`Model size: ${model.size}`}
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
                        disabled={isSelected || isRemoving}
                        title={
                          isSelected
                            ? "Cannot delete the active model"
                            : "Delete model files"
                        }
                        onClick={() => setPendingDeleteId(model.id)}
                      >
                        {isRemoving ? (
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
                        disabled={hasActiveDownload && !isDownloading}
                        onClick={() => {
                          if (isDownloading) {
                            void cancelActiveDownload(model.id);
                            return;
                          }
                          void startDownload(model.id);
                        }}
                      >
                        {isDownloading ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Download className="h-3 w-3" />
                        )}
                        {isDownloading ? "Cancel" : "Download"}
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
            <Button onClick={handleApply} disabled={savingSelection || loading}>
              {savingSelection ? "Saving..." : "Apply"}
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
              {pendingDownloadModel?.size}) needs to be downloaded before it can
              be used.
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
              <strong>{pendingDeleteModel?.name}</strong> (
              {pendingDeleteModel?.size}). You can install it again at any time.
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
