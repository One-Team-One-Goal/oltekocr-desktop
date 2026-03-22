import { useMemo, useState } from "react";
import Lottie from "lottie-react";
import trdntLoading from "@/assets/trdnt_loading.json";
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
} from "@/api/client";
import type { SchemaPresetDraft } from "./SchemaBuilderDialog";
import { Loader2, Plus, Trash2 } from "lucide-react";

interface ManualSchemaBuilderDialogProps {
  open: boolean;
  onClose: () => void;
  submitting?: boolean;
  onSubmit: (preset: SchemaPresetDraft) => Promise<void> | void;
}

type BuilderTab = "tables" | "conditions";

interface TableGroup {
  headers: string[];
  tableIds: string[];
  tables: ManualSchemaBlock[];
  splits?: Array<{
    id: string;
    condition: {
      field: string;
      operator: "equals" | "notEquals" | "contains" | "gt" | "lt";
      value: string;
    };
    rows: Record<string, string>[];
  }>;
}

interface ConditionColumn extends ManualOutputColumn {
  tableGroupIndex: number;
}

function normalizeFieldKey(input: string): string {
  const key = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return key || "column";
}

function groupTablesByHeaders(tableBlocks: ManualSchemaBlock[]): TableGroup[] {
  const headerKey = (headers: string[]) => JSON.stringify(headers.sort());
  const groups = new Map<string, TableGroup>();

  for (const block of tableBlocks) {
    if (block.type !== "table" || !block.headers) continue;
    const key = headerKey(block.headers);
    if (!groups.has(key)) {
      groups.set(key, {
        headers: block.headers,
        tableIds: [],
        tables: [],
      });
    }
    const group = groups.get(key)!;
    group.tableIds.push(block.id);
    group.tables.push(block);
  }

  return Array.from(groups.values());
}

