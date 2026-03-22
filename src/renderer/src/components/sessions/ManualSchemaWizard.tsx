import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import {
  manualSchemasApiV2,
  type MsbSessionV2,
  type GroupV2,
  type ColumnConfig,
  type SheetConfig,
  type MsbPreviewSheet,
  type ColumnComputeConfig,
} from "@/api/client";
import type { SchemaPresetDraft } from "./SchemaBuilderDialog";
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  FileText,
  Layers,
  Loader2,
  Pencil,
  Plus,
  Save,
  Settings2,
  TableIcon,
  Trash2,
  Code2,
} from "lucide-react";

// ─── Props ────────────────────────────────────────────────────────────────────

interface ManualSchemaWizardProps {
  onSubmit: (preset: SchemaPresetDraft) => Promise<void> | void;
  submitting?: boolean;
}

type WizardStep = 1 | 2 | 3 | 4 | 5;

// ─── Helpers ─────────────────────────────────────────────────────────────────

type ComputeType = "copy" | "fixed" | "conditional" | "extract" | "combine";

const COMPUTE_LABELS: Record<ComputeType, string> = {
  copy: "Copy Column",
  fixed: "Fixed Value",
  conditional: "Conditional",
  extract: "Extract Pattern",
  combine: "Combine Columns",
};

const EXTRACT_PRESETS = [
  { value: "first_number", label: "First number" },
  { value: "text_before_dash", label: "Text before dash" },
  { value: "text_after_colon", label: "Text after colon" },
  { value: "text_in_parens", label: "Text in parentheses" },
  { value: "last_word", label: "Last word" },
  { value: "custom", label: "Custom regex…" },
];

function confidenceColor(c: "exact" | "similar" | "manual"): string {
  if (c === "exact") return "bg-emerald-100 text-emerald-800";
  if (c === "similar") return "bg-amber-100 text-amber-800";
  return "bg-blue-100 text-blue-800";
}

// ─── Step 1: Upload ───────────────────────────────────────────────────────────

