import { useState } from "react";
import { sessionsApi } from "@/api/client";
import type { SessionListItem } from "@shared/types";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2 } from "lucide-react";

interface DuplicateSessionDialogProps {
  open: boolean;
  sessions: SessionListItem[];
  onClose: () => void;
  onCompleted: (createdSessionIds: string[]) => void;
}

export function DuplicateSessionDialog({
  open,
  sessions,
  onClose,
  onCompleted,
}: DuplicateSessionDialogProps) {
  const [name, setName] = useState("");
  const [strategy, setStrategy] = useState<"FULL" | "COLUMNS_ONLY">(
    "COLUMNS_ONLY",
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const isSingle = sessions.length === 1;
  const firstSession = sessions[0] ?? null;

  const handleOpenChange = (next: boolean) => {
    if (next) return;
    setName("");
    setStrategy("COLUMNS_ONLY");
    setError("");
    onClose();
  };

  const targetName = name.trim() || `${firstSession?.name ?? "Session"} (Copy)`;

  const handleSubmit = async () => {
    if (sessions.length === 0) return;
    setSubmitting(true);
    setError("");

    try {
      const createdSessionIds: string[] = [];

      for (const session of sessions) {
        const result = await sessionsApi.duplicate(session.id, {
          strategy,
          ...(isSingle ? { name: targetName } : {}),
        });
        createdSessionIds.push(result.session.id);
      }

      onCompleted(createdSessionIds);
    } catch (err: any) {
      setError(err.message ?? "Failed to duplicate session");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Duplicate Session</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {isSingle ? (
            <div className="space-y-1.5">
              <label className="text-xs font-medium">New Session Name</label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={`${firstSession?.name ?? "Session"} (Copy)`}
              />
            </div>
          ) : (
            <div className="text-xs text-muted-foreground border rounded-md px-3 py-2 bg-muted/20">
              {sessions.length} sessions selected. Duplicates will use default
              names like "(Copy)".
            </div>
          )}

          <div className="space-y-2">
            <p className="text-xs font-medium">What should be duplicated?</p>

            <button
              type="button"
              onClick={() => setStrategy("COLUMNS_ONLY")}
              className={`w-full rounded-lg border text-left p-3 ${
                strategy === "COLUMNS_ONLY"
                  ? "border-primary bg-primary/5"
                  : "border-border hover:bg-muted/30"
              }`}
            >
              <p className="text-sm font-medium">Only configuration (columns and mode)</p>
              <p className="text-xs text-muted-foreground mt-1">
                Creates a new session with the same extraction setup but no files.
              </p>
            </button>

            <button
              type="button"
              onClick={() => setStrategy("FULL")}
              className={`w-full rounded-lg border text-left p-3 ${
                strategy === "FULL"
                  ? "border-primary bg-primary/5"
                  : "border-border hover:bg-muted/30"
              }`}
            >
              <p className="text-sm font-medium">Full duplicate (include files)</p>
              <p className="text-xs text-muted-foreground mt-1">
                Copies all current documents and extracted results into the new
                session without reprocessing.
              </p>
            </button>
          </div>

          {error && (
            <p className="text-xs text-red-600 border border-red-200 bg-red-50 rounded-md px-3 py-2">
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={submitting || sessions.length === 0}>
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Create Duplicate{sessions.length > 1 ? "s" : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
