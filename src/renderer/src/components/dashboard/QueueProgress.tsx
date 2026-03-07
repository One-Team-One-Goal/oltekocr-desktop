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
    <div className="border-t border-border/50 px-6 py-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {status.processing && (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-orange-400" />
          )}
          <span className="text-xs font-medium text-muted-foreground">
            Processing Queue
          </span>
          <Badge variant="secondary" className="text-xs h-5 px-1.5 rounded-md">
            {status.length} remaining
          </Badge>
        </div>
        <div className="flex items-center gap-0.5">
          {status.processing ? (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-muted-foreground hover:text-foreground"
              onClick={handlePause}
            >
              <Pause className="h-3 w-3" />
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-muted-foreground hover:text-foreground"
              onClick={handleResume}
            >
              <Play className="h-3 w-3" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-red-400/60 hover:text-red-400"
            onClick={handleClear}
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      </div>
      <Progress value={status.progress} className="h-1" />
    </div>
  );
}
