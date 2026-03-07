import { useEffect, useState } from "react";
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
import { Download, Trash2, BrainCircuit, Loader2, Cloud } from "lucide-react";

// ─── Data ─────────────────────────────────────────────────────────────────────

interface LlmModel {
  id: string;
  name: string;
  description: string;
  recommended?: boolean;
  cloud?: boolean; // cloud models are always available, no download needed
  downloaded: boolean;
  size: string;
}

const INITIAL_MODELS: LlmModel[] = [
  {
    id: "gpt4o",
    name: "gpt-4o",
    description:
      "State-of-the-art multimodal model. Excellent for complex document understanding and structured extraction.",
    recommended: true,
    cloud: true,
    downloaded: true,
    size: "Cloud API",
  },
  {
    id: "claude-sonnet",
    name: "Claude 3.5 Sonnet",
    description:
      "Superior reasoning and instruction-following. Best for nuanced extraction and long-document tasks.",
    cloud: true,
    downloaded: true,
    size: "Cloud API",
  },
  {
    id: "llama3-8b",
    name: "Llama 3.2 8B",
    description:
      "Fast local model for general document Q&A. Keeps data on-device — no internet required.",
    downloaded: false,
    size: "5 GB",
  },
  {
    id: "mistral-7b",
    name: "Mistral 7B Instruct",
    description:
      "Lightweight and fast local model. Good balance of speed and accuracy for structured field extraction.",
    downloaded: false,
    size: "4 GB",
  },
  {
    id: "qwen2-7b",
    name: "Qwen 2.5 7B",
    description:
      "Multilingual local model with strong support for Asian languages and mixed-language documents.",
    downloaded: false,
    size: "4.5 GB",
  },
];

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
  const [models, setModels] = useState<LlmModel[]>(INITIAL_MODELS);
  const [selectedId, setSelectedId] = useState("gpt4o");

  useEffect(() => {
    const selected = models.find((m) => m.id === selectedId);
    if (selected) onSelectionChange?.(selected.name);
  }, [selectedId]);
  const [pendingDownloadId, setPendingDownloadId] = useState<string | null>(
    null,
  );
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);

  const startDownload = (modelId: string, selectAfter = false) => {
    setDownloading(modelId);
    // Mock download — replace with real API call when available
    setTimeout(() => {
      setModels((prev) =>
        prev.map((m) => (m.id === modelId ? { ...m, downloaded: true } : m)),
      );
      if (selectAfter) setSelectedId(modelId);
      setDownloading(null);
    }, 2000);
  };

  const handleSelect = (model: LlmModel) => {
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

  const handleDeleteConfirm = () => {
    if (!pendingDeleteId) return;
    setModels((prev) =>
      prev.map((m) =>
        m.id === pendingDeleteId ? { ...m, downloaded: false } : m,
      ),
    );
    if (selectedId === pendingDeleteId) setSelectedId("gpt4o");
    setPendingDeleteId(null);
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
              LLM Model
            </DialogTitle>
            <DialogDescription>
              Choose the language model used for field extraction and document
              understanding.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2 max-h-[400px] overflow-y-auto pr-1">
            {models.map((model) => {
              const isSelected = selectedId === model.id;
              const isDownloading = downloading === model.id;
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
                          className="text-[10px] px-1.5 py-0 h-4 bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400"
                        >
                          Recommended
                        </Badge>
                      )}
                      {model.cloud && (
                        <Badge
                          variant="secondary"
                          className="text-[10px] px-1.5 py-0 h-4 bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400"
                        >
                          <Cloud className="h-2.5 w-2.5 mr-0.5" />
                          Cloud
                        </Badge>
                      )}
                      {!model.downloaded && !model.cloud && !isDownloading && (
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
                      {model.cloud
                        ? "No download required"
                        : `Model size: ${model.size}`}
                    </span>
                  </div>

                  {/* Action buttons */}
                  <div
                    className="shrink-0 flex items-center ml-2"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {model.cloud ? null : model.downloaded ? (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-destructive"
                        disabled={isSelected}
                        title={
                          isSelected
                            ? "Cannot delete the active model"
                            : "Delete model files"
                        }
                        onClick={() => setPendingDeleteId(model.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
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
              <strong>{pendingDownloadModel?.name}</strong> (
              {pendingDownloadModel?.size}) needs to be downloaded before it can
              be used. This may take a moment depending on your connection.
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
              {pendingDeleteModel?.size}). You can re-download it at any time.
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
