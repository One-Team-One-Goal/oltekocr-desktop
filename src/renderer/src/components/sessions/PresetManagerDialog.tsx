import { useEffect, useMemo, useState } from "react";
import { sessionPresetsApi } from "@/api/client";
import type { SessionColumn, SessionPresetRecord } from "@shared/types";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Plus, Trash2 } from "lucide-react";

interface PresetManagerDialogProps {
  open: boolean;
  onClose: () => void;
  onChanged: (presets: SessionPresetRecord[]) => void;
}

type SessionMode = "OCR_EXTRACT" | "TABLE_EXTRACT";

function toKey(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

function emptyColumn(): SessionColumn {
  return { key: "", label: "", question: "" };
}

export function PresetManagerDialog({
  open,
  onClose,
  onChanged,
}: PresetManagerDialogProps) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [presets, setPresets] = useState<SessionPresetRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string>("new");

  const [name, setName] = useState("");
  const [mode, setMode] = useState<SessionMode>("TABLE_EXTRACT");
  const [columns, setColumns] = useState<SessionColumn[]>([emptyColumn()]);

  const selectedPreset = useMemo(
    () => presets.find((preset) => preset.id === selectedId) ?? null,
    [presets, selectedId],
  );

  const loadPresets = async () => {
    setLoading(true);
    setError("");
    try {
      const data = await sessionPresetsApi.list();
      setPresets(data);
      onChanged(data);
    } catch (err: any) {
      setError(err.message ?? "Failed to load presets");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    loadPresets();
  }, [open]);

  useEffect(() => {
    if (!selectedPreset) {
      setName("");
      setMode("TABLE_EXTRACT");
      setColumns([emptyColumn()]);
      return;
    }
    setName(selectedPreset.name);
    const presetMode: SessionMode =
      selectedPreset.mode === "TABLE_EXTRACT" ? "TABLE_EXTRACT" : "OCR_EXTRACT";
    setMode(presetMode);
    setColumns(
      presetMode === "TABLE_EXTRACT" && selectedPreset.columns.length > 0
        ? selectedPreset.columns
        : [emptyColumn()],
    );
  }, [selectedPreset]);

  const addColumn = () => setColumns((prev) => [...prev, emptyColumn()]);

  const updateColumn = (
    index: number,
    field: keyof SessionColumn,
    value: string,
  ) => {
    setColumns((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      if (field === "label") {
        next[index].key = toKey(value);
      }
      return next;
    });
  };

  const removeColumn = (index: number) => {
    setColumns((prev) => (prev.length === 1 ? prev : prev.filter((_, i) => i !== index)));
  };

  const validate = () => {
    if (!name.trim()) return false;
    if (mode === "TABLE_EXTRACT") {
      return columns.every(
        (column) =>
          column.key.trim().length > 0 &&
          column.label.trim().length > 0 &&
          column.question.trim().length > 0,
      );
    }
    return true;
  };

  const handleSave = async () => {
    if (!validate()) return;
    setSaving(true);
    setError("");

    try {
      const payload = {
        name: name.trim(),
        mode,
        columns:
          mode === "TABLE_EXTRACT"
            ? columns.map((column) => ({
                key: column.key.trim(),
                label: column.label.trim(),
                question: column.question.trim(),
              }))
            : [],
      };

      if (selectedPreset) {
        await sessionPresetsApi.update(selectedPreset.id, payload);
      } else {
        await sessionPresetsApi.create(payload);
      }

      await loadPresets();
    } catch (err: any) {
      setError(err.message ?? "Failed to save preset");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedPreset) return;
    if (!confirm(`Delete preset '${selectedPreset.name}'?`)) return;

    setSaving(true);
    setError("");
    try {
      await sessionPresetsApi.remove(selectedPreset.id);
      setSelectedId("new");
      await loadPresets();
    } catch (err: any) {
      setError(err.message ?? "Failed to delete preset");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-[760px] max-h-[90vh] overflow-hidden p-0 gap-0">
        <DialogHeader className="px-6 py-4 border-b">
          <DialogTitle>Manage Document Presets</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-[220px_1fr] min-h-[460px]">
          <div className="border-r p-3 space-y-2 overflow-y-auto">
            <Button
              variant={selectedId === "new" ? "default" : "outline"}
              className="w-full justify-start"
              size="sm"
              onClick={() => setSelectedId("new")}
            >
              <Plus className="h-3.5 w-3.5" />
              New Preset
            </Button>

            {loading ? (
              <div className="text-xs text-muted-foreground px-2 py-1">Loading presets...</div>
            ) : presets.length === 0 ? (
              <div className="text-xs text-muted-foreground px-2 py-1">No presets yet.</div>
            ) : (
              presets.map((preset) => (
                <button
                  key={preset.id}
                  className={`w-full text-left px-2.5 py-2 rounded-md border text-sm ${
                    selectedId === preset.id
                      ? "border-primary bg-primary/5"
                      : "border-border hover:bg-muted/40"
                  }`}
                  onClick={() => setSelectedId(preset.id)}
                >
                  <div className="font-medium truncate">{preset.name}</div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">
                    {preset.mode === "TABLE_EXTRACT"
                      ? `${preset.columns.length} column${preset.columns.length === 1 ? "" : "s"}`
                      : "OCR Extract"}
                  </div>
                </button>
              ))
            )}
          </div>

          <div className="p-4 space-y-4 overflow-y-auto">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium">Preset Name</label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Court Orders V1"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium">Mode</label>
                <Select
                  value={mode}
                  onValueChange={(value) =>
                    setMode(value as "OCR_EXTRACT" | "TABLE_EXTRACT")
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="TABLE_EXTRACT">Table Extract</SelectItem>
                    <SelectItem value="OCR_EXTRACT">OCR Extract</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {mode === "TABLE_EXTRACT" && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium">Columns</p>
                  <Button variant="outline" size="sm" className="gap-1" onClick={addColumn}>
                    <Plus className="h-3.5 w-3.5" />
                    Add Column
                  </Button>
                </div>

                <div className="space-y-2">
                  {columns.map((column, index) => (
                    <div
                      key={index}
                      className="grid grid-cols-[1fr_1fr_auto] gap-2 items-start p-3 rounded-lg border bg-muted/20"
                    >
                      <div className="space-y-1">
                        <Input
                          className="h-8 text-xs"
                          placeholder="Column Label"
                          value={column.label}
                          onChange={(e) => updateColumn(index, "label", e.target.value)}
                        />
                        <Input
                          className="h-7 text-[11px] font-mono"
                          placeholder="column_key"
                          value={column.key}
                          onChange={(e) => updateColumn(index, "key", e.target.value)}
                        />
                      </div>

                      <Input
                        className="h-8 text-xs mt-[2px]"
                        placeholder="What value should be extracted?"
                        value={column.question}
                        onChange={(e) => updateColumn(index, "question", e.target.value)}
                      />

                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-red-500"
                        onClick={() => removeColumn(index)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {error && (
              <p className="text-xs text-red-600 border border-red-200 bg-red-50 rounded-md px-3 py-2">
                {error}
              </p>
            )}
          </div>
        </div>

        <DialogFooter className="px-6 py-4 border-t flex items-center justify-between">
          <div>
            {selectedPreset && (
              <Button
                variant="ghost"
                size="sm"
                className="text-red-600 hover:text-red-700"
                onClick={handleDelete}
                disabled={saving}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete
              </Button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={onClose}>
              Close
            </Button>
            <Button size="sm" onClick={handleSave} disabled={!validate() || saving}>
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              {selectedPreset ? "Save Changes" : "Create Preset"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