function StepUpload({
  onExtracted,
}: {
  onExtracted: (s: MsbSessionV2) => void;
}) {
  const [filePath, setFilePath] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const pickFile = useCallback(async () => {
    const result = await (window as any).api.openFileDialog();
    if (!result.canceled && result.filePaths.length > 0) {
      setFilePath(result.filePaths[0]);
    }
  }, []);

  const extract = useCallback(async () => {
    if (!filePath) { setError("Please select a PDF file first."); return; }
    setBusy(true); setError("");
    try {
      const session = await manualSchemasApiV2.extract(filePath);
      onExtracted(session);
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  }, [filePath, onExtracted]);

  return (
    <div className="flex flex-col items-center justify-center gap-6 py-12">
      <div className="rounded-full bg-muted p-4">
        <FileText className="h-10 w-10 text-muted-foreground" />
      </div>
      <div className="text-center">
        <h3 className="text-lg font-semibold">Upload a PDF to get started</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Tables will be extracted and grouped automatically.
        </p>
      </div>
      <div className="w-full max-w-md flex gap-2">
        <Input
          value={filePath}
          readOnly
          placeholder="Select a PDF file…"
          className="flex-1 cursor-pointer"
          onClick={pickFile}
        />
        <Button variant="outline" onClick={pickFile}>
          Browse
        </Button>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button onClick={extract} disabled={!filePath || busy} className="w-48">
        {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <TableIcon className="mr-2 h-4 w-4" />}
        {busy ? "Extracting…" : "Extract Tables"}
      </Button>
    </div>
  );
}

// ─── Step 2: Review Groups ────────────────────────────────────────────────────

function StepReviewGroups({
  groups,
  onChange,
}: {
  groups: GroupV2[];
  onChange: (g: GroupV2[]) => void;
}) {
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameVal, setRenameVal] = useState("");

  const startRename = (g: GroupV2) => { setRenaming(g.id); setRenameVal(g.name); };
  const commitRename = () => {
    if (!renaming) return;
    onChange(groups.map((g) => g.id === renaming ? { ...g, name: renameVal.trim() || g.name } : g));
    setRenaming(null);
  };

  if (!groups.length) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16 text-muted-foreground">
        <Layers className="h-10 w-10" />
        <p>No table groups found in this file.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        {groups.length} table group{groups.length !== 1 ? "s" : ""} detected. Rename groups as needed before configuring columns.
      </p>
      <ScrollArea className="h-[360px] pr-2">
        <div className="flex flex-col gap-3">
          {groups.map((g) => (
            <div key={g.id} className="rounded-lg border bg-card p-4 flex flex-col gap-2">
              <div className="flex items-center gap-2">
                {renaming === g.id ? (
                  <>
                    <Input
                      autoFocus
                      value={renameVal}
                      onChange={(e) => setRenameVal(e.target.value)}
                      onBlur={commitRename}
                      onKeyDown={(e) => { if (e.key === "Enter") commitRename(); if (e.key === "Escape") setRenaming(null); }}
                      className="h-7 text-sm"
                    />
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={commitRename}>
                      <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                    </Button>
                  </>
                ) : (
                  <>
                    <span className="font-semibold text-sm flex-1">{g.name}</span>
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => startRename(g)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                  </>
                )}
                <Badge className={`text-xs ${confidenceColor(g.mergeConfidence)}`}>
                  {g.mergeConfidence}
                </Badge>
              </div>
              <div className="text-xs text-muted-foreground">
                {g.rawTableIds.length} table{g.rawTableIds.length !== 1 ? "s" : ""} merged
                {" · "}{g.rows.length} row{g.rows.length !== 1 ? "s" : ""}
                {" · "}pages {g.pageStart}–{g.pageEnd}
              </div>
              <div className="flex flex-wrap gap-1 mt-1">
                {g.headers.map((h) => (
                  <Badge key={h} variant="secondary" className="text-xs font-normal">{h}</Badge>
                ))}
              </div>
              {g.rows.length > 0 && (
                <div className="mt-1 overflow-x-auto rounded border text-xs">
                  <table className="w-full border-collapse">
                    <thead>
                      <tr>
                        {g.headers.slice(0, 6).map((h) => (
                          <th key={h} className="px-2 py-1 bg-muted text-left font-medium whitespace-nowrap">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {g.rows.slice(0, 3).map((row, i) => (
                        <tr key={i} className="border-t">
                          {g.headers.slice(0, 6).map((h) => (
                            <td key={h} className="px-2 py-1 text-muted-foreground whitespace-nowrap max-w-[120px] overflow-hidden text-ellipsis">{row[h] ?? ""}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}

// ─── Step 3: Configure Columns ────────────────────────────────────────────────

function ColumnComputeForm({
  col,
  headers,
  onChange,
}: {
  col: ColumnConfig;
  headers: string[];
  onChange: (c: ColumnConfig) => void;
}) {
  const cfg = (col.computeConfig || {}) as Record<string, any>;
  const set = (patch: Partial<ColumnComputeConfig>) =>
    onChange({ ...col, computeConfig: { ...col.computeConfig, ...patch } as ColumnComputeConfig });

  if (col.source === "detected") {
    return (
      <p className="text-xs text-muted-foreground italic">This column is taken directly from the extracted table.</p>
    );
  }

  return (
    <div className="flex flex-col gap-2 mt-1">
      <div className="flex gap-2 items-center">
        <Label className="text-xs w-24 shrink-0">Compute type</Label>
        <select
          className="flex h-8 w-full rounded-md border border-input bg-background px-2 py-1 text-xs"
          value={col.computeType || "copy"}
          onChange={(e) => onChange({ ...col, computeType: e.target.value as ComputeType, computeConfig: {} })}
        >
          {(Object.entries(COMPUTE_LABELS) as [ComputeType, string][]).map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </select>
      </div>

      {col.computeType === "copy" && (
        <div className="flex gap-2 items-center">
          <Label className="text-xs w-24 shrink-0">Source column</Label>
          <select
            className="flex h-8 w-full rounded-md border border-input bg-background px-2 py-1 text-xs"
            value={cfg.sourceKey || ""}
            onChange={(e) => set({ sourceKey: e.target.value })}
          >
            <option value="">— select —</option>
            {headers.map((h) => <option key={h} value={h}>{h}</option>)}
          </select>
        </div>
      )}

      {col.computeType === "fixed" && (
        <div className="flex gap-2 items-center">
          <Label className="text-xs w-24 shrink-0">Value</Label>
          <Input className="h-8 text-xs" value={cfg.value || ""} onChange={(e) => set({ value: e.target.value })} />
        </div>
      )}

      {col.computeType === "conditional" && (
        <div className="flex flex-col gap-2">
          <div className="flex gap-2 items-center">
            <Label className="text-xs w-24 shrink-0">Source</Label>
            <select
              className="flex h-8 w-full rounded-md border border-input bg-background px-2 py-1 text-xs"
              value={cfg.sourceKey || ""}
              onChange={(e) => set({ sourceKey: e.target.value })}
            >
              <option value="">— select —</option>
              {headers.map((h) => <option key={h} value={h}>{h}</option>)}
            </select>
          </div>
          <div className="flex gap-2 items-center">
            <Label className="text-xs w-24 shrink-0">Operator</Label>
            <select
              className="flex h-8 w-full rounded-md border border-input bg-background px-2 py-1 text-xs"
              value={cfg.operator || "equals"}
              onChange={(e) => set({ operator: e.target.value as any })}
            >
              <option value="equals">equals</option>
              <option value="notEquals">not equals</option>
              <option value="contains">contains</option>
              <option value="gt">greater than</option>
              <option value="lt">less than</option>
            </select>
          </div>
          <div className="flex gap-2 items-center">
            <Label className="text-xs w-24 shrink-0">Compare to</Label>
            <Input className="h-8 text-xs" value={cfg.compareValue || ""} onChange={(e) => set({ compareValue: e.target.value })} />
          </div>
          <div className="flex gap-2 items-center">
            <Label className="text-xs w-24 shrink-0">Then</Label>
            <Input className="h-8 text-xs" value={cfg.thenValue || ""} onChange={(e) => set({ thenValue: e.target.value })} />
          </div>
          <div className="flex gap-2 items-center">
            <Label className="text-xs w-24 shrink-0">Else</Label>
            <Input className="h-8 text-xs" value={cfg.elseValue || ""} onChange={(e) => set({ elseValue: e.target.value })} />
          </div>
        </div>
      )}

      {col.computeType === "extract" && (
        <div className="flex flex-col gap-2">
          <div className="flex gap-2 items-center">
            <Label className="text-xs w-24 shrink-0">Source column</Label>
            <select
              className="flex h-8 w-full rounded-md border border-input bg-background px-2 py-1 text-xs"
              value={cfg.sourceKey || ""}
              onChange={(e) => set({ sourceKey: e.target.value })}
            >
              <option value="">— select —</option>
              {headers.map((h) => <option key={h} value={h}>{h}</option>)}
            </select>
          </div>
          <div className="flex gap-2 items-center">
            <Label className="text-xs w-24 shrink-0">Pattern</Label>
            <select
              className="flex h-8 w-full rounded-md border border-input bg-background px-2 py-1 text-xs"
              value={cfg.preset || "first_number"}
              onChange={(e) => set({ preset: e.target.value })}
            >
              {EXTRACT_PRESETS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </div>
          {cfg.preset === "custom" && (
            <div className="flex gap-2 items-center">
              <Label className="text-xs w-24 shrink-0">Regex</Label>
              <Input className="h-8 text-xs font-mono" value={cfg.customPattern || ""} onChange={(e) => set({ customPattern: e.target.value })} placeholder="e.g. (\d+\.\d{2})" />
            </div>
          )}
        </div>
      )}

      {col.computeType === "combine" && (
        <div className="flex flex-col gap-2">
          <div className="flex gap-2 items-center">
            <Label className="text-xs w-24 shrink-0">Separator</Label>
            <Input className="h-8 text-xs w-24" value={cfg.separator ?? " "} onChange={(e) => set({ separator: e.target.value })} />
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs">Columns to combine</Label>
            <div className="flex flex-col gap-1">
              {headers.map((h) => (
                <label key={h} className="flex items-center gap-2 text-xs cursor-pointer">
                  <Checkbox
                    checked={Array.isArray(cfg.sourceKeys) && cfg.sourceKeys.includes(h)}
                    onCheckedChange={(checked) => {
                      const current: string[] = Array.isArray(cfg.sourceKeys) ? cfg.sourceKeys : [];
                      set({ sourceKeys: checked ? [...current, h] : current.filter((k) => k !== h) });
                    }}
                  />
                  {h}
                </label>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StepConfigureColumns({
  groups,
  onChange,
}: {
  groups: GroupV2[];
  onChange: (g: GroupV2[]) => void;
}) {
  const [selectedGroupId, setSelectedGroupId] = useState(groups[0]?.id || "");
  const selectedGroup = groups.find((g) => g.id === selectedGroupId);

  const updateGroup = useCallback(
    (gid: string, patch: Partial<GroupV2>) =>
      onChange(groups.map((g) => (g.id === gid ? { ...g, ...patch } : g))),
    [groups, onChange],
  );

  const updateCol = useCallback(
    (gid: string, colKey: string, patch: Partial<ColumnConfig>) =>
      updateGroup(gid, {
        columns: (groups.find((g) => g.id === gid)?.columns || []).map((c) =>
          c.key === colKey ? { ...c, ...patch } : c,
        ),
      }),
    [groups, updateGroup],
  );

  const addComputedColumn = useCallback(
    (gid: string) => {
      const g = groups.find((gr) => gr.id === gid);
      if (!g) return;
      const newCol: ColumnConfig = {
        key: `computed_${Date.now()}`,
        label: "New Column",
        source: "computed",
        included: true,
        format: "text",
        sampleValue: "",
        computeType: "fixed",
        computeConfig: { value: "" },
      };
      updateGroup(gid, { columns: [...(g.columns || []), newCol] });
    },
    [groups, updateGroup],
  );

  const removeComputedColumn = useCallback(
    (gid: string, colKey: string) => {
      const g = groups.find((gr) => gr.id === gid);
      if (!g) return;
      updateGroup(gid, { columns: g.columns.filter((c) => c.key !== colKey) });
    },
    [groups, updateGroup],
  );

  const [editingLabel, setEditingLabel] = useState<string | null>(null);
  const [labelVal, setLabelVal] = useState("");

  return (
    <div className="flex gap-4 h-[400px]">
      {/* Group selector */}
      <div className="w-44 shrink-0 flex flex-col gap-1">
        <p className="text-xs font-medium text-muted-foreground mb-1">Groups</p>
        {groups.map((g) => (
          <button
            key={g.id}
            className={`text-left text-xs rounded-md px-2 py-1.5 transition-colors truncate ${selectedGroupId === g.id ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
            onClick={() => setSelectedGroupId(g.id)}
          >
            {g.name}
          </button>
        ))}
      </div>

      {/* Column editor */}
      {selectedGroup ? (
        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-medium text-muted-foreground">
              Columns for <span className="text-foreground">{selectedGroup.name}</span>
            </p>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              onClick={() => addComputedColumn(selectedGroup.id)}
            >
              <Plus className="h-3.5 w-3.5 mr-1" />
              Add Computed
            </Button>
          </div>
          <ScrollArea className="flex-1">
            <div className="flex flex-col gap-2 pr-2">
              {(selectedGroup.columns || []).map((col) => (
                <div key={col.key} className="rounded-md border bg-card p-3 flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      checked={col.included}
                      onCheckedChange={(v) => updateCol(selectedGroup.id, col.key, { included: !!v })}
                    />
                    {editingLabel === col.key ? (
                      <Input
                        autoFocus
                        value={labelVal}
                        onChange={(e) => setLabelVal(e.target.value)}
                        onBlur={() => { updateCol(selectedGroup.id, col.key, { label: labelVal || col.label }); setEditingLabel(null); }}
                        onKeyDown={(e) => { if (e.key === "Enter") { updateCol(selectedGroup.id, col.key, { label: labelVal || col.label }); setEditingLabel(null); } }}
                        className="h-6 text-xs flex-1"
                      />
                    ) : (
                      <span
                        className="text-xs font-medium flex-1 cursor-pointer hover:underline"
                        onClick={() => { setEditingLabel(col.key); setLabelVal(col.label); }}
                      >
                        {col.label}
                      </span>
                    )}
                    <Badge variant={col.source === "detected" ? "secondary" : "outline"} className="text-[10px]">
                      {col.source}
                    </Badge>
                    {col.source === "computed" && (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-6 w-6 text-destructive"
                        onClick={() => removeComputedColumn(selectedGroup.id, col.key)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                  {col.included && (
                    <ColumnComputeForm
                      col={col}
                      headers={selectedGroup.headers}
                      onChange={(updated) => updateCol(selectedGroup.id, col.key, updated)}
                    />
                  )}
                </div>
              ))}
            </div>
          </ScrollArea>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
          Select a group to configure its columns.
        </div>
      )}
    </div>
  );
}

// ─── Step 4: Assign Sheets ────────────────────────────────────────────────────

function StepAssignSheets({
  groups,
  sheets,
  onChange,
}: {
  groups: GroupV2[];
  sheets: SheetConfig[];
  onChange: (s: SheetConfig[]) => void;
}) {
  const addSheet = () => onChange([...sheets, { name: `Sheet ${sheets.length + 1}`, groupIds: [], includeContext: false }]);
  const removeSheet = (idx: number) => {
    if (sheets.length <= 1) return;
    onChange(sheets.filter((_, i) => i !== idx));
  };
  const renameSheet = (idx: number, name: string) => onChange(sheets.map((s, i) => (i === idx ? { ...s, name } : s)));
  const toggleContext = (idx: number) => onChange(sheets.map((s, i) => (i === idx ? { ...s, includeContext: !s.includeContext } : s)));
  const assignGroup = (groupId: string, sheetIdx: number) => {
    onChange(
      sheets.map((s, i) => ({
        ...s,
        groupIds: i === sheetIdx
          ? (s.groupIds.includes(groupId) ? s.groupIds : [...s.groupIds, groupId])
          : s.groupIds.filter((g) => g !== groupId),
      })),
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Assign each group to a sheet in the output Excel file.</p>
        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={addSheet}>
          <Plus className="h-3.5 w-3.5 mr-1" />
          Add Sheet
        </Button>
      </div>
      <ScrollArea className="h-[340px] pr-2">
        <div className="flex flex-col gap-3">
          {sheets.map((sheet, sheetIdx) => (
            <div key={sheetIdx} className="rounded-lg border bg-card p-3 flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <Input
                  value={sheet.name}
                  onChange={(e) => renameSheet(sheetIdx, e.target.value)}
                  className="h-7 text-xs flex-1"
                />
                <label className="flex items-center gap-1 text-xs cursor-pointer whitespace-nowrap">
                  <Checkbox checked={sheet.includeContext} onCheckedChange={() => toggleContext(sheetIdx)} />
                  Include context
                </label>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 text-muted-foreground"
                  onClick={() => removeSheet(sheetIdx)}
                  disabled={sheets.length <= 1}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
              <div className="flex flex-wrap gap-1">
                {groups.map((g) => {
                  const inSheet = sheet.groupIds.includes(g.id);
                  return (
                    <button
                      key={g.id}
                      className={`rounded-full px-2 py-0.5 text-xs border transition-colors ${inSheet ? "bg-primary text-primary-foreground border-primary" : "border-input hover:bg-muted"}`}
                      onClick={() => assignGroup(g.id, sheetIdx)}
                    >
                      {g.name}
                      {inSheet && " ✓"}
                    </button>
                  );
                })}
              </div>
              {!sheet.groupIds.length && (
                <p className="text-xs text-muted-foreground italic">No groups assigned — click group names above to add them.</p>
              )}
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}

// ─── Step 5: Preview & Save ───────────────────────────────────────────────────

function StepPreview({
  sessionId,
  schemaName,
  setSchemaName,
  onSave,
  saving,
}: {
  sessionId: string;
  schemaName: string;
  setSchemaName: (v: string) => void;
  onSave: () => void;
  saving: boolean;
}) {
  const [sheets, setSheets] = useState<MsbPreviewSheet[]>([]);
  const [activeSheet, setActiveSheet] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setBusy(true); setError("");
    try {
      const res = await manualSchemasApiV2.preview(sessionId);
      setSheets(res.sheets);
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  }, [sessionId]);

  // Load on mount
  useState(() => { load(); });

  const active = sheets[activeSheet];

  return (
    <div className="flex flex-col gap-3 h-[400px]">
      {busy && (
        <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span className="text-sm">Loading preview…</span>
        </div>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
      {!busy && sheets.length > 0 && (
        <>
          {/* Sheet tabs */}
          <div className="flex gap-1 border-b pb-1">
            {sheets.map((s, i) => (
              <button
                key={i}
                className={`text-xs px-3 py-1.5 rounded-t-md transition-colors ${i === activeSheet ? "bg-background border border-b-0 font-medium" : "text-muted-foreground hover:bg-muted"}`}
                onClick={() => setActiveSheet(i)}
              >
                {s.name}
                <span className="ml-1.5 text-[10px] text-muted-foreground">{s.rowCount}</span>
              </button>
            ))}
          </div>
          {/* Preview table */}
          <ScrollArea className="flex-1">
            {active && active.columns.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-xs">
                  <thead>
                    <tr>
                      {active.columns.map((c) => (
                        <th key={c} className="px-2 py-1.5 bg-muted text-left font-medium whitespace-nowrap border-b">{c}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {active.rows.slice(0, 50).map((row, i) => (
                      <tr key={i} className="border-b last:border-0">
                        {active.columns.map((c) => (
                          <td key={c} className="px-2 py-1 text-muted-foreground whitespace-nowrap max-w-[160px] overflow-hidden text-ellipsis">{row[c] ?? ""}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground italic p-4">This sheet has no columns with "included" enabled.</p>
            )}
          </ScrollArea>
          {active?.warnings?.length > 0 && (
            <div className="rounded-md bg-amber-50 border border-amber-200 p-2">
              {active.warnings.map((w, i) => <p key={i} className="text-xs text-amber-800">{w}</p>)}
            </div>
          )}
        </>
      )}
      {/* Save row */}
      <div className="flex items-center gap-2 border-t pt-3 mt-auto">
        <Label className="text-xs shrink-0">Schema name</Label>
        <Input value={schemaName} onChange={(e) => setSchemaName(e.target.value)} className="h-8 text-xs flex-1" />
        <Button onClick={onSave} disabled={saving || !schemaName.trim()} className="h-8 text-xs">
          {saving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1.5 h-3.5 w-3.5" />}
          Save Schema
        </Button>
      </div>
    </div>
  );
}

// ─── Wizard shell ─────────────────────────────────────────────────────────────

const STEP_META: { icon: React.FC<any>; label: string }[] = [
  { icon: FileText, label: "Upload" },
  { icon: Layers, label: "Review Groups" },
  { icon: Settings2, label: "Configure Columns" },
  { icon: TableIcon, label: "Assign Sheets" },
  { icon: CheckCircle2, label: "Preview & Save" },
];

export function ManualSchemaWizard({ onSubmit, submitting = false }: ManualSchemaWizardProps) {
  const [step, setStep] = useState<WizardStep>(1);
  const [session, setSession] = useState<MsbSessionV2 | null>(null);
  const [groups, setGroups] = useState<GroupV2[]>([]);
  const [sheets, setSheets] = useState<SheetConfig[]>([]);
  const [schemaName, setSchemaName] = useState("Manual Schema");
  const [saving, setSaving] = useState(false);
  const [savingErr, setSavingErr] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [showJson, setShowJson] = useState(false);

  const onExtracted = useCallback((s: MsbSessionV2) => {
    setSession(s);
    setGroups(s.groups);
    setSheets(s.sheets);
    setStep(2);
  }, []);

  // Sync groups/sheets to server before advancing
  const syncAndAdvance = useCallback(async () => {
    if (!session) return;
    setSyncing(true);
    try {
      await manualSchemasApiV2.updateGroups(session.id, groups);
      await manualSchemasApiV2.updateSheets(session.id, sheets);
    } catch { /* non-blocking, preview will use DB state */ }
    setSyncing(false);
  }, [session, groups, sheets]);

  const canAdvance = (() => {
    if (step === 1) return false;
    if (step === 5) return false;
    return true;
  })();

  const advance = async () => {
    if (step === 4) await syncAndAdvance();
    setStep((s) => Math.min(5, s + 1) as WizardStep);
  };
  const back = () => setStep((s) => Math.max(1, s - 1) as WizardStep);

  const saveSchema = useCallback(async () => {
    if (!session) return;
    setSaving(true); setSavingErr("");
    try {
      await manualSchemasApiV2.updateGroups(session.id, groups);
      await manualSchemasApiV2.updateSheets(session.id, sheets);
      await manualSchemasApiV2.saveSchema(session.id, { name: schemaName });

      // Convert to SchemaPresetDraft so the parent can persist it
      const draft: SchemaPresetDraft = {
        name: schemaName,
        extractionMode: "GENERIC",
        tabs: sheets.map((sheet) => {
          const sheetGroups = groups.filter((g) => sheet.groupIds.includes(g.id));
          const fields: SchemaPresetDraft["tabs"][number]["fields"] = [];
          for (const g of sheetGroups) {
            for (const col of g.columns || []) {
              if (!col.included) continue;
              fields.push({
                label: col.label,
                fieldKey: col.key,
                regexRule: col.computeConfig?.customPattern || col.computeConfig?.preset || "",
                extractionStrategy: col.source === "detected" ? "table_column" : "regex",
              });
            }
          }
          return { name: sheet.name, fields };
        }),
      };
      await onSubmit(draft);
    } catch (e: any) {
      setSavingErr(String(e?.message ?? e));
    } finally {
      setSaving(false);
    }
  }, [session, groups, sheets, schemaName, onSubmit]);

  const jsonPayload = JSON.stringify({ groups, sheets }, null, 2);

  return (
    <div className="flex flex-col gap-5">
      {/* Progress */}
      <div className="flex items-center gap-0">
        {STEP_META.map(({ icon: Icon, label }, i) => {
          const s = (i + 1) as WizardStep;
          const active = step === s;
          const done = step > s;
          return (
            <div key={s} className="flex items-center flex-1 last:flex-none">
              <div className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-xs transition-colors ${active ? "text-primary font-medium" : done ? "text-muted-foreground" : "text-muted-foreground/50"}`}>
                <Icon className={`h-3.5 w-3.5 ${done ? "text-emerald-600" : ""}`} />
                <span className="hidden sm:inline">{label}</span>
              </div>
              {i < STEP_META.length - 1 && <div className={`flex-1 h-px mx-1 ${done ? "bg-emerald-400" : "bg-border"}`} />}
            </div>
          );
        })}
      </div>

      {/* Step content */}
      <div className="min-h-[360px]">
        {step === 1 && <StepUpload onExtracted={onExtracted} />}
        {step === 2 && <StepReviewGroups groups={groups} onChange={setGroups} />}
        {step === 3 && <StepConfigureColumns groups={groups} onChange={setGroups} />}
        {step === 4 && <StepAssignSheets groups={groups} sheets={sheets} onChange={setSheets} />}
        {step === 5 && session && (
          <StepPreview
            sessionId={session.id}
            schemaName={schemaName}
            setSchemaName={setSchemaName}
            onSave={saveSchema}
            saving={saving || submitting}
          />
        )}
      </div>

      {savingErr && <p className="text-sm text-destructive">{savingErr}</p>}

      {/* Nav buttons */}
      <div className="flex items-center justify-between border-t pt-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowJson((v) => !v)}
          disabled={!session}
          className="text-xs text-muted-foreground"
        >
          <Code2 className="h-3.5 w-3.5 mr-1.5" />
          {showJson ? "Hide JSON" : "View as JSON"}
        </Button>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={back} disabled={step === 1}>
            <ChevronLeft className="h-4 w-4 mr-1" />
            Back
          </Button>
          {step < 5 && (
            <Button size="sm" onClick={advance} disabled={!canAdvance || syncing}>
              {syncing ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <ChevronRight className="h-4 w-4 mr-1" />}
              {syncing ? "Saving…" : "Next"}
            </Button>
          )}
        </div>
      </div>

      {/* JSON escape hatch */}
      {showJson && (
        <div className="rounded-md border bg-muted p-3">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-medium">Current configuration (JSON)</p>
            <Button
              size="sm"
              variant="ghost"
              className="text-xs h-7"
              onClick={() => navigator.clipboard.writeText(jsonPayload)}
            >
              Copy
            </Button>
          </div>
          <ScrollArea className="h-48">
            <pre className="text-xs font-mono whitespace-pre-wrap break-all">{jsonPayload}</pre>
          </ScrollArea>
        </div>
      )}
    </div>
  );
}
