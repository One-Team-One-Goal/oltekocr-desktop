import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  FileText,
  Table2,
  FolderOpen,
  Trash2,
  ChevronRight,
} from "lucide-react";
import type { SessionListItem, SessionMode } from "@shared/types";
import { formatDate, statusColor, statusDotColor } from "@/lib/utils";

interface SessionCardProps {
  session: SessionListItem;
  onOpen: () => void;
  onDelete: () => Promise<void>;
}

const modeConfig: Record<
  SessionMode,
  {
    label: string;
    icon: typeof FileText;
    bg: string;
    text: string;
    border: string;
  }
> = {
  OCR_EXTRACT: {
    label: "OCR Extract",
    icon: FileText,
    bg: "bg-blue-50",
    text: "text-blue-700",
    border: "border-blue-200",
  },
  TABLE_EXTRACT: {
    label: "Table Extract",
    icon: Table2,
    bg: "bg-violet-50",
    text: "text-violet-700",
    border: "border-violet-200",
  },
};

const sessionStatusDot: Record<string, string> = {
  PENDING: "bg-gray-400",
  PROCESSING: "bg-amber-500",
  DONE: "bg-green-500",
  ERROR: "bg-red-500",
};

export function SessionCard({ session, onOpen, onDelete }: SessionCardProps) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mode = modeConfig[session.mode] ?? modeConfig.OCR_EXTRACT;
  const Icon = mode.icon;

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm(`Delete session "${session.name}" and all its documents?`))
      return;
    setDeleting(true);
    setError(null);
    try {
      await onDelete();
    } catch (err: any) {
      setError(err?.message ?? "Failed to delete");
      setDeleting(false);
    }
  };

  const progress =
    session.documentCount > 0
      ? Math.round((session.processedCount / session.documentCount) * 100)
      : 0;

  return (
    <div
      className="bg-card border border-border rounded-xl shadow-sm p-5 flex flex-col gap-4 hover:shadow-md transition-shadow cursor-pointer group"
      onClick={onOpen}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-xs font-medium shrink-0 ${mode.bg} ${mode.text} ${mode.border}`}
          >
            <Icon className="h-3 w-3" />
            {mode.label}
          </span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <span
            className={`inline-block h-2 w-2 rounded-full ${sessionStatusDot[session.status] ?? "bg-gray-400"}`}
          />
          <span className="text-xs text-muted-foreground capitalize">
            {session.status.toLowerCase()}
          </span>
        </div>
      </div>

      {/* Name */}
      <div>
        <h3 className="font-semibold text-base text-foreground truncate">
          {session.name}
        </h3>
        <p className="text-xs text-muted-foreground mt-0.5">
          {formatDate(session.createdAt)}
        </p>
      </div>

      {/* Progress */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            {session.processedCount} / {session.documentCount} documents
          </span>
          <span>{progress}%</span>
        </div>
        <div className="h-1.5 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-primary rounded-full transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between pt-1">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-red-500"
          disabled={deleting}
          onClick={handleDelete}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
        {error && (
          <span className="text-xs text-red-500 truncate max-w-[140px]" title={error}>
            {error}
          </span>
        )}
        <Button
          size="sm"
          variant="outline"
          className="gap-1 text-xs shadow-sm"
          onClick={(e) => {
            e.stopPropagation();
            onOpen();
          }}
        >
          Open
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
