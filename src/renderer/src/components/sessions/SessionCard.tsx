import { Check, Pencil } from "lucide-react";
import { FolderOpen, ChevronRight } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { Input } from "@/components/ui/input";
import type { SessionListItem } from "@shared/types";
import { formatDate } from "@/lib/utils";

interface SessionCardProps {
  session: SessionListItem;
  onOpen: () => void;
  selectMode?: boolean;
  selectionIntent?: "delete" | "duplicate";
  selected?: boolean;
  onSelect?: () => void;
  onRename?: (id: string, name: string) => void;
}

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
  selectionIntent = "delete",
  selected = false,
  onSelect,
  onRename,
}: SessionCardProps) {
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(session.name);
  const inputRef = useRef<HTMLInputElement>(null);

  const progress =
    session.documentCount > 0
      ? Math.round((session.processedCount / session.documentCount) * 100)
      : 0;

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const commitRename = () => {
    const trimmed = editName.trim();
    if (trimmed && trimmed !== session.name) {
      onRename?.(session.id, trimmed);
    } else {
      setEditName(session.name);
    }
    setEditing(false);
  };

  return (
    <div
      className={`relative border rounded-xl shadow-sm p-5 flex flex-col gap-4 transition-all cursor-pointer ${
        selectMode
          ? selected
            ? selectionIntent === "delete"
              ? "bg-destructive/10 border-destructive ring-1 ring-destructive"
              : "bg-blue-50 border-blue-400 ring-1 ring-blue-400"
            : selectionIntent === "delete"
              ? "bg-card border-dashed border-border/70 hover:border-destructive/50 hover:bg-destructive/5"
              : "bg-card border-dashed border-border/70 hover:border-blue-400/60 hover:bg-blue-50/40"
          : "bg-card border-border hover:shadow-md"
      }`}
      onClick={selectMode ? onSelect : onOpen}
    >
      {/* Name */}
      <div>
        {editing ? (
          <Input
            ref={inputRef}
            className="h-8 text-lg font-semibold"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename();
              if (e.key === "Escape") {
                setEditName(session.name);
                setEditing(false);
              }
            }}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <div className="group/name flex items-center gap-1.5">
            <h3 className="font-semibold text-lg text-foreground truncate">
              {session.name}
            </h3>
            {!selectMode && (
              <button
                className="opacity-0 group-hover/name:opacity-100 transition-opacity text-muted-foreground hover:text-foreground shrink-0"
                onClick={(e) => {
                  e.stopPropagation();
                  setEditName(session.name);
                  setEditing(true);
                }}
                title="Rename session"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        )}
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

          <div className="space-x-2">
            <span className="text-xs text-muted-foreground capitalize">
              {session.status.toLowerCase()}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
