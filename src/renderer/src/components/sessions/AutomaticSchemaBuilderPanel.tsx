import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AlertCircle, Loader2, Check, Zap } from "lucide-react";
import {
  AutoSchemaSectionNode,
  autoSchemasApi,
  ocrApi,
  sessionsApi,
  SchemaPresetPayload,
} from "@/api/client";

interface AutomaticSchemaBuilderPanelProps {
  onClose: () => void;
  onComplete: (preset: SchemaPresetPayload) => Promise<void> | void;
  submitting?: boolean;
}

type AutomaticBuilderStep =
  | "upload"
  | "building"
  | "sections"
  | "review"
  | "complete";

type AutoBuildStatus = "idle" | "running" | "done" | "error";

type AutoBuildSnapshot = {
  status: AutoBuildStatus;
  buildLog: string;
  builtSchema: any | null;
  sections: AutoSchemaSectionNode[];
  llmJsonOutput: Record<string, unknown> | null;
  error: string | null;
  processedDocumentId: string;
  fileName: string;
  autoSchemaId: string;
};

type AutoExtractionTask = {
  id: string;
  sectionLabel: string;
  objective: string;
  fieldCount: number;
};

type LlmReceivedContextItem = {
  id: string;
  sectionLabel: string;
  strategy: string;
  pages: number[];
  lines: number[];
  fullTextChars: number;
  contextText: string;
  contextTextTruncated: boolean;
};

const initialAutoBuildSnapshot: AutoBuildSnapshot = {
  status: "idle",
  buildLog: "",
  builtSchema: null,
  sections: [],
  llmJsonOutput: null,
  error: null,
  processedDocumentId: "",
  fileName: "",
  autoSchemaId: "",
};

let autoBuildSnapshot: AutoBuildSnapshot = { ...initialAutoBuildSnapshot };
const autoBuildSubscribers = new Set<(snapshot: AutoBuildSnapshot) => void>();

const emitAutoBuildSnapshot = () => {
  for (const notify of autoBuildSubscribers) {
    notify(autoBuildSnapshot);
  }
};

const patchAutoBuildSnapshot = (patch: Partial<AutoBuildSnapshot>) => {
  autoBuildSnapshot = { ...autoBuildSnapshot, ...patch };
  emitAutoBuildSnapshot();
};

const appendAutoBuildLog = (line: string) => {
  autoBuildSnapshot = {
    ...autoBuildSnapshot,
    buildLog: autoBuildSnapshot.buildLog + line,
  };
  emitAutoBuildSnapshot();
};

const subscribeAutoBuild = (notify: (snapshot: AutoBuildSnapshot) => void) => {
  autoBuildSubscribers.add(notify);
  notify(autoBuildSnapshot);
  return () => {
    autoBuildSubscribers.delete(notify);
  };
};

const flattenSectionNodes = (
  nodes: AutoSchemaSectionNode[],
): AutoSchemaSectionNode[] => {
  const out: AutoSchemaSectionNode[] = [];
  const visit = (nodeList: AutoSchemaSectionNode[]) => {
    for (const node of nodeList) {
      out.push(node);
      if (node.children?.length) {
        visit(node.children);
      }
    }
  };
  visit(nodes);
  return out;
};

const toFieldKey = (label: string) => {
  const sanitized = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return sanitized || "field";
};