export function ManualSchemaBuilderDialog({
  open,
  onClose,
  submitting = false,
  onSubmit,
}: ManualSchemaBuilderDialogProps) {
  const [tab, setTab] = useState<BuilderTab>("tables");
  const [schemaName, setSchemaName] = useState("Other Manual Schema");
  const [schemaCategory, setSchemaCategory] = useState("OTHER");
  const [sessionId, setSessionId] = useState("");
  const [fileName, setFileName] = useState("");
  const [blocks, setBlocks] = useState<ManualSchemaBlock[]>([]);
  const [tableGroups, setTableGroups] = useState<TableGroup[]>([]);
  const [conditionColumns, setConditionColumns] = useState<ConditionColumn[]>([]);
  const [selectedTableGroupIndex, setSelectedTableGroupIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const hasLoaded = !!sessionId;
  const selectedGroup = tableGroups[selectedTableGroupIndex];

  const sampleColumnKeys = useMemo(() => {
    if (!selectedGroup || selectedGroup.tables.length === 0) return [];
    const firstTable = selectedGroup.tables[0];
    return firstTable.headers || [];
  }, [selectedGroup]);

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
      
      // Group tables by headers
      const groups = groupTablesByHeaders(extracted.blocks || []);
      setTableGroups(groups);
      setSelectedTableGroupIndex(0);
      setTab("tables");
      
      // Initialize condition columns from first table group
      if (groups.length > 0 && groups[0].tables.length > 0) {
        const firstTable = groups[0].tables[0];
        const initCols: ConditionColumn[] = (firstTable.headers || []).map((header) => ({
          name: header,
          sourceType: "column",
          sourceKey: header,
          tableGroupIndex: 0,
        }));
        setConditionColumns(initCols);
      }
    } catch (err: any) {
      const message = String(err?.message || "");
      if (/failed to fetch|networkerror|err_connection_refused/i.test(message)) {
        setError(
          "Cannot reach backend API (localhost:3847). Start the Electron app with npm run dev and keep it running, then try Upload PDF again.",
        );
      } else {
        setError(message || "Failed to extract manual schema blocks");
      }
    } finally {
      setBusy(false);
    }
  };

  const addConditionColumn = () => {
    const colIndex = conditionColumns.length;
    setConditionColumns((prev) => [
      ...prev,
      {
        name: `column_${colIndex + 1}`,
        sourceType: "column",
        sourceKey: "",
        tableGroupIndex: selectedTableGroupIndex,
      },
    ]);
  };

  const splitTableByCondition = (groupIndex: number, field: string, operator: "equals" | "notEquals" | "contains" | "gt" | "lt", value: string) => {
    if (!tableGroups[groupIndex]) return;
    
    const group = tableGroups[groupIndex];
    const splitId = `split_${group.splits?.length || 0}_${Date.now()}`;
    
    const filteredRows: Record<string, string>[] = [];
    for (const table of group.tables) {
      for (const row of table.rows || []) {
        const fieldValue = String(row[field] || "");
        let matches = false;
        
        if (operator === "equals") matches = fieldValue === value;
        else if (operator === "notEquals") matches = fieldValue !== value;
        else if (operator === "contains") matches = fieldValue.includes(value);
        else if (operator === "gt") matches = Number(fieldValue) > Number(value);
        else if (operator === "lt") matches = Number(fieldValue) < Number(value);
        
        if (matches) filteredRows.push(row);
      }
    }

    setTableGroups((prev) => {
      const updated = [...prev];
      if (!updated[groupIndex].splits) updated[groupIndex].splits = [];
      updated[groupIndex].splits!.push({
        id: splitId,
        condition: { field, operator, value },
        rows: filteredRows,
      });
      return updated;
    });
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
      // Save schema with condition-based columns
      const saved = await manualSchemasApi.saveDefinition({
        name: schemaName.trim(),
        category: schemaCategory.trim() || "OTHER",
        outputColumns: conditionColumns,
      });
      await manualSchemasApi.attachSchema(sessionId, saved.id);

      const tabs = [
        {
          name: "Extracted Tables",
          fields: conditionColumns.map((c) => ({
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
            Upload PDF, group tables by column headers, define split conditions, and map columns to create schema.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-[340px_1fr] gap-4 min-h-0 flex-1">
          {/* Left Sidebar: Raw Blocks */}
          <div className="border rounded-md p-3 min-h-0 flex flex-col">
            <div className="flex items-center justify-between gap-2 pb-2 border-b">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Raw Blocks</p>
              <Button size="sm" variant="outline" onClick={pickPdfAndExtract} disabled={busy || submitting}>
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Upload PDF"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mt-2 truncate" title={fileName}>{fileName || "No file loaded"}</p>
            {busy && (
              <div className="flex-1 min-h-0 flex items-center justify-center">
                <div className="w-36 h-36 [filter:brightness(0)_invert(1)]">
                  <Lottie animationData={trdntLoading} loop={true} />
                </div>
              </div>
            )}
            {!busy && (
            <ScrollArea className="mt-2 flex-1 min-h-0 pr-2">
              <div className="space-y-2">
                {blocks.map((b) => (
                  <div key={b.id} className="rounded border px-2 py-1.5 text-xs bg-card hover:bg-accent cursor-pointer">
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
            )}
          </div>

          {/* Right Main Area: Tabs */}
          <div className="border rounded-md p-3 min-h-0 flex flex-col">
            <div className="flex items-center gap-2 pb-2 border-b">
              <Button size="sm" variant={tab === "tables" ? "secondary" : "ghost"} onClick={() => setTab("tables")}>
                Tables ({tableGroups.length})
              </Button>
              <Button size="sm" variant={tab === "conditions" ? "secondary" : "ghost"} onClick={() => setTab("conditions")}>
                Conditions
              </Button>
              <div className="ml-auto flex items-center gap-2">
                <Button size="sm" onClick={saveAndContinue} disabled={!hasLoaded || busy || submitting}>Use Schema</Button>
              </div>
            </div>

            {error && <p className="text-xs text-destructive mt-2">{error}</p>}

            {/* Tables Tab */}
            {tab === "tables" && (
              <ScrollArea className="mt-3 flex-1 min-h-0 pr-2">
                <div className="space-y-2">
                  {/* Table Group Selector */}
                  <div className="space-y-2 pb-3 border-b">
                    <p className="text-xs font-semibold">Table Groups by Headers</p>
                    {tableGroups.length === 0 ? (
                      <p className="text-xs text-muted-foreground">No tables found. Upload a PDF to get started.</p>
                    ) : (
                      tableGroups.map((group, idx) => (
                        <div
                          key={idx}
                          className={`rounded border p-2 cursor-pointer transition ${
                            selectedTableGroupIndex === idx ? "border-primary bg-accent" : "hover:bg-accent"
                          }`}
                          onClick={() => {
                            setSelectedTableGroupIndex(idx);
                            setConditionColumns(
                              group.headers.map((h) => ({
                                name: h,
                                sourceType: "column" as const,
                                sourceKey: h,
                                tableGroupIndex: idx,
                              }))
                            );
                          }}
                        >
                          <p className="text-xs font-medium">Group {idx + 1}: {group.headers.join(" | ")}</p>
                          <p className="text-[10px] text-muted-foreground mt-1">{group.tableIds.length} table(s)</p>
                        </div>
                      ))
                    )}
                  </div>

                  {/* Split Table Section */}
                  {selectedGroup && (
                    <div className="space-y-2 pb-3 border-b">
                      <p className="text-xs font-semibold">Split Tables by Condition</p>
                      <div className="grid grid-cols-[1fr_110px_1fr_auto] gap-2 items-end">
                        <div>
                          <Label className="text-[11px]">Field</Label>
                          <select className="h-8 w-full rounded border bg-background px-2 text-xs" id="split-field">
                            {sampleColumnKeys.map((key) => (
                              <option key={key} value={key}>{key}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <Label className="text-[11px]">Operator</Label>
                          <select className="h-8 w-full rounded border bg-background px-2 text-xs" id="split-op">
                            <option value="equals">equals</option>
                            <option value="notEquals">notEquals</option>
                            <option value="contains">contains</option>
                            <option value="gt">gt</option>
                            <option value="lt">lt</option>
                          </select>
                        </div>
                        <div>
                          <Label className="text-[11px]">Value</Label>
                          <Input className="h-8 text-xs" id="split-value" placeholder="value" />
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            const field = (document.getElementById("split-field") as HTMLSelectElement)?.value;
                            const op = (document.getElementById("split-op") as HTMLSelectElement)?.value as "equals" | "notEquals" | "contains" | "gt" | "lt";
                            const value = (document.getElementById("split-value") as HTMLInputElement)?.value;
                            if (field && op && value) {
                              splitTableByCondition(selectedTableGroupIndex, field, op, value);
                              (document.getElementById("split-value") as HTMLInputElement).value = "";
                            }
                          }}
                        >
                          Split
                        </Button>
                      </div>

                      {/* Show splits if any */}
                      {selectedGroup.splits && selectedGroup.splits.length > 0 && (
                        <div className="space-y-1 mt-2">
                          {selectedGroup.splits.map((split, idx) => (
                            <div key={split.id} className="rounded bg-muted p-1.5 text-xs">
                              <p className="font-medium">
                                Split {idx + 1}: {split.condition.field} {split.condition.operator} "{split.condition.value}"
                              </p>
                              <p className="text-[10px] text-muted-foreground">{split.rows.length} matching rows</p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Preview tables in group */}
                  {selectedGroup && (
                    <div className="space-y-2">
                      <p className="text-xs font-semibold">Tables in Group</p>
                      {selectedGroup.tables.map((table, idx) => (
                        <div key={table.id} className="rounded border p-2 bg-card">
                          <p className="text-xs font-medium mb-1">Table {idx + 1} (Page {table.page})</p>
                          <div className="max-h-40 overflow-auto text-xs border rounded">
                            <table className="w-full">
                              <thead className="sticky top-0 bg-muted">
                                <tr>
                                  {(table.headers || []).map((h) => (
                                    <th key={h} className="text-left px-1 py-0.5 text-[10px] border-b">{h}</th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {(table.rows || []).slice(0, 3).map((row, ridx) => (
                                  <tr key={ridx}>
                                    {(table.headers || []).map((h) => (
                                      <td key={h} className="px-1 py-0.5 text-[10px] border-b">{row[h] || ""}</td>
                                    ))}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                          {(table.rows?.length ?? 0) > 3 && (
                            <p className="text-[10px] text-muted-foreground mt-1">...and {(table.rows?.length ?? 0) - 3} more rows</p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </ScrollArea>
            )}

            {/* Conditions Tab */}
            {tab === "conditions" && (
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

                  <Button size="sm" variant="outline" onClick={addConditionColumn} disabled={!hasLoaded}>
                    <Plus className="h-3.5 w-3.5 mr-1" /> Add Column
                  </Button>

                  {conditionColumns.map((col, idx) => (
                    <div key={idx} className="rounded border p-2 space-y-2 bg-card">
                      <div className="grid grid-cols-[1fr_130px_1fr_auto] gap-2 items-end">
                        <div>
                          <Label className="text-[11px]">Output Name</Label>
                          <Input
                            className="h-8 text-xs"
                            value={col.name}
                            onChange={(e) =>
                              setConditionColumns((prev) =>
                                prev.map((item, i) => (i === idx ? { ...item, name: e.target.value } : item))
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
                              setConditionColumns((prev) =>
                                prev.map((item, i) =>
                                  i === idx
                                    ? {
                                        ...item,
                                        sourceType: e.target.value as ManualOutputColumn["sourceType"],
                                      }
                                    : item,
                                )
                              )
                            }
                          >
                            <option value="column">column</option>
                            <option value="static">static</option>
                            <option value="regex">regex</option>
                            <option value="conditional">conditional</option>
                          </select>
                        </div>
                        <div>
                          <Label className="text-[11px]">Source Key / Value</Label>
                          <Input
                            className="h-8 text-xs"
                            list={col.sourceType === "column" ? "manual-column-keys" : undefined}
                            value={
                              col.sourceType === "static"
                                ? col.staticValue || ""
                                : col.sourceType === "regex"
                                  ? col.regexPattern || ""
                                  : col.sourceKey || ""
                            }
                            onChange={(e) =>
                              setConditionColumns((prev) =>
                                prev.map((item, i) => {
                                  if (i !== idx) return item;
                                  if (item.sourceType === "static") {
                                    return { ...item, staticValue: e.target.value };
                                  }
                                  if (item.sourceType === "regex") {
                                    return { ...item, regexPattern: e.target.value };
                                  }
                                  return { ...item, sourceKey: e.target.value };
                                })
                              )
                            }
                          />
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => setConditionColumns((prev) => prev.filter((_, i) => i !== idx))}
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
                                setConditionColumns((prev) =>
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
                                  )
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
                                setConditionColumns((prev) =>
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
                                  )
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
                                setConditionColumns((prev) =>
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
                                  )
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
                                setConditionColumns((prev) =>
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
                                  )
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
                                setConditionColumns((prev) =>
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
                                  )
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
                </div>
              </ScrollArea>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
