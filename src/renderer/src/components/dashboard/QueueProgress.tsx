import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Pause, Play, Trash2, Loader2 } from "lucide-react";
import { queueApi } from "@/api/client";

interface QueueStatus {
  length: number;
  processing: boolean;
  currentDocumentId: string | null;
  progress: number;
}

interface QueueProgressProps {
  status: QueueStatus;
  onRefresh: () => void;
}

export function QueueProgress({ status, onRefresh }: QueueProgressProps) {
  if (status.length === 0 && !status.processing) return null;

  const handlePause = async () => {
    await queueApi.pause();
    onRefresh();
  };

  const handleResume = async () => {
    await queueApi.resume();
    onRefresh();
  };

  const handleClear = async () => {
    if (confirm("Clear the processing queue?")) {
      await queueApi.clear();
      onRefresh();
    }
  };

  return (
    <div className="rounded-md border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {status.processing && (
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
          )}
          <span className="text-sm font-medium">Processing Queue</span>
          <Badge variant="secondary" className="text-xs">
            {status.length} remaining
          </Badge>
        </div>
        <div className="flex items-center gap-1">
          {status.processing ? (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={handlePause}
            >
              <Pause className="h-3.5 w-3.5" />
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={handleResume}
            >
              <Play className="h-3.5 w-3.5" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-red-400 hover:text-red-300"
            onClick={handleClear}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
      <Progress value={status.progress} className="h-2" />
      <p className="text-xs text-muted-foreground">
        {status.processing
          ? `Processing document... ${Math.round(status.progress)}%`
          : "Queue paused"}
      </p>
    </div>
  );
}