const inferTabsFromOcr = (ocrResult: any) => {
  const tables = Array.isArray(ocrResult?.tables) ? ocrResult.tables : [];
  if (tables.length === 0) {
    return [];
  }

  const isNumericLike = (value: string) =>
    /^-?\d{1,4}(?:[.,]\d{1,4})?$/.test(value.trim());

  const normalizeLabel = (raw: string, fallback: string) => {
    const label = raw.replace(/\s+/g, " ").replace(/[|]/g, " ").trim();
    return label || fallback;
  };

  const detectDataType = (samples: string[]) => {
    const trimmed = samples.map((s) => s.trim()).filter((s) => !!s);
    if (trimmed.length === 0) return "string";
    const numeric = trimmed.filter((s) => isNumericLike(s)).length;
    const currency = trimmed.filter((s) =>
      /^(USD|EUR|JPY|PHP|CAD)$/i.test(s),
    ).length;
    if (currency / trimmed.length >= 0.6) return "string";
    if (numeric / trimmed.length >= 0.75) return "number";
    return "string";
  };

  const buildGrid = (table: any) => {
    const rows = Number(table?.rows || 0);
    const cols = Number(table?.cols || 0);
    if (!rows || !cols) return [] as string[][];
    const grid: string[][] = Array.from({ length: rows }, () =>
      Array.from({ length: cols }, () => ""),
    );
    for (const cell of Array.isArray(table?.cells) ? table.cells : []) {
      const r = Number(cell?.row ?? -1);
      const c = Number(cell?.col ?? -1);
      if (r >= 0 && r < rows && c >= 0 && c < cols) {
        grid[r][c] = String(cell?.text || "").trim();
      }
    }
    return grid;
  };

  return tables
    .map((table: any, tableIdx: number) => {
      const grid = buildGrid(table);
      if (grid.length === 0) {
        return {
          name: `Table ${tableIdx + 1}`,
          fields: [],
        };
      }

      const colCount = grid[0]?.length || 0;
      const rowScores = grid.map((row: string[]) => {
        const nonEmpty = row.filter((c) => !!c.trim()).length;
        const numeric = row.filter((c) => isNumericLike(c)).length;
        const alpha = row.filter((c) => /[A-Za-z]/.test(c)).length;
        return nonEmpty + alpha * 0.8 - numeric * 0.6;
      });

      let headerRow = 0;
      let bestScore = -9999;
      for (let i = 0; i < Math.min(grid.length, 4); i++) {
        if (rowScores[i] > bestScore) {
          bestScore = rowScores[i];
          headerRow = i;
        }
      }

      const useTwoRowHeader =
        headerRow + 1 < grid.length &&
        grid[headerRow + 1].filter((c) => !!c.trim()).length > 0 &&
        grid[headerRow + 1].filter((c) => isNumericLike(c)).length <
          Math.ceil(colCount * 0.25);

      const headerDepth = useTwoRowHeader ? 2 : 1;
      const dataStart = Math.min(grid.length, headerRow + headerDepth);

      const labels = Array.from({ length: colCount }, (_, colIdx) => {
        const top = String(grid[headerRow]?.[colIdx] || "");
        const bottom = useTwoRowHeader
          ? String(grid[headerRow + 1]?.[colIdx] || "")
          : "";
        const merged = normalizeLabel(
          [top, bottom].filter((v) => !!v.trim()).join(" "),
          `Column ${colIdx + 1}`,
        );
        return merged;
      });

      const fields = labels.map((label, colIdx) => {
        const samples = grid
          .slice(dataStart, Math.min(grid.length, dataStart + 8))
          .map((row) => String(row[colIdx] || ""));
        const dataType = detectDataType(samples);
        return {
          id: `${table?.tableId || tableIdx}_col_${colIdx}`,
          label,
          fieldKey: toFieldKey(label),
          dataType,
          extractionStrategy: "table_column",
        };
      });

      return {
        name: `Table ${tableIdx + 1}`,
        fields,
      };
    })
    .filter((tab: any) => Array.isArray(tab.fields) && tab.fields.length > 0);
};

