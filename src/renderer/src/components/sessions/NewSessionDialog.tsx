import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { sessionPresetsApi, sessionsApi } from "@/api/client";
import {
  FileText,
  Table2,
  FolderOpen,
  FilePlus,
  Plus,
  Trash2,
  ChevronRight,
  ChevronLeft,
  Loader2,
  X,
  FileJson,
  FileScan,
  Construction,
  Settings2,
  Receipt,
  ScrollText,
  ClipboardList,
  Scale,
  BarChart3,
  BadgeCheck,
  HelpCircle,
  type LucideIcon,
} from "lucide-react";
import type { SessionColumn, SessionPresetRecord } from "@shared/types";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PresetManagerDialog } from "./PresetManagerDialog";

interface NewSessionDialogProps {
  open: boolean;
  onClose: () => void;
  onCreated: (sessionId: string, docIds: string[]) => void;
  defaultMode?: SessionMode;
}

type SessionMode =
  | "OCR_EXTRACT"
  | "TABLE_EXTRACT"
  | "PDF_EXTRACT"
  | "JSON_EXTRACT";

type PdfDocumentType =
  | "INVOICE"
  | "CONTRACT"
  | "REPORT"
  | "FORM"
  | "LEGAL"
  | "RECEIPT"
  | "ID"
  | "OTHER";

const PDF_DOC_TYPES: {
  value: PdfDocumentType;
  icon: LucideIcon;
  label: string;
  desc: string;
}[] = [
  {
    value: "INVOICE",
    icon: Receipt,
    label: "Invoice / Bill",
    desc: "Billing documents, purchase orders, and statements.",
  },
  {
    value: "CONTRACT",
    icon: ScrollText,
    label: "Contract / Agreement",
    desc: "Signed agreements, terms, MoUs and similar.",
  },
  {
    value: "REPORT",
    icon: BarChart3,
    label: "Report / Letter",
    desc: "Business or technical reports and correspondence.",
  },
  {
    value: "FORM",
    icon: ClipboardList,
    label: "Form / Application",
    desc: "Filled-in forms, registrations, or applications.",
  },
  {
    value: "LEGAL",
    icon: Scale,
    label: "Legal / Court Order",
    desc: "Court orders, judgements, and legal filings.",
  },
  {
    value: "ID",
    icon: BadgeCheck,
    label: "ID / Certificate",
    desc: "Identity documents, licences, and certificates.",
  },
  {
    value: "RECEIPT",
    icon: FileText,
    label: "Receipt / Voucher",
    desc: "Payment receipts and transaction vouchers.",
  },
  {
    value: "OTHER",
    icon: HelpCircle,
    label: "Other",
    desc: "Any other document type not listed above.",
  },
];
type SourceType = "FILES" | "FOLDER";

const STEPS = ["Details", "Columns", "Source"] as const;

