import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { sessionsApi } from "@/api/client";
import { Trash2, Plus, AlertTriangle, Loader2 } from "lucide-react";
import type { SessionRecord, SessionColumn } from "@shared/types";

function toKey(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

interface EditColumnsDialogProps {
  open: boolean;
  session: SessionRecord;
  onClose: () => void;
  onSaved: () => void;
}

export function EditColumnsDialog({
  open,
  session,
  onClose,
  onSaved,
}: EditColumnsDialogProps) {
  const [columns, setColumns] = useState<SessionColumn[]>(() =>
    session.columns.map((c) => ({ ...c })),
  );
  const [step, setStep] = useState<"edit" | "confirm">("edit");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const reset = () => {
    setColumns(session.columns.map((c) => ({ ...c })));
    setStep("edit");
    setError("");
    setSaving(false);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const addColumn = () =>
    setColumns((prev) => [...prev, { key: "", label: "", question: "" }]);

  const removeColumn = (i: number) =>
    setColumns((prev) => prev.filter((_, idx) => idx !== i));

  const updateColumn = (
    i: number,
    field: keyof SessionColumn,
    value: string,
  ) => {
    setColumns((prev) => {
      const next = [...prev];
      next[i] = { ...next[i], [field]: value };
      if (field === "label" && !next[i].key) {
        next[i].key = toKey(value);
      }
      return next;
    });
  };

  const canSave =
    columns.length > 0 &&
    columns.every((c) => c.key.trim() && c.label.trim() && c.question.trim());

  const handleSave = async () => {
    setSaving(true);
    setError("");
    try {
      await sessionsApi.updateColumns(session.id, columns);
      onSaved();
      handleClose();
    } catch (err: any) {
      setError(err.message ?? "Failed to update columns.");
      setStep("edit");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="sm:max-w-[620px] gap-0 p-0 overflow-hidden">
        {step === "edit" ? (
          <>
            <DialogHeader className="px-6 pt-5 pb-4 border-b">
              <DialogTitle>Edit Columns</DialogTitle>
              <p className="text-xs text-muted-foreground mt-1">
                Saving changes keeps existing extracted rows. New or renamed
                columns may need reprocessing before values appear.
              </p>
            </DialogHeader>

            <div className="px-6 py-4 space-y-3 max-h-[440px] overflow-y-auto">
              {columns.map((col, i) => (
                <div
                  key={i}
                  className="grid grid-cols-[1fr_1fr_1.5fr_auto] gap-2 items-end"
                >
                  <div>
                    <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide block mb-1">
                      Label
                    </label>
                    <Input
                      className="h-8 text-xs"
                      placeholder="Company Name"
                      value={col.label}
                      onChange={(e) => updateColumn(i, "label", e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide block mb-1">
                      Key
                    </label>
                    <Input
                      className="h-8 text-xs font-mono"
                      placeholder="company_name"
                      value={col.key}
                      onChange={(e) => updateColumn(i, "key", e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide block mb-1">
                      Question
                    </label>
                    <Input
                      className="h-8 text-xs"
                      placeholder="What is the company name?"
                      value={col.question}
                      onChange={(e) =>
                        updateColumn(i, "question", e.target.value)
                      }
                    />
                  </div>
                  <button
                    className="mb-0.5 p-1 text-muted-foreground hover:text-destructive transition-colors disabled:opacity-30"
                    onClick={() => removeColumn(i)}
                    disabled={columns.length === 1}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}

              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 text-xs mt-1"
                onClick={addColumn}
              >
                <Plus className="h-3.5 w-3.5" />
                Add Column
              </Button>
            </div>

            {error && (
              <p className="mx-6 mb-2 text-xs text-destructive">{error}</p>
            )}

            <DialogFooter className="px-6 py-4 border-t">
              <Button variant="ghost" size="sm" onClick={handleClose}>
                Cancel
              </Button>
              <Button
                size="sm"
                variant="destructive"
                disabled={!canSave}
                onClick={() => setStep("confirm")}
              >
                Save Changes
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader className="px-6 pt-5 pb-4 border-b">
              <DialogTitle className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
                Confirm Column Changes
              </DialogTitle>
            </DialogHeader>

            <div className="px-6 py-5 space-y-2">
              <p className="text-sm">
                Saving will keep existing extracted rows for documents in this
                session.
              </p>
              <p className="text-sm text-muted-foreground">
                Added or renamed columns may need reprocessing to populate new
                values.
              </p>
            </div>

            <DialogFooter className="px-6 py-4 border-t">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setStep("edit")}
                disabled={saving}
              >
                Go Back
              </Button>
              <Button size="sm" disabled={saving} onClick={handleSave}>
                {saving && (
                  <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                )}
                Save Columns
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
