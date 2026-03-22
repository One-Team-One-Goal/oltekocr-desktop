import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AlertCircle, Loader2, Check, Zap } from "lucide-react";
import {
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

type AutomaticBuilderStep = "upload" | "building" | "review" | "complete";

type AutoBuildStatus = "idle" | "running" | "done" | "error";

type AutoBuildSnapshot = {
  status: AutoBuildStatus;
  buildLog: string;
  builtSchema: any | null;
  llmJsonOutput: Record<string, unknown> | null;
  error: string | null;
  processedDocumentId: string;
  fileName: string;
  autoSchemaId: string;
};

const initialAutoBuildSnapshot: AutoBuildSnapshot = {
  status: "idle",
  buildLog: "",
  builtSchema: null,
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
    return [
      {
        name: "Extracted Fields",
        fields: [
          {
            id: "full_text",
            label: "Full Text",
            fieldKey: "full_text",
            dataType: "string",
            extractionStrategy: "regex",
          },
        ],
      },
    ];
  }

  return tables.map((table: any, tableIdx: number) => {
    const headerCells = (Array.isArray(table?.cells) ? table.cells : [])
      .filter((cell: any) => cell?.row === 0)
      .sort((a: any, b: any) => (a?.col ?? 0) - (b?.col ?? 0));

    const fields = headerCells.length
      ? headerCells.map((cell: any, colIdx: number) => {
          const label = String(cell?.text || `Column ${colIdx + 1}`).trim();
          return {
            id: `${table?.tableId || tableIdx}_col_${colIdx}`,
            label,
            fieldKey: toFieldKey(label),
            dataType: "string",
            extractionStrategy: "table_column",
          };
        })
      : [
          {
            id: `${table?.tableId || tableIdx}_table_data`,
            label: `Table ${tableIdx + 1} Data`,
            fieldKey: `table_${tableIdx + 1}_data`,
            dataType: "string",
            extractionStrategy: "table_column",
          },
        ];

    return {
      name: `Table ${tableIdx + 1}`,
      fields,
    };
  });
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

    await sessionsApi.updateExtractionModel(tempSession.id, "docling");

    appendAutoBuildLog("Loading file into existing session endpoint...\n");
    const loadedDocs = await sessionsApi.ingestFiles(tempSession.id, [filePath]);
    const firstDoc = Array.isArray(loadedDocs) ? loadedDocs[0] : null;
    if (!firstDoc?.id) {
      throw new Error("Failed to create document for OCR processing.");
    }

    appendAutoBuildLog("Processing via existing /ocr/process endpoint (docling, no LLM)...\n");
    const ocrResult = await ocrApi.process(firstDoc.id);

    const scanModel = (ocrResult as any)?.processingMeta?.scanModel;
    if (scanModel && scanModel !== "docling") {
      appendAutoBuildLog(`Warning: scanModel was '${scanModel}', expected 'docling'.\n`);
    }

    const inferredTabs = inferTabsFromOcr(ocrResult);

    appendAutoBuildLog("Saving auto-schema JSON to database...\n");
    const savedAutoSchema = await autoSchemasApi.create({
      name: schemaName,
      documentId: firstDoc.id,
      uploadedFileName: uploadedFile.name,
      rawJson: ocrResult as Record<string, unknown>,
    });

    appendAutoBuildLog("Generating LLM schema from extracted Docling JSON...\n");
    const llmResponse = await autoSchemasApi.generateLlm(savedAutoSchema.id);

    const parsedTabs = llmResponse.parsed.tabs || [];
    const tabsForPreset = parsedTabs.length > 0 ? parsedTabs : inferredTabs;

    if (parsedTabs.length === 0) {
      appendAutoBuildLog("LLM returned no tabs; falling back to inferred Docling table structure.\n");
    } else {
      appendAutoBuildLog("LLM schema generation complete.\n");
    }

    const built = {
      id: firstDoc.id,
      name: schemaName,
      rawDocument: ocrResult,
      processingLog: Array.isArray(ocrResult?.warnings) ? ocrResult.warnings : [],
      normalizedSchema: {
        extractionMode: llmResponse.parsed.extractionMode || "AUTO",
        recordStartRegex: llmResponse.parsed.recordStartRegex || "",
        tabs: tabsForPreset,
        summary: {
          sections: llmResponse.parsed.sections || [],
          tables:
            llmResponse.parsed.tables?.map((table: any) => ({
              id: table.id,
              label: table.label,
              columnCount: Array.isArray(table.columns) ? table.columns.length : 0,
            })) ||
            tabsForPreset.map((tab: any, idx: number) => ({
              id: `table_${idx + 1}`,
              label: tab.name,
              columnCount: Array.isArray(tab.fields) ? tab.fields.length : 0,
            })),
        },
        warnings: Array.isArray(ocrResult?.warnings) ? ocrResult.warnings : [],
      },
    };

    patchAutoBuildSnapshot({
      status: "done",
      builtSchema: built,
      llmJsonOutput: llmResponse.llmJson,
      processedDocumentId: firstDoc.id,
      autoSchemaId: savedAutoSchema.id,
      error: null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to build schema";
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
  const [activeDataTab, setActiveDataTab] = useState<"docling" | "llm">("docling");
  const [step, setStep] = useState<AutomaticBuilderStep>("upload");
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [schemaName, setSchemaName] = useState("");
  const [selectedFieldIds, setSelectedFieldIds] = useState<Set<string>>(new Set());
  
  const [building, setBuilding] = useState(false);
  const [builtSchema, setBuiltSchema] = useState<any>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [buildLog, setBuildLog] = useState<string>("");
  const [processedDocumentId, setProcessedDocumentId] = useState<string>("");
  const [activeFileName, setActiveFileName] = useState<string>("");
  const [llmJsonOutput, setLlmJsonOutput] = useState<Record<string, unknown> | null>(null);
  const [llmError, setLlmError] = useState<string | null>(null);

  useEffect(() => {
    return subscribeAutoBuild((snapshot) => {
      setBuildLog(snapshot.buildLog);
      setProcessedDocumentId(snapshot.processedDocumentId);
      setActiveFileName(snapshot.fileName);
      setLlmJsonOutput(snapshot.llmJsonOutput);

      if (snapshot.status === "running") {
        setBuilding(true);
        setErrors([]);
        setStep("building");
        return;
      }

      if (snapshot.status === "done" && snapshot.builtSchema) {
        const fieldIds = snapshot.builtSchema.normalizedSchema.tabs
          .flatMap((tab: any) => tab.fields?.map((f: any) => f.id) || [])
          .filter((id: string | undefined): id is string => !!id);

        setBuilding(false);
        setBuiltSchema(snapshot.builtSchema);
        setSelectedFieldIds(new Set(fieldIds));
        setLlmError(null);
        setErrors([]);
        setStep("review");
        return;
      }

      if (snapshot.status === "error") {
        setBuilding(false);
        setLlmJsonOutput(null);
        setErrors(snapshot.error ? [snapshot.error] : ["Failed to build schema"]);
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
      setActiveDataTab("docling");
      setLlmJsonOutput(null);
      setLlmError(null);
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

  const handleBuildPreset = async () => {
    if (!builtSchema) {
      setErrors(["No schema to build from."]);
      return;
    }

    const presetName =
      (builtSchema.normalizedSchema?.summary?.name ||
        builtSchema.name ||
        schemaName).trim() || "Untitled Preset";

    setBuilding(true);
    setErrors([]);
    setStep("building");

    try {
      const selected = new Set(selectedFieldIds);
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

  const allFieldIds = builtSchema?.normalizedSchema?.tabs
    ?.flatMap((tab: any) => tab.fields?.map((f: any) => f.id) || [])
    .filter((id: string | undefined): id is string => !!id) || [];

  const handleSelectAllFields = () => {
    if (selectedFieldIds.size === allFieldIds.length && allFieldIds.length > 0) {
      setSelectedFieldIds(new Set());
    } else {
      setSelectedFieldIds(new Set(allFieldIds));
    }
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
              {step === "upload" ? "Upload a PDF to see extracted content" : `Extracted from: ${activeFileName || uploadedFile?.name || "unknown"}`}
            </p>
            <div className="mt-3 flex items-center gap-1">
              <button
                type="button"
                onClick={() => setActiveDataTab("docling")}
                className={`px-2.5 py-1 text-xs rounded border transition-colors ${
                  activeDataTab === "docling"
                    ? "bg-background border-foreground text-foreground"
                    : "bg-transparent border-border text-muted-foreground hover:text-foreground"
                }`}
              >
                Docling JSON
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
            {activeDataTab === "docling" ? (
              builtSchema?.rawDocument ? (
                <div className="p-4">
                  <pre className="text-xs font-mono bg-background rounded border p-3 overflow-auto whitespace-pre-wrap break-words max-h-96">
                    {JSON.stringify(builtSchema.rawDocument, null, 2)}
                  </pre>
                </div>
              ) : (
                <div className="p-4 text-center text-muted-foreground">
                  <p className="text-xs">No data extracted yet</p>
                  <p className="text-xs mt-2 opacity-60">Upload a PDF to view extracted content</p>
                </div>
              )
            ) : (
              llmJsonOutput ? (
                <div className="p-4">
                  <pre className="text-xs font-mono bg-background rounded border p-3 overflow-auto whitespace-pre-wrap break-words max-h-96">
                    {JSON.stringify(llmJsonOutput, null, 2)}
                  </pre>
                </div>
              ) : (
                <div className="p-4 text-center text-muted-foreground">
                  <p className="text-xs">No LLM JSON output yet</p>
                  <p className="text-xs mt-2 opacity-60">Run Process PDF to generate LLM output automatically.</p>
                  {llmError && <p className="text-xs mt-2 text-destructive">{llmError}</p>}
                </div>
              )
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
                        <h3 className="font-medium mb-2 text-sm">Schema Summary</h3>
                        <div className="space-y-2 text-xs bg-muted/40 rounded-md p-3">
                          <div>
                            <span className="font-medium">Name:</span>{" "}
                            {builtSchema.name}
                          </div>
                          {builtSchema.normalizedSchema?.summary?.sections && (
                            <div>
                              <span className="font-medium">Sections:</span>{" "}
                              {builtSchema.normalizedSchema.summary.sections.length}
                            </div>
                          )}
                          {builtSchema.normalizedSchema?.summary?.tables && (
                            <div>
                              <span className="font-medium">Tables:</span>{" "}
                              {builtSchema.normalizedSchema.summary.tables.length}
                            </div>
                          )}
                        </div>
                      </div>

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
                            {builtSchema.normalizedSchema.tabs.map((tab: any, tabIdx: number) => (
                              <div key={tabIdx} className="rounded-md border p-2 bg-muted/20">
                                <h4 className="text-xs font-medium mb-1.5">{tab.name}</h4>
                                <div className="space-y-1 ml-1">
                                  {tab.fields?.map((field: any) => (
                                    <label key={field.id} className="flex items-center gap-2 text-xs cursor-pointer hover:bg-background p-1 rounded">
                                      <input
                                        type="checkbox"
                                        checked={selectedFieldIds.has(field.id)}
                                        onChange={(e) =>
                                          handleSelectField(field.id, e.target.checked)
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
                            ))}
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
                                  )
                                )}
                              </ul>
                            </div>
                          </div>
                        </div>
                      )}
                    </>
                  )}

                  {/* Step: Complete */}
                  {step === "complete" && (
                    <div className="flex flex-col items-center justify-center space-y-3 py-8">
                      <Check className="h-8 w-8 text-green-600" />
                      <p className="text-sm font-medium">Schema Created Successfully!</p>
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

                {step === "review" && (
                  <Button
                    onClick={handleBuildPreset}
                    disabled={building || submitting || selectedFieldIds.size === 0}
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