// Auto-generate a slug key from a label string
function toKey(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

export function NewSessionDialog({
  open,
  onClose,
  onCreated,
  defaultMode,
}: NewSessionDialogProps) {
  // ── Step ─────────────────────────────────────────────
  const [step, setStep] = useState(1);

  // ── Step 1 ────────────────────────────────────────────
  const [name, setName] = useState("");
  const [mode, setMode] = useState<SessionMode>(defaultMode ?? "OCR_EXTRACT");

  // ── Step 2 (TABLE_EXTRACT columns) ───────────────────
  const [columns, setColumns] = useState<SessionColumn[]>([
    { key: "", label: "", question: "" },
  ]);
  const [columnInputMode, setColumnInputMode] = useState<"MANUAL" | "PRESET">(
    "MANUAL",
  );

  // ── Step 3 (source) ───────────────────────────────────
  const [sourceType, setSourceType] = useState<SourceType>("FILES");
  const [filePaths, setFilePaths] = useState<string[]>([]);
  const [folderPath, setFolderPath] = useState("");

  // ── Presets ────────────────────────────────────────────
  const [presets, setPresets] = useState<SessionPresetRecord[]>([]);
  const [selectedPresetId, setSelectedPresetId] = useState<string>("none");
  const [presetDialogOpen, setPresetDialogOpen] = useState(false);

  // ── PDF document type ──────────────────────────────────
  const [documentType, setDocumentType] = useState<PdfDocumentType | "">(
    "INVOICE",
  );

  // ── Loading ────────────────────────────────────────────
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const loadPresets = async () => {
    try {
      const data = await sessionPresetsApi.list();
      setPresets(data);
    } catch (err) {
      console.error("Failed to load session presets:", err);
    }
  };

  useEffect(() => {
    if (open) loadPresets();
  }, [open]);

  // ── Total steps depends on mode ────────────────────────
  const totalSteps = mode === "TABLE_EXTRACT" || mode === "PDF_EXTRACT" ? 3 : 2;
  const isMockMode = mode === "JSON_EXTRACT";

  // ── Reset on close ────────────────────────────────────
  const handleClose = () => {
    setStep(1);
    setName("");
    setMode(defaultMode ?? "OCR_EXTRACT");
    setColumns([{ key: "", label: "", question: "" }]);
    setColumnInputMode("MANUAL");
    setSourceType("FILES");
    setFilePaths([]);
    setFolderPath("");
    setSelectedPresetId("none");
    setDocumentType("INVOICE");
    setError("");
    onClose();
  };

  const applyPresetById = (presetId: string) => {
    setSelectedPresetId(presetId);
    if (presetId === "none") return;

    const preset = presets.find((p) => p.id === presetId);
    if (!preset) return;

    setColumns(
      preset.columns.length > 0
        ? preset.columns
        : [{ key: "", label: "", question: "" }],
    );
  };

  // ── Step helpers ──────────────────────────────────────
  const canAdvance = (): boolean => {
    if (step === 1) return name.trim().length > 0;
    if (isMockMode) return false; // mock modes can't proceed past step 1
    if (step === 2 && mode === "TABLE_EXTRACT") {
      if (columnInputMode === "PRESET") {
        return (
          selectedPresetId !== "none" &&
          columns.every(
            (c) => c.label.trim() && c.key.trim() && c.question.trim(),
          )
        );
      }
      return columns.every(
        (c) => c.label.trim() && c.key.trim() && c.question.trim(),
      );
    }
    // Source step for OCR_EXTRACT (step 2) and PDF_EXTRACT (step 2) and TABLE_EXTRACT (step 3)
    const sourceStep = mode === "TABLE_EXTRACT" ? 3 : 2;
    if (step === sourceStep && mode !== "PDF_EXTRACT") {
      return sourceType === "FILES"
        ? filePaths.length > 0
        : folderPath.trim().length > 0;
    }
    // PDF_EXTRACT: step 2 = source, step 3 = doc type
    if (mode === "PDF_EXTRACT") {
      if (step === 2) {
        return sourceType === "FILES"
          ? filePaths.length > 0
          : folderPath.trim().length > 0;
      }
      if (step === 3) return documentType !== "";
    }
    return true;
  };

  const nextStep = () => {
    if (!canAdvance()) return;
    setStep((s) => s + 1);
  };

  // ── File picker ───────────────────────────────────────
  const handlePickFiles = async () => {
    try {
      const result = await window.api.openFileDialog();
      if (!result.canceled) setFilePaths(result.filePaths);
    } catch (err) {
      console.error("File dialog failed:", err);
    }
  };

  const handlePickFolder = async () => {
    try {
      const result = await window.api.openFolderDialog();
      if (!result.canceled) setFolderPath(result.filePaths[0] ?? "");
    } catch (err) {
      console.error("Folder dialog failed:", err);
    }
  };

  // ── Column helpers ─────────────────────────────────────
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
      if (field === "label") {
        next[i].key = toKey(value);
      }
      return next;
    });
  };

  // ── Submit ──────────────────────────────────────────────
  const handleSubmit = async () => {
    if (!canAdvance()) return;
    setSubmitting(true);
    setError("");

    try {
      // 1. Create session
      const session = await sessionsApi.create({
        name: name.trim(),
        mode,
        columns: mode === "TABLE_EXTRACT" ? columns : [],
        sourceType,
        documentType: mode === "PDF_EXTRACT" ? documentType : undefined,
      });

      // 2. Ingest files / folder
      let docs: any[] = [];
      if (sourceType === "FILES") {
        docs = await sessionsApi.ingestFiles(session.id, filePaths);
      } else {
        docs = await sessionsApi.ingestFolder(session.id, folderPath);
      }

      const docIds = docs.map((d: any) => d.id);
      onCreated(session.id, docIds);
    } catch (err: any) {
      setError(err.message ?? "Failed to create session.");
    } finally {
      setSubmitting(false);
    }
  };

  // ── Render ─────────────────────────────────────────────
  const isLastStep =
    mode === "TABLE_EXTRACT" || mode === "PDF_EXTRACT"
      ? step === 3
      : step === 2;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="sm:max-w-[540px] gap-0 p-0 overflow-hidden">
        {/* Step indicator */}
        <div className="flex border-b px-6 pt-5 pb-0 gap-0">
          {(mode === "TABLE_EXTRACT"
            ? ["Details", "Columns", "Source"]
            : mode === "PDF_EXTRACT"
              ? ["Details", "Source", "Doc Type"]
              : ["Details", "Source"]
          ).map((label, i) => {
            const n = i + 1;
            const active = n === step;
            const done = n < step;
            return (
              <div key={label} className="flex items-center gap-0 mb-[-1px]">
                <button
                  className={`flex items-center gap-1.5 px-3 pb-3 pt-1 text-sm font-medium border-b-2 transition-colors ${
                    active
                      ? "border-primary text-foreground"
                      : done
                        ? "border-transparent text-muted-foreground hover:text-foreground"
                        : "border-transparent text-muted-foreground/50 cursor-default"
                  }`}
                  onClick={() => done && setStep(n)}
                  disabled={!done && !active}
                >
                  <span
                    className={`inline-flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold ${
                      active
                        ? "bg-primary text-white"
                        : done
                          ? "bg-green-100 text-green-600"
                          : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {n}
                  </span>
                  {label}
                </button>
                {i <
                  (mode === "TABLE_EXTRACT" || mode === "PDF_EXTRACT"
                    ? 2
                    : 1) && (
                  <ChevronRight className="h-3 w-3 text-muted-foreground mx-1 mb-2" />
                )}
              </div>
            );
          })}
        </div>

        <div className="p-6 space-y-5">
          {/* ── STEP 1: Details ── */}
          {step === 1 && (
            <>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Session Name</label>
                <Input
                  placeholder="e.g. Court Orders – March 2026"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoFocus
                  onKeyDown={(e) => e.key === "Enter" && nextStep()}
                />
              </div>
              {!defaultMode && (
                <div className="space-y-2">
                  <label className="text-sm font-medium">Processing Mode</label>
                  <div className="grid grid-cols-2 gap-3">
                    {(
                      [
                        {
                          value: "OCR_EXTRACT" as const,
                          icon: FileText,
                          title: "OCR Extract",
                          desc: "Full OCR — extract text, tables, and confidence scores from each document.",
                          mock: false,
                        },
                        {
                          value: "TABLE_EXTRACT" as const,
                          icon: Table2,
                          title: "Table Extract",
                          desc: "Define columns (e.g. Case No, Date, Respondent) and AI fills them from each document.",
                          mock: false,
                        },
                        {
                          value: "PDF_EXTRACT" as const,
                          icon: FileScan,
                          title: "PDF Extract",
                          desc: "Directly extract structured text from digital PDF files — no OCR needed.",
                          mock: false,
                        },
                        {
                          value: "JSON_EXTRACT" as const,
                          icon: FileJson,
                          title: "JSON Extract",
                          desc: "Use an LLM to extract fields and output structured JSON from logistics documents.",
                          mock: true,
                        },
                      ] as const
                    ).map(({ value, icon: Icon, title, desc, mock }) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setMode(value)}
                        className={`relative text-left p-4 rounded-xl border-2 transition-all ${
                          mode === value
                            ? "border-primary bg-primary/5"
                            : "border-border hover:border-muted-foreground/50"
                        }`}
                      >
                        {mock && (
                          <span className="absolute top-2 right-2 inline-flex items-center gap-0.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-semibold text-amber-700">
                            <Construction className="h-2.5 w-2.5" />
                            Soon
                          </span>
                        )}
                        <Icon
                          className={`h-5 w-5 mb-2 ${mode === value ? "text-primary" : "text-muted-foreground"}`}
                        />
                        <p className="text-sm font-semibold">{title}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {desc}
                        </p>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {/* ── STEP 2: Columns (TABLE_EXTRACT only) ── */}
          {step === 2 && mode === "TABLE_EXTRACT" && (
            <div className="space-y-3">
              <div>
                <p className="text-sm font-medium">Define columns to extract</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Choose manual setup or use a saved preset before starting the
                  session.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setColumnInputMode("MANUAL")}
                  className={`rounded-lg border p-3 text-left ${
                    columnInputMode === "MANUAL"
                      ? "border-primary bg-primary/5"
                      : "border-border hover:bg-muted/30"
                  }`}
                >
                  <p className="text-sm font-medium">Define Manually</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Add or edit each extraction column for this session.
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => setColumnInputMode("PRESET")}
                  className={`rounded-lg border p-3 text-left ${
                    columnInputMode === "PRESET"
                      ? "border-primary bg-primary/5"
                      : "border-border hover:bg-muted/30"
                  }`}
                >
                  <p className="text-sm font-medium">Use Preset</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Load previously saved document extraction columns.
                  </p>
                </button>
              </div>

              {columnInputMode === "PRESET" ? (
                <div className="space-y-3">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-medium">
                        Select Preset
                      </label>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs"
                        onClick={() => setPresetDialogOpen(true)}
                      >
                        <Settings2 className="h-3.5 w-3.5" />
                        Manage Presets
                      </Button>
                    </div>

                    <Select
                      value={selectedPresetId}
                      onValueChange={(value) => applyPresetById(value)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Choose a table extraction preset" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Choose preset...</SelectItem>
                        {presets
                          .filter((preset) => preset.mode === "TABLE_EXTRACT")
                          .map((preset) => (
                            <SelectItem key={preset.id} value={preset.id}>
                              {preset.name}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2 max-h-56 overflow-y-auto pr-0.5">
                    {columns.map((col, i) => (
                      <div
                        key={i}
                        className="grid grid-cols-[1fr_1fr] gap-2 items-start p-3 rounded-lg border border-border"
                      >
                        <div className="space-y-1">
                          <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
                            Column Label
                          </p>
                          <p className="text-xs font-medium">
                            {col.label || "-"}
                          </p>
                          <p className="text-[10px] font-mono text-muted-foreground">
                            key: {col.key || "-"}
                          </p>
                        </div>
                        <div className="space-y-1">
                          <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
                            Question for AI
                          </p>
                          <p className="text-xs">{col.question || "-"}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <>
                  <div className="space-y-2 max-h-64 overflow-y-auto pr-0.5">
                    {columns.map((col, i) => (
                      <div
                        key={i}
                        className="grid grid-cols-[1fr_1fr_auto] gap-2 items-start p-3 rounded-lg border border-border"
                      >
                        <div className="space-y-1">
                          <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
                            Column Label
                          </label>
                          <Input
                            className="h-7 text-xs bg-secondary"
                            placeholder="e.g. Case Number"
                            value={col.label}
                            onChange={(e) =>
                              updateColumn(i, "label", e.target.value)
                            }
                          />
                          <div className="flex items-center gap-1">
                            <span className="text-[9px] text-muted-foreground">
                              key:
                            </span>
                            <Input
                              className="h-5 text-[10px] font-mono bg-secondary"
                              placeholder="case_number"
                              value={col.key}
                              onChange={(e) =>
                                updateColumn(i, "key", e.target.value)
                              }
                            />
                          </div>
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
                            Question for AI
                          </label>
                          <Input
                            className="h-7 text-xs bg-secondary"
                            placeholder="What is the case number?"
                            value={col.question}
                            onChange={(e) =>
                              updateColumn(i, "question", e.target.value)
                            }
                          />
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 mt-5 text-muted-foreground hover:text-red-500"
                          disabled={columns.length === 1}
                          onClick={() => removeColumn(i)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ))}
                  </div>

                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5 text-xs"
                    onClick={addColumn}
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add Column
                  </Button>
                </>
              )}
            </div>
          )}

          {/* ── STEP 3: Doc Type (PDF_EXTRACT only) ── */}
          {step === 3 && mode === "PDF_EXTRACT" && (
            <div className="space-y-3">
              <div>
                <p className="text-sm font-medium">Document Type</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Select the type of document you are extracting. This helps
                  tailor the extraction pipeline.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                {PDF_DOC_TYPES.map(({ value, icon: Icon, label, desc }) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setDocumentType(value)}
                    className={`text-left p-3 rounded-xl border-2 transition-all ${
                      documentType === value
                        ? "border-primary bg-primary/5"
                        : "border-border hover:border-muted-foreground/50"
                    }`}
                  >
                    <Icon
                      className={`h-4 w-4 mb-1.5 ${
                        documentType === value
                          ? "text-primary"
                          : "text-muted-foreground"
                      }`}
                    />
                    <p className="text-xs font-semibold">{label}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5 leading-tight">
                      {desc}
                    </p>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ── STEP 2/3: Source ── */}
          {((step === 2 && mode === "OCR_EXTRACT") ||
            (step === 2 && mode === "PDF_EXTRACT") ||
            (step === 3 && mode === "TABLE_EXTRACT")) && (
            <div className="space-y-4">
              <div className="space-y-2">
                <p className="text-sm font-medium">Source</p>
                <div className="grid grid-cols-2 gap-3">
                  {(
                    [
                      {
                        value: "FILES" as const,
                        icon: FilePlus,
                        label: "Select Files",
                        desc: "Pick individual image or PDF files",
                      },
                      {
                        value: "FOLDER" as const,
                        icon: FolderOpen,
                        label: "Select Folder",
                        desc: "Load all supported files from a folder",
                      },
                    ] as const
                  ).map(({ value, icon: Icon, label, desc }) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setSourceType(value)}
                      className={`text-left p-4 rounded-xl border-2 transition-all ${
                        sourceType === value
                          ? "border-primary bg-primary/5"
                          : "border-border hover:border-muted-foreground/50"
                      }`}
                    >
                      <Icon
                        className={`h-5 w-5 mb-2 ${sourceType === value ? "text-primary" : "text-muted-foreground"}`}
                      />
                      <p className="text-sm font-semibold">{label}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {desc}
                      </p>
                    </button>
                  ))}
                </div>
              </div>

              {sourceType === "FILES" ? (
                <div className="space-y-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    onClick={handlePickFiles}
                  >
                    <FilePlus className="h-3.5 w-3.5" />
                    {filePaths.length > 0
                      ? `${filePaths.length} file${filePaths.length > 1 ? "s" : ""} selected — change`
                      : "Browse files…"}
                  </Button>
                  {filePaths.length > 0 && (
                    <div className="max-h-32 overflow-y-auto space-y-0.5 bg-secondary rounded-lg p-2 border border-border">
                      {filePaths.map((f) => (
                        <div
                          key={f}
                          className="flex items-center justify-between text-xs text-muted-foreground gap-1"
                        >
                          <span className="truncate">
                            {f.split(/[\\/]/).pop()}
                          </span>
                          <button
                            onClick={() =>
                              setFilePaths((prev) =>
                                prev.filter((p) => p !== f),
                              )
                            }
                            className="shrink-0 hover:text-red-500"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    onClick={handlePickFolder}
                  >
                    <FolderOpen className="h-3.5 w-3.5" />
                    {folderPath ? "Change folder…" : "Browse folder…"}
                  </Button>
                  {folderPath && (
                    <p className="text-xs text-muted-foreground bg-gray-50 rounded-lg px-3 py-2 border border-border font-mono truncate">
                      {folderPath}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {error && (
            <p className="text-xs text-red-500 bg-red-50 rounded-lg px-3 py-2 border border-red-200">
              {error}
            </p>
          )}
        </div>

        <DialogFooter className="px-6 pb-5 pt-0 flex items-center justify-between">
          <Button
            variant="ghost"
            size="sm"
            onClick={step === 1 ? handleClose : () => setStep((s) => s - 1)}
          >
            {step === 1 ? (
              "Cancel"
            ) : (
              <>
                <ChevronLeft className="h-3.5 w-3.5 mr-1" />
                Back
              </>
            )}
          </Button>

          {isMockMode && step === 1 ? (
            <div className="flex items-center gap-2 text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              <Construction className="h-3.5 w-3.5 shrink-0" />
              This mode is coming soon and not yet available.
            </div>
          ) : isLastStep ? (
            <Button
              onClick={handleSubmit}
              disabled={!canAdvance() || submitting}
              className="gap-1.5"
            >
              {submitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
              {submitting ? "Creating…" : "Start Session"}
            </Button>
          ) : (
            <Button
              onClick={nextStep}
              disabled={!canAdvance()}
              className="gap-1.5"
            >
              Next
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          )}
        </DialogFooter>
      </DialogContent>

      <PresetManagerDialog
        open={presetDialogOpen}
        onClose={() => setPresetDialogOpen(false)}
        onChanged={(nextPresets) => {
          setPresets(nextPresets);
          if (
            selectedPresetId !== "none" &&
            !nextPresets.some((preset) => preset.id === selectedPresetId)
          ) {
            setSelectedPresetId("none");
            if (columnInputMode === "PRESET") {
              setColumns([{ key: "", label: "", question: "" }]);
            }
          }
        }}
      />
    </Dialog>
  );
}
