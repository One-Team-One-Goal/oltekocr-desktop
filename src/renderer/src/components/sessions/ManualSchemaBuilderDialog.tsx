import { useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  manualSchemasApi,
  type ManualOutputColumn,
  type ManualSchemaBlock,
  type ManualSchemaGroup,
} from "@/api/client";
import type { SchemaPresetDraft } from "./SchemaBuilderDialog";
import { Loader2, Plus, Trash2 } from "lucide-react";

interface ManualSchemaBuilderDialogProps {
  open: boolean;
  onClose: () => void;
  submitting?: boolean;
  onSubmit: (preset: SchemaPresetDraft) => Promise<void> | void;
}

type BuilderTab = "groups" | "columns" | "preview";

function normalizeFieldKey(input: string): string {
  const key = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return key || "column";
}

export function ManualSchemaBuilderDialog({
  open,
  onClose,
  submitting = false,
  onSubmit,
}: ManualSchemaBuilderDialogProps) {
  const [tab, setTab] = useState<BuilderTab>("groups");
  const [schemaName, setSchemaName] = useState("Other Manual Schema");
  const [schemaCategory, setSchemaCategory] = useState("OTHER");
  const [sessionId, setSessionId] = useState("");
  const [fileName, setFileName] = useState("");
  const [blocks, setBlocks] = useState<ManualSchemaBlock[]>([]);
  const [groups, setGroups] = useState<ManualSchemaGroup[]>([]);
  const [outputColumns, setOutputColumns] = useState<ManualOutputColumn[]>([]);
  const [previewRows, setPreviewRows] = useState<Record<string, string>[]>([]);
  const [previewColumns, setPreviewColumns] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const hasLoaded = !!sessionId;

  const contextKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const g of groups) {
      for (const key of Object.keys(g.context || {})) {
        keys.add(key);
      }
    }
    return Array.from(keys);
  }, [groups]);

  const sampleColumnKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const g of groups) {
      const first = g.rows?.[0] || {};
      for (const key of Object.keys(first)) {
        keys.add(key);
      }
    }
    return Array.from(keys);
  }, [groups]);

  const pickPdfAndExtract = async () => {
    setError("");
    try {
      const result = await window.api.openFileDialog();
      if (result.canceled || result.filePaths.length === 0) return;

      const filePath = result.filePaths[0];
      setBusy(true);
      const extracted = await manualSchemasApi.extractBlocks(filePath);
      setSessionId(extracted.sessionId);
      setFileName(extracted.fileName);
      setBlocks(extracted.blocks || []);
      setGroups(extracted.groups || []);
      setTab("groups");
      setPreviewRows([]);
      setPreviewColumns([]);

      if (outputColumns.length === 0) {
        const firstCtx = extracted.detectedContextKeys?.[0];
        const firstCol = extracted.groups?.[0]?.headers?.[0];
        setOutputColumns([
          {
            name: firstCol || "value",
            sourceType: "column",
            sourceKey: firstCol || "",
          },
          {
            name: firstCtx || "context",
            sourceType: "context",
            sourceKey: firstCtx || "",
          },
        ]);
      }
    } catch (err: any) {
      setError(err?.message || "Failed to extract manual schema blocks");
    } finally {
      setBusy(false);
    }
  };

  const updateGroupContext = (groupId: string, key: string, value: string) => {
    setGroups((prev) =>
      prev.map((g) =>
        g.id === groupId
          ? {
              ...g,
              context: { ...g.context, [key]: value },
            }
          : g,
      ),
    );
  };

  const addOutputColumn = () => {
    setOutputColumns((prev) => [
      ...prev,
      { name: `column_${prev.length + 1}`, sourceType: "column", sourceKey: "" },
    ]);
  };

  const runPreview = async () => {
    if (!sessionId) return;
    setBusy(true);
    setError("");
    try {
      await manualSchemasApi.updateGroups(sessionId, groups);
      const preview = await manualSchemasApi.preview(sessionId, {
        outputColumns,
        editedGroups: groups,
      });
      setPreviewRows(preview.rows || []);
      setPreviewColumns(preview.columns || []);
      setTab("preview");
    } catch (err: any) {
      setError(err?.message || "Preview failed");
    } finally {
      setBusy(false);
    }
  };

  const saveAndContinue = async () => {
    if (!sessionId) return;
    if (!schemaName.trim()) {
      setError("Schema name is required.");
      return;
    }

    setBusy(true);
    setError("");
    try {
      await manualSchemasApi.updateGroups(sessionId, groups);
      const saved = await manualSchemasApi.saveDefinition({
        name: schemaName.trim(),
        category: schemaCategory.trim() || "OTHER",
        outputColumns,
      });
      await manualSchemasApi.attachSchema(sessionId, saved.id);

      const tabs = [
        {
          name: "Manual Output",
          fields: outputColumns.map((c) => ({
            label: c.name,
            fieldKey: normalizeFieldKey(c.name),
            regexRule: c.regexPattern || "",
            extractionStrategy: (
              c.sourceType === "column"
                ? "table_column"
                : c.sourceType === "context"
                  ? "header_field"
                  : "regex"
            ) as "regex" | "table_column" | "header_field" | "page_region",
            dataType: "string" as const,
          })),
        },
      ];

      await onSubmit({
        name: schemaName.trim(),
        extractionMode: "GENERIC",
        tabs,
      });
    } catch (err: any) {
      setError(err?.message || "Failed to save manual schema");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="sm:max-w-[1200px] h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Manual Schema Builder</DialogTitle>
          <DialogDescription>
            Upload PDF, review extracted blocks, map output columns, preview rows, then save reusable schema.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-[340px_1fr] gap-4 min-h-0 flex-1">
          <div className="border rounded-md p-3 min-h-0 flex flex-col">
            <div className="flex items-center justify-between gap-2 pb-2 border-b">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Raw Blocks</p>
              <Button size="sm" variant="outline" onClick={pickPdfAndExtract} disabled={busy || submitting}>
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Upload PDF"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mt-2 truncate" title={fileName}>{fileName || "No file loaded"}</p>
            <ScrollArea className="mt-2 flex-1 min-h-0 pr-2">
              <div className="space-y-2">
                {blocks.map((b) => (
                  <div key={b.id} className="rounded border px-2 py-1.5 text-xs">
                    <p className="text-[10px] text-muted-foreground">p{b.page} • y{Math.round(b.y)} • {b.type}</p>
                    {b.type === "kv_pair" ? (
                      <p className="mt-1"><span className="font-semibold">{b.key}</span>: {b.value}</p>
                    ) : b.type === "table" ? (
                      <p className="mt-1">{(b.headers || []).join(" | ")} ({b.rows?.length || 0} rows)</p>
                    ) : (
                      <p className="mt-1 line-clamp-2">{b.text}</p>
                    )}
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>

          <div className="border rounded-md p-3 min-h-0 flex flex-col">
            <div className="flex items-center gap-2 pb-2 border-b">
              <Button size="sm" variant={tab === "groups" ? "secondary" : "ghost"} onClick={() => setTab("groups")}>Groups</Button>
              <Button size="sm" variant={tab === "columns" ? "secondary" : "ghost"} onClick={() => setTab("columns")}>Output Columns</Button>
              <Button size="sm" variant={tab === "preview" ? "secondary" : "ghost"} onClick={() => setTab("preview")}>Preview</Button>
              <div className="ml-auto flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={runPreview} disabled={!hasLoaded || busy || submitting}>Run Preview</Button>
                <Button size="sm" onClick={saveAndContinue} disabled={!hasLoaded || busy || submitting}>Use Schema</Button>
              </div>
            </div>

            {error && <p className="text-xs text-destructive mt-2">{error}</p>}

            {tab === "groups" && (
              <ScrollArea className="mt-3 flex-1 min-h-0 pr-2">
                <div className="space-y-2">
                  {groups.map((group) => (
                    <div key={group.id} className="rounded border p-2 space-y-2">
                      <p className="text-xs font-medium">Rows: {group.rows?.length || 0} • Pages: {group.pageStart}-{group.pageEnd}</p>
                      <div className="grid grid-cols-2 gap-2">
                        {Object.entries(group.context || {}).map(([key, value]) => (
                          <div key={key}>
                            <Label className="text-[11px]">{key}</Label>
                            <Input
                              className="h-7 text-xs"
                              value={value || ""}
                              onChange={(e) => updateGroupContext(group.id, key, e.target.value)}
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}

            {tab === "columns" && (
              <ScrollArea className="mt-3 flex-1 min-h-0 pr-2">
                <div className="space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label className="text-[11px]">Schema Name</Label>
                      <Input value={schemaName} onChange={(e) => setSchemaName(e.target.value)} className="h-8 text-xs" />
                    </div>
                    <div>
                      <Label className="text-[11px]">Category</Label>
                      <Input value={schemaCategory} onChange={(e) => setSchemaCategory(e.target.value)} className="h-8 text-xs" />
                    </div>
                  </div>

                  <Button size="sm" variant="outline" onClick={addOutputColumn}>
                    <Plus className="h-3.5 w-3.5 mr-1" /> Add Output Column
                  </Button>

                  {outputColumns.map((col, idx) => (
                    <div key={idx} className="rounded border p-2 space-y-2">
                      <div className="grid grid-cols-[1fr_130px_1fr_auto] gap-2 items-end">
                        <div>
                          <Label className="text-[11px]">Output Name</Label>
                          <Input
                            className="h-8 text-xs"
                            value={col.name}
                            onChange={(e) =>
                              setOutputColumns((prev) =>
                                prev.map((item, i) => (i === idx ? { ...item, name: e.target.value } : item)),
                              )
                            }
                          />
                        </div>
                        <div>
                          <Label className="text-[11px]">Source Type</Label>
                          <select
                            className="h-8 w-full rounded border bg-background px-2 text-xs"
                            value={col.sourceType}
                            onChange={(e) =>
                              setOutputColumns((prev) =>
                                prev.map((item, i) =>
                                  i === idx
                                    ? {
                                        ...item,
                                        sourceType: e.target.value as ManualOutputColumn["sourceType"],
                                      }
                                    : item,
                                ),
                              )
                            }
                          >
                            <option value="column">column</option>
                            <option value="context">context</option>
                            <option value="static">static</option>
                            <option value="regex">regex</option>
                            <option value="conditional">conditional</option>
                          </select>
                        </div>
                        <div>
                          <Label className="text-[11px]">Source Key / Value</Label>
                          <Input
                            className="h-8 text-xs"
                            list={col.sourceType === "column" ? "manual-column-keys" : col.sourceType === "context" ? "manual-context-keys" : undefined}
                            value={
                              col.sourceType === "static"
                                ? col.staticValue || ""
                                : col.sourceType === "regex"
                                  ? col.regexPattern || ""
                                  : col.sourceKey || ""
                            }
                            onChange={(e) =>
                              setOutputColumns((prev) =>
                                prev.map((item, i) => {
                                  if (i !== idx) return item;
                                  if (item.sourceType === "static") {
                                    return { ...item, staticValue: e.target.value };
                                  }
                                  if (item.sourceType === "regex") {
                                    return { ...item, regexPattern: e.target.value };
                                  }
                                  return { ...item, sourceKey: e.target.value };
                                }),
                              )
                            }
                          />
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => setOutputColumns((prev) => prev.filter((_, i) => i !== idx))}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>

                      {col.sourceType === "conditional" && (
                        <div className="grid grid-cols-3 gap-2">
                          <div>
                            <Label className="text-[11px]">Left Operand</Label>
                            <Input
                              className="h-8 text-xs"
                              placeholder="columnKey"
                              value={col.condition?.left.value || ""}
                              onChange={(e) =>
                                setOutputColumns((prev) =>
                                  prev.map((item, i) =>
                                    i === idx
                                      ? {
                                          ...item,
                                          condition: {
                                            left: {
                                              type: item.condition?.left.type || "column",
                                              value: e.target.value,
                                            },
                                            operator: item.condition?.operator || "equals",
                                            right: item.condition?.right || { type: "static", value: "" },
                                            thenValue: item.condition?.thenValue || "",
                                            elseValue: item.condition?.elseValue || "",
                                          },
                                        }
                                      : item,
                                  ),
                                )
                              }
                            />
                          </div>
                          <div>
                            <Label className="text-[11px]">Operator</Label>
                            <select
                              className="h-8 w-full rounded border bg-background px-2 text-xs"
                              value={col.condition?.operator || "equals"}
                              onChange={(e) =>
                                setOutputColumns((prev) =>
                                  prev.map((item, i) =>
                                    i === idx
                                      ? {
                                          ...item,
                                          condition: {
                                            left: item.condition?.left || { type: "column", value: "" },
                                            operator: e.target.value as "equals" | "notEquals" | "contains" | "gt" | "lt",
                                            right: item.condition?.right || { type: "static", value: "" },
                                            thenValue: item.condition?.thenValue || "",
                                            elseValue: item.condition?.elseValue || "",
                                          },
                                        }
                                      : item,
                                  ),
                                )
                              }
                            >
                              <option value="equals">equals</option>
                              <option value="notEquals">notEquals</option>
                              <option value="contains">contains</option>
                              <option value="gt">gt</option>
                              <option value="lt">lt</option>
                            </select>
                          </div>
                          <div>
                            <Label className="text-[11px]">Right Operand</Label>
                            <Input
                              className="h-8 text-xs"
                              placeholder="value"
                              value={col.condition?.right.value || ""}
                              onChange={(e) =>
                                setOutputColumns((prev) =>
                                  prev.map((item, i) =>
                                    i === idx
                                      ? {
                                          ...item,
                                          condition: {
                                            left: item.condition?.left || { type: "column", value: "" },
                                            operator: item.condition?.operator || "equals",
                                            right: {
                                              type: item.condition?.right.type || "static",
                                              value: e.target.value,
                                            },
                                            thenValue: item.condition?.thenValue || "",
                                            elseValue: item.condition?.elseValue || "",
                                          },
                                        }
                                      : item,
                                  ),
                                )
                              }
                            />
                          </div>
                          <div>
                            <Label className="text-[11px]">Then</Label>
                            <Input
                              className="h-8 text-xs"
                              value={col.condition?.thenValue || ""}
                              onChange={(e) =>
                                setOutputColumns((prev) =>
                                  prev.map((item, i) =>
                                    i === idx
                                      ? {
                                          ...item,
                                          condition: {
                                            left: item.condition?.left || { type: "column", value: "" },
                                            operator: item.condition?.operator || "equals",
                                            right: item.condition?.right || { type: "static", value: "" },
                                            thenValue: e.target.value,
                                            elseValue: item.condition?.elseValue || "",
                                          },
                                        }
                                      : item,
                                  ),
                                )
                              }
                            />
                          </div>
                          <div>
                            <Label className="text-[11px]">Else</Label>
                            <Input
                              className="h-8 text-xs"
                              value={col.condition?.elseValue || ""}
                              onChange={(e) =>
                                setOutputColumns((prev) =>
                                  prev.map((item, i) =>
                                    i === idx
                                      ? {
                                          ...item,
                                          condition: {
                                            left: item.condition?.left || { type: "column", value: "" },
                                            operator: item.condition?.operator || "equals",
                                            right: item.condition?.right || { type: "static", value: "" },
                                            thenValue: item.condition?.thenValue || "",
                                            elseValue: e.target.value,
                                          },
                                        }
                                      : item,
                                  ),
                                )
                              }
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  ))}

                  <datalist id="manual-column-keys">
                    {sampleColumnKeys.map((key) => (
                      <option key={key} value={key} />
                    ))}
                  </datalist>
                  <datalist id="manual-context-keys">
                    {contextKeys.map((key) => (
                      <option key={key} value={key} />
                    ))}
                  </datalist>
                </div>
              </ScrollArea>
            )}

            {tab === "preview" && (
              <div className="mt-3 flex-1 min-h-0 overflow-auto rounded border">
                {previewRows.length === 0 ? (
                  <p className="p-3 text-xs text-muted-foreground">No preview rows yet. Click Run Preview.</p>
                ) : (
                  <table className="min-w-full text-xs">
                    <thead className="sticky top-0 bg-muted">
                      <tr>
                        {previewColumns.map((col) => (
                          <th key={col} className="text-left px-2 py-1 border-b">{col}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {previewRows.map((row, idx) => (
                        <tr key={idx}>
                          {previewColumns.map((col) => (
                            <td key={col} className="px-2 py-1 border-b align-top">{row[col] || ""}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