const startAutoBuildJob = async (params: {
  uploadedFile: File;
  schemaName: string;
}) => {
  if (autoBuildSnapshot.status === "running") {
    return;
  }

  const { uploadedFile, schemaName } = params;
  const filePath = (uploadedFile as any)?.path;
  if (!filePath) {
    throw new Error("Unable to read local file path from upload.");
  }

  patchAutoBuildSnapshot({
    status: "running",
    buildLog: "Starting automatic schema extraction...\n",
    builtSchema: null,
    sections: [],
    llmJsonOutput: null,
    error: null,
    processedDocumentId: "",
    fileName: uploadedFile.name,
    autoSchemaId: "",
  });

  try {
    appendAutoBuildLog("Creating temporary auto-schema session...\n");
    const tempSession = await sessionsApi.create({
      name: `Auto Schema ${new Date().toISOString()}`,
      mode: "OCR_EXTRACT",
      sourceType: "FILES",
    });

    await sessionsApi.updateExtractionModel(tempSession.id, "pdfplumber");

    appendAutoBuildLog("Loading file into existing session endpoint...\n");
    const loadedDocs = await sessionsApi.ingestFiles(tempSession.id, [
      filePath,
    ]);
    const firstDoc = Array.isArray(loadedDocs) ? loadedDocs[0] : null;
    if (!firstDoc?.id) {
      throw new Error("Failed to create document for OCR processing.");
    }

    appendAutoBuildLog(
      "Processing via existing /ocr/process endpoint (pdfplumber, no LLM)...\n",
    );
    const ocrResult = await ocrApi.process(firstDoc.id);

    const scanModel = (ocrResult as any)?.processingMeta?.scanModel;
    if (scanModel && scanModel !== "pdfplumber") {
      appendAutoBuildLog(
        `Warning: scanModel was '${scanModel}', expected 'pdfplumber'.\n`,
      );
    }

    appendAutoBuildLog("Saving auto-schema JSON to database...\n");
    const savedAutoSchema = await autoSchemasApi.create({
      name: schemaName,
      documentId: firstDoc.id,
      uploadedFileName: uploadedFile.name,
      rawJson: ocrResult as Record<string, unknown>,
    });

    appendAutoBuildLog("Detecting major document sections...\n");
    const sectionResult = await autoSchemasApi.detectSections(
      savedAutoSchema.id,
      {
        minConfidence: 0.55,
        maxNodes: 150,
      },
    );
    const sectionCount = flattenSectionNodes(sectionResult.sections).length;
    appendAutoBuildLog(
      `Section outline complete. Found ${sectionCount} section candidate(s).\n`,
    );

    const built = {
      id: firstDoc.id,
      autoSchemaId: savedAutoSchema.id,
      name: schemaName,
      rawDocument: ocrResult,
      sectionOutline: sectionResult.sections,
      processingLog: Array.isArray(ocrResult?.warnings)
        ? ocrResult.warnings
        : [],
    };

    patchAutoBuildSnapshot({
      status: "done",
      builtSchema: built,
      sections: sectionResult.sections,
      llmJsonOutput: null,
      processedDocumentId: firstDoc.id,
      autoSchemaId: savedAutoSchema.id,
      error: null,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to build schema";
    appendAutoBuildLog(`\nError: ${message}`);
    patchAutoBuildSnapshot({
      status: "error",
      error: message,
    });
  }
};

export function AutomaticSchemaBuilderPanel({
  onClose,
  onComplete,
  submitting = false,
}: AutomaticSchemaBuilderPanelProps) {
  const [activeDataTab, setActiveDataTab] = useState<"source" | "llm">(
    "source",
  );
  const [step, setStep] = useState<AutomaticBuilderStep>("upload");
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [schemaName, setSchemaName] = useState("");
  const [selectedFieldIds, setSelectedFieldIds] = useState<Set<string>>(
    new Set(),
  );
  const [selectedSectionIds, setSelectedSectionIds] = useState<Set<string>>(
    new Set(),
  );
  const [sectionOutline, setSectionOutline] = useState<AutoSchemaSectionNode[]>(
    [],
  );

  const [building, setBuilding] = useState(false);
  const [builtSchema, setBuiltSchema] = useState<any>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [buildLog, setBuildLog] = useState<string>("");
  const [processedDocumentId, setProcessedDocumentId] = useState<string>("");
  const [activeFileName, setActiveFileName] = useState<string>("");
  const [llmJsonOutput, setLlmJsonOutput] = useState<Record<
    string,
    unknown
  > | null>(null);
  const [llmError, setLlmError] = useState<string | null>(null);
  const [extractionTasks, setExtractionTasks] = useState<AutoExtractionTask[]>(
    [],
  );
  const [llmReceivedContexts, setLlmReceivedContexts] = useState<
    LlmReceivedContextItem[]
  >([]);
  const initializedAutoSchemaIdRef = useRef<string>("");

  useEffect(() => {
    return subscribeAutoBuild((snapshot) => {
      setBuildLog(snapshot.buildLog);
      setProcessedDocumentId(snapshot.processedDocumentId);
      setActiveFileName(snapshot.fileName);
      setLlmJsonOutput(snapshot.llmJsonOutput);
      setSectionOutline(snapshot.sections || []);

      if (snapshot.status === "running") {
        setBuilding(true);
        setErrors([]);
        setStep("building");
        return;
      }

      if (snapshot.status === "done" && snapshot.builtSchema) {
        const incomingAutoSchemaId = String(
          snapshot.builtSchema?.autoSchemaId ||
            snapshot.autoSchemaId ||
            snapshot.processedDocumentId ||
            "",
        );

        // Only initialize section selections once per newly built auto-schema.
        // This prevents "Continue" from reselecting everything while logs stream.
        if (
          incomingAutoSchemaId &&
          initializedAutoSchemaIdRef.current !== incomingAutoSchemaId
        ) {
          initializedAutoSchemaIdRef.current = incomingAutoSchemaId;
          setBuilding(false);
          setBuiltSchema(snapshot.builtSchema);
          setSelectedSectionIds(new Set());
          setSelectedFieldIds(new Set());
          setExtractionTasks([]);
          setLlmReceivedContexts([]);
          setLlmError(null);
          setErrors([]);
          setStep("sections");
        }
        return;
      }

      if (snapshot.status === "error") {
        setBuilding(false);
        setLlmJsonOutput(null);
        setErrors(
          snapshot.error ? [snapshot.error] : ["Failed to build schema"],
        );
        setStep("upload");
      }
    });
  }, []);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setUploadedFile(file);
      setActiveFileName(file.name);
      setErrors([]);
    }
  };

  const handleBuildFromSample = async () => {
    if (!schemaName.trim()) {
      setErrors(["Schema name is required."]);
      return;
    }

    try {
      if (!uploadedFile) {
        setErrors(["Please upload a PDF file to process."]);
        return;
      }
      setActiveDataTab("source");
      setLlmJsonOutput(null);
      setLlmError(null);
      setExtractionTasks([]);
      setLlmReceivedContexts([]);
      setErrors([]);
      await startAutoBuildJob({
        uploadedFile,
        schemaName: schemaName.trim(),
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to build schema";
      setErrors([message]);
      setStep("upload");
    }
  };

  const collectSelectedSectionTitles = (
    nodes: AutoSchemaSectionNode[],
    selected: Set<string>,
  ): string[] => {
    const titles: string[] = [];
    const walk = (items: AutoSchemaSectionNode[]) => {
      for (const item of items) {
        if (selected.has(item.id)) {
          titles.push(item.token ? `${item.token} ${item.title}` : item.title);
        }
        if (item.children?.length) walk(item.children);
      }
    };
    walk(nodes);
    return [...new Set(titles)];
  };

  const handleGenerateFromSections = async () => {
    if (!builtSchema?.autoSchemaId) {
      setErrors(["Missing auto-schema record. Please process again."]);
      return;
    }

    let hasReceivedAnyContext = false;

    setBuilding(true);
    setErrors([]);
    setStep("building");

    try {
      const selectedNodes = flattenSectionNodes(sectionOutline).filter((node) =>
        selectedSectionIds.has(node.id),
      );

      appendAutoBuildLog(
        `Parser mode: inferring columns from OCR tables for ${selectedNodes.length || 0} selected section(s).\n`,
      );

      const parserTabs = inferTabsFromOcr(builtSchema.rawDocument || {});
      if (parserTabs.length === 0) {
        throw new Error(
          "Parser could not detect columns from extracted tables.",
        );
      }

      const nextBuiltSchema = {
        ...builtSchema,
        normalizedSchema: {
          extractionMode: "AUTO",
          recordStartRegex: "",
          tabs: parserTabs,
          summary: {
            tasks: [],
            sections: selectedNodes.map((node) => ({
              id: node.id,
              label: node.token ? `${node.token} ${node.title}` : node.title,
              fields: [],
            })),
            tables: parserTabs.map((tab: any, idx: number) => ({
              id: `table_${idx + 1}`,
              label: tab.name,
              columnCount: Array.isArray(tab.fields) ? tab.fields.length : 0,
            })),
          },
          warnings: ["Parser mode enabled (LLM disabled for schema build)."],
        },
      };

      const fieldIds = nextBuiltSchema.normalizedSchema.tabs
        .flatMap((tab: any) => tab.fields?.map((f: any) => f.id) || [])
        .filter((id: string | undefined): id is string => !!id);

      setBuiltSchema(nextBuiltSchema);
      setSelectedFieldIds(new Set(fieldIds));
      setExtractionTasks([]);
      setLlmReceivedContexts([]);
      setLlmJsonOutput({ parserMode: true, tabsDetected: parserTabs.length });
      appendAutoBuildLog(
        `Parser mode complete. Detected ${fieldIds.length} column field(s) across ${parserTabs.length} table(s).\n`,
      );
      setStep("review");
      return;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to generate schema";
      appendAutoBuildLog(`Section draft generation error: ${message}\n`);
      setErrors([message]);
      if (!hasReceivedAnyContext) {
        appendAutoBuildLog(
          "No focus context was returned by backend. Restart Electron main process and retry to ensure latest backend code is running.\n",
        );
      }
      setStep("sections");
    } finally {
      setBuilding(false);
    }
  };

  const handleBuildPreset = async () => {
    if (!builtSchema) {
      setErrors(["No schema to build from."]);
      return;
    }

    const selected = new Set(selectedFieldIds);
    const selectedFields = (builtSchema.normalizedSchema?.tabs || [])
      .flatMap((tab: any) => tab.fields || [])
      .filter((field: any) => selected.has(field.id));

    const missingRegexFields = selectedFields.filter((field: any) => {
      const strategy = String(field.extractionStrategy || "table_column");
      const regexRule = String(field.regexRule || "").trim();
      return strategy === "regex" && regexRule.length === 0;
    });

    if (missingRegexFields.length > 0) {
      setErrors([
        `Cannot create schema: ${missingRegexFields.length} selected regex field(s) are missing regex rules. Update AI selection and retry.`,
      ]);
      setStep("review");
      return;
    }

    const presetName =
      (
        builtSchema.normalizedSchema?.summary?.name ||
        builtSchema.name ||
        schemaName
      ).trim() || "Untitled Preset";

    setBuilding(true);
    setErrors([]);
    setStep("building");

    try {
      const resolvedExtractionMode =
        builtSchema.normalizedSchema?.extractionMode || "AUTO";
      const preset: SchemaPresetPayload = {
        id: `auto_${processedDocumentId || Date.now()}`,
        name: presetName,
        extractionMode: resolvedExtractionMode,
        recordStartRegex: builtSchema.normalizedSchema?.recordStartRegex,
        tabs: (builtSchema.normalizedSchema?.tabs || []).map((tab: any) => ({
          name: tab.name,
          fields: (tab.fields || [])
            .filter((field: any) => selected.has(field.id))
            .map((field: any) => ({
              label: field.label,
              fieldKey: field.fieldKey,
              regexRule: field.regexRule || "",
              extractionStrategy: field.extractionStrategy || "table_column",
              dataType: field.dataType || "string",
              sectionHint: field.sectionHint,
              contextHint: field.contextHint,
              contextLabel: field.contextLabel,
              mandatory: field.mandatory,
              postProcessing: field.postProcessing,
            })),
        })),
      };

      await onComplete(preset);
      setStep("complete");
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to build preset";
      setErrors([message]);
      setStep("review");
    } finally {
      setBuilding(false);
    }
  };

  const handleSelectField = (fieldId: string, selected: boolean) => {
    setSelectedFieldIds((prev) => {
      const next = new Set(prev);
      if (selected) {
        next.add(fieldId);
      } else {
        next.delete(fieldId);
      }
      return next;
    });
  };

  const allFieldIds =
    builtSchema?.normalizedSchema?.tabs
      ?.flatMap((tab: any) => tab.fields?.map((f: any) => f.id) || [])
      .filter((id: string | undefined): id is string => !!id) || [];

  const handleSelectAllFields = () => {
    if (
      selectedFieldIds.size === allFieldIds.length &&
      allFieldIds.length > 0
    ) {
      setSelectedFieldIds(new Set());
    } else {
      setSelectedFieldIds(new Set(allFieldIds));
    }
  };

  const handleSelectAllSections = () => {
    const allIds = flattenSectionNodes(sectionOutline).map((node) => node.id);
    if (selectedSectionIds.size === allIds.length && allIds.length > 0) {
      setSelectedSectionIds(new Set());
      return;
    }
    setSelectedSectionIds(new Set(allIds));
  };

  const handleSelectSection = (sectionId: string, selected: boolean) => {
    setSelectedSectionIds((prev) => {
      const next = new Set(prev);
      if (selected) next.add(sectionId);
      else next.delete(sectionId);
      return next;
    });
  };

  const renderSectionTree = (nodes: AutoSchemaSectionNode[], depth = 0) => {
    return nodes.map((node) => (
      <div key={node.id} className="space-y-1">
        <label
          className="flex items-center gap-2 text-xs cursor-pointer hover:bg-background p-1 rounded"
          style={{ paddingLeft: `${depth * 14 + 4}px` }}
        >
          <input
            type="checkbox"
            className="h-3 w-3"
            checked={selectedSectionIds.has(node.id)}
            onChange={(e) => handleSelectSection(node.id, e.target.checked)}
          />
          <span className="font-medium">
            {node.token ? `${node.token} ` : ""}
            {node.title}
          </span>
          <span className="text-[10px] text-muted-foreground">
            ({Math.round(node.confidence * 100)}%)
          </span>
          {Array.isArray(node.windowPages) && node.windowPages.length > 0 ? (
            <span className="text-[10px] text-muted-foreground">
              pages {node.windowPages.join("-")}
            </span>
          ) : null}
        </label>
        {node.children?.length > 0
          ? renderSectionTree(node.children, depth + 1)
          : null}
      </div>
    ));
  };

  return (
    <div className="flex flex-col h-full gap-0">
      {/* Two-column layout */}
      <div className="flex flex-1 overflow-hidden gap-0">
        {/* Left Column: Extracted Data Preview */}
        <div className="flex-1 border-r bg-muted/20 flex flex-col overflow-hidden">
          <div className="border-b px-4 py-3 flex-shrink-0">
            <h3 className="font-semibold text-sm">Extracted PDF Data</h3>
            <p className="text-xs text-muted-foreground mt-1">
              {step === "upload"
                ? "Upload a PDF to see extracted content"
                : `Extracted from: ${activeFileName || uploadedFile?.name || "unknown"}`}
            </p>
            <div className="mt-3 flex items-center gap-1">
              <button
                type="button"
                onClick={() => setActiveDataTab("source")}
                className={`px-2.5 py-1 text-xs rounded border transition-colors ${
                  activeDataTab === "source"
                    ? "bg-background border-foreground text-foreground"
                    : "bg-transparent border-border text-muted-foreground hover:text-foreground"
                }`}
              >
                Extracted JSON
              </button>
              <button
                type="button"
                onClick={() => setActiveDataTab("llm")}
                className={`px-2.5 py-1 text-xs rounded border transition-colors ${
                  activeDataTab === "llm"
                    ? "bg-background border-foreground text-foreground"
                    : "bg-transparent border-border text-muted-foreground hover:text-foreground"
                }`}
              >
                LLM JSON
              </button>
            </div>
          </div>

          <ScrollArea className="flex-1">
            {activeDataTab === "source" ? (
              builtSchema?.rawDocument ? (
                <div className="p-4">
                  <pre className="text-xs font-mono bg-background rounded border p-3 overflow-auto whitespace-pre-wrap break-words max-h-96">
                    {JSON.stringify(builtSchema.rawDocument, null, 2)}
                  </pre>
                </div>
              ) : (
                <div className="p-4 text-center text-muted-foreground">
                  <p className="text-xs">No data extracted yet</p>
                  <p className="text-xs mt-2 opacity-60">
                    Upload a PDF to view extracted content
                  </p>
                </div>
              )
            ) : llmJsonOutput ? (
              <div className="p-4">
                <pre className="text-xs font-mono bg-background rounded border p-3 overflow-auto whitespace-pre-wrap break-words max-h-96">
                  {JSON.stringify(llmJsonOutput, null, 2)}
                </pre>
              </div>
            ) : (
              <div className="p-4 text-center text-muted-foreground">
                <p className="text-xs">No LLM JSON output yet</p>
                <p className="text-xs mt-2 opacity-60">
                  Run Process PDF to generate LLM output automatically.
                </p>
                {llmError && (
                  <p className="text-xs mt-2 text-destructive">{llmError}</p>
                )}
              </div>
            )}
          </ScrollArea>
        </div>

        {/* Right Column: Upload & Configuration */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <>
            <ScrollArea className="flex-1">
              <div className="space-y-4 p-4">
                {/* Step: Upload & Build */}
                {step === "upload" && (
                  <>
                    <div>
                      <Label htmlFor="pdf-upload">Upload PDF Document</Label>
                      <p className="text-xs text-muted-foreground mb-2">
                        Select a sample PDF to extract structure and fields.
                      </p>
                      <input
                        id="pdf-upload"
                        type="file"
                        accept=".pdf"
                        onChange={handleFileUpload}
                        className="w-full text-sm file:mr-4 file:py-2 file:px-3 file:rounded file:border-0 file:text-sm file:font-semibold file:bg-slate-200 file:text-slate-700 hover:file:bg-slate-300 file:cursor-pointer"
                      />
                      {uploadedFile && (
                        <p className="text-xs text-green-600 mt-1">
                          ✓ Selected: {uploadedFile.name}
                        </p>
                      )}
                    </div>

                    <div>
                      <Label>Schema Name</Label>
                      <p className="text-xs text-muted-foreground mb-2">
                        Name for this automatically generated schema.
                      </p>
                      <Input
                        value={schemaName}
                        onChange={(e) => setSchemaName(e.target.value)}
                        placeholder="Auto-Generated Contracts"
                      />
                    </div>
                  </>
                )}

                {/* Step: Building */}
                {step === "building" && (
                  <div className="flex flex-col items-center justify-center space-y-3 py-8">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                    <p className="text-sm font-medium">Building schema...</p>
                    <div className="w-full border rounded-md bg-muted/30 p-2 max-h-40 overflow-auto">
                      <pre className="text-xs font-mono whitespace-pre-wrap break-words">
                        {buildLog}
                      </pre>
                    </div>
                  </div>
                )}

                {/* Step: Review */}
                {step === "review" && builtSchema && (
                  <>
                    <div>
                      <h3 className="font-medium mb-2 text-sm">
                        Schema Summary
                      </h3>
                      <div className="space-y-2 text-xs bg-muted/40 rounded-md p-3">
                        <div>
                          <span className="font-medium">Name:</span>{" "}
                          {builtSchema.name}
                        </div>
                        {builtSchema.normalizedSchema?.summary?.sections && (
                          <div>
                            <span className="font-medium">Sections:</span>{" "}
                            {
                              builtSchema.normalizedSchema.summary.sections
                                .length
                            }
                          </div>
                        )}
                        {builtSchema.normalizedSchema?.summary?.tables && (
                          <div>
                            <span className="font-medium">Tables:</span>{" "}
                            {builtSchema.normalizedSchema.summary.tables.length}
                          </div>
                        )}
                        {extractionTasks.length > 0 && (
                          <div>
                            <span className="font-medium">AI Tasks:</span>{" "}
                            {extractionTasks.length}
                          </div>
                        )}
                      </div>
                    </div>

                    {extractionTasks.length > 0 && (
                      <div>
                        <h3 className="font-medium mb-2 text-sm">
                          AI Extraction Tasks
                        </h3>
                        <div className="space-y-2 max-h-44 overflow-auto border rounded-md p-2 bg-background">
                          {extractionTasks.map((task) => (
                            <div
                              key={task.id}
                              className="rounded-md border p-2 bg-muted/20 text-xs"
                            >
                              <div className="font-medium">
                                {task.sectionLabel}
                              </div>
                              <div className="text-muted-foreground mt-0.5">
                                {task.objective ||
                                  "Extract key fields from this section."}
                              </div>
                              <div className="text-[11px] text-muted-foreground mt-1">
                                Fields planned: {task.fieldCount}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    <div>
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <Label className="text-sm">Fields to Include</Label>
                        <button
                          type="button"
                          onClick={handleSelectAllFields}
                          className="text-xs text-blue-600 hover:underline"
                        >
                          {selectedFieldIds.size === allFieldIds.length &&
                          allFieldIds.length > 0
                            ? "Deselect All"
                            : "Select All"}
                        </button>
                      </div>

                      {builtSchema.normalizedSchema?.tabs?.length > 0 ? (
                        <div className="space-y-2 max-h-64 overflow-auto border rounded-md p-2 bg-background">
                          {builtSchema.normalizedSchema.tabs.map(
                            (tab: any, tabIdx: number) => (
                              <div
                                key={tabIdx}
                                className="rounded-md border p-2 bg-muted/20"
                              >
                                <h4 className="text-xs font-medium mb-1.5">
                                  {tab.name}
                                </h4>
                                <div className="space-y-1 ml-1">
                                  {tab.fields?.map((field: any) => (
                                    <label
                                      key={field.id}
                                      className="flex items-center gap-2 text-xs cursor-pointer hover:bg-background p-1 rounded"
                                    >
                                      <input
                                        type="checkbox"
                                        checked={selectedFieldIds.has(field.id)}
                                        onChange={(e) =>
                                          handleSelectField(
                                            field.id,
                                            e.target.checked,
                                          )
                                        }
                                        className="h-3 w-3"
                                      />
                                      <span>
                                        {field.label}{" "}
                                        <span className="text-muted-foreground">
                                          ({field.dataType || "string"})
                                        </span>
                                      </span>
                                    </label>
                                  ))}
                                </div>
                              </div>
                            ),
                          )}
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground italic border rounded-md p-2 bg-muted/20">
                          No fields detected in schema.
                        </p>
                      )}
                    </div>

                    {builtSchema.normalizedSchema?.warnings?.length > 0 && (
                      <div className="rounded-md border border-orange-200 bg-orange-50 p-2.5">
                        <div className="flex items-start gap-2">
                          <AlertCircle className="h-3.5 w-3.5 text-orange-600 mt-0.5 flex-shrink-0" />
                          <div className="text-xs text-orange-900">
                            <p className="font-medium mb-0.5">Warnings:</p>
                            <ul className="list-disc list-inside space-y-0.5">
                              {builtSchema.normalizedSchema.warnings.map(
                                (warning: string, idx: number) => (
                                  <li key={idx}>{warning}</li>
                                ),
                              )}
                            </ul>
                          </div>
                        </div>
                      </div>
                    )}
                  </>
                )}

                {/* Step: Sections */}
                {step === "sections" && builtSchema && (
                  <>
                    <div>
                      <h3 className="font-medium mb-2 text-sm">
                        Section Outline
                      </h3>
                      <div className="space-y-2 text-xs bg-muted/40 rounded-md p-3">
                        <div>
                          <span className="font-medium">Name:</span>{" "}
                          {builtSchema.name}
                        </div>
                        <div>
                          <span className="font-medium">
                            Detected Sections:
                          </span>{" "}
                          {flattenSectionNodes(sectionOutline).length}
                        </div>
                      </div>
                    </div>

                    <div>
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <Label className="text-sm">Sections to Automate</Label>
                        <button
                          type="button"
                          onClick={handleSelectAllSections}
                          className="text-xs text-blue-600 hover:underline"
                        >
                          {(() => {
                            const all =
                              flattenSectionNodes(sectionOutline).length;
                            return all > 0 && selectedSectionIds.size === all
                              ? "Deselect All"
                              : "Select All";
                          })()}
                        </button>
                      </div>

                      {sectionOutline.length > 0 ? (
                        <div className="space-y-1 h-full overflow-auto border rounded-md p-2 bg-background">
                          {renderSectionTree(sectionOutline)}
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground italic border rounded-md p-2 bg-muted/20">
                          No section candidates detected. You can still continue
                          and let the LLM infer structure.
                        </p>
                      )}
                    </div>

                    {buildLog.trim().length > 0 && (
                      <div>
                        <Label className="text-sm">Recent Build Log</Label>
                        <div className="mt-2 w-full border rounded-md bg-muted/30 p-2 max-h-40 overflow-auto">
                          <pre className="text-xs font-mono whitespace-pre-wrap break-words">
                            {buildLog}
                          </pre>
                        </div>
                      </div>
                    )}

                    {llmReceivedContexts.length > 0 && (
                      <div>
                        <Label className="text-sm">LLM Received Context</Label>
                        <div className="mt-2 space-y-2 max-h-72 overflow-auto border rounded-md p-2 bg-background">
                          {llmReceivedContexts.map((ctx) => (
                            <div
                              key={ctx.id}
                              className="rounded-md border p-2 bg-muted/20"
                            >
                              <div className="text-xs font-medium">
                                {ctx.sectionLabel}
                              </div>
                              <div className="text-[11px] text-muted-foreground mt-1">
                                strategy={ctx.strategy} chars=
                                {ctx.fullTextChars} pages=[
                                {ctx.pages.join(", ")}] lines=[
                                {ctx.lines.slice(0, 12).join(", ")}
                                {ctx.lines.length > 12 ? ", ..." : ""}]
                              </div>
                              <pre className="mt-2 text-[11px] font-mono whitespace-pre-wrap break-words border rounded bg-background p-2 max-h-40 overflow-auto">
                                {ctx.contextText || "(empty context text)"}
                              </pre>
                              {ctx.contextTextTruncated && (
                                <p className="text-[11px] text-muted-foreground mt-1">
                                  Context text truncated to first 8000 chars.
                                </p>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}

                {/* Step: Complete */}
                {step === "complete" && (
                  <div className="flex flex-col items-center justify-center space-y-3 py-8">
                    <Check className="h-8 w-8 text-green-600" />
                    <p className="text-sm font-medium">
                      Schema Created Successfully!
                    </p>
                    <p className="text-xs text-muted-foreground text-center">
                      Your schema has been saved and is ready to use.
                    </p>
                  </div>
                )}

                {/* Errors */}
                {errors.length > 0 && (
                  <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2.5 text-xs text-destructive">
                    {errors.join(" ")}
                  </div>
                )}
              </div>
            </ScrollArea>

            {/* Footer Actions */}
            <div className="border-t px-4 py-3 flex-shrink-0 flex items-center justify-end gap-2">
              {step !== "complete" && (
                <Button
                  variant="outline"
                  onClick={onClose}
                  disabled={building || submitting}
                  size="sm"
                >
                  Cancel
                </Button>
              )}

              {step === "upload" && (
                <Button
                  onClick={handleBuildFromSample}
                  disabled={building || !uploadedFile || !schemaName.trim()}
                  size="sm"
                >
                  <Zap className="h-3.5 w-3.5 mr-1" />
                  {building ? "Processing..." : "Process PDF"}
                </Button>
              )}

              {step === "sections" && (
                <Button
                  onClick={handleGenerateFromSections}
                  disabled={building || submitting}
                  size="sm"
                >
                  {building ? "Generating..." : "Continue"}
                </Button>
              )}

              {step === "review" && (
                <Button
                  onClick={handleBuildPreset}
                  disabled={
                    building || submitting || selectedFieldIds.size === 0
                  }
                  size="sm"
                >
                  {building || submitting ? "Creating..." : "Create Schema"}
                </Button>
              )}

              {step === "complete" && (
                <Button onClick={onClose} size="sm">
                  Done
                </Button>
              )}
            </div>
          </>
        </div>
      </div>
    </div>
  );
}
