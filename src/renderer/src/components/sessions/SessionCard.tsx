import { Check } from "lucide-react";
import { FileText, Table2, FolderOpen, ChevronRight } from "lucide-react";
import type { SessionListItem, SessionMode } from "@shared/types";
import { formatDate, statusColor, statusDotColor } from "@/lib/utils";

interface SessionCardProps {
  session: SessionListItem;
  onOpen: () => void;
  selectMode?: boolean;
  selected?: boolean;
  onSelect?: () => void;
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

export function SessionCard({
  session,
  onOpen,
  selectMode = false,
  selected = false,
  onSelect,
}: SessionCardProps) {
  const mode = modeConfig[session.mode] ?? modeConfig.OCR_EXTRACT;
  const Icon = mode.icon;

  const progress =
    session.documentCount > 0
      ? Math.round((session.processedCount / session.documentCount) * 100)
      : 0;

  return (
    <div
      className={`relative border rounded-xl shadow-sm p-5 flex flex-col gap-4 transition-all cursor-pointer ${
        selectMode
          ? selected
            ? "bg-destructive/10 border-destructive ring-1 ring-destructive"
            : "bg-card border-dashed border-border/70 hover:border-destructive/50 hover:bg-destructive/5"
          : "bg-card border-border hover:shadow-md"
      }`}
      onClick={selectMode ? onSelect : onOpen}
    >
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center min-w-0 text-sm text-primary/80">
          {mode.label}
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
        <h3 className="font-semibold text-lg text-foreground truncate">
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
      </div>
    </div>
  );
}
