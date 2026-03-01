import { documentsApi } from "@/api/client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Loader2,
  Pencil,
  Crosshair,
  ZoomIn,
  ZoomOut,
  RotateCw,
  Maximize2,
  Eye,
  FileText,
  Type,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  DocumentListItem,
  DocumentRecord,
  SessionRecord,
  TextBlock,
} from "@shared/types";

interface ExtractedTableProps {
  documents: DocumentListItem[];
  session: SessionRecord | null;
  selectedId: string | null;
  onSelectId: (id: string) => void;
  onRefresh?: () => void;
  scrollContainerRef?: React.RefObject<HTMLDivElement>;
  onTableScroll?: () => void;
}

export function ExtractedTable({
  documents,
  session,
  selectedId,
  onSelectId,
  onRefresh,
  scrollContainerRef,
  onTableScroll,
}: ExtractedTableProps) {
  const isTableMode = session?.mode === "TABLE_EXTRACT";
  const columns = session?.columns ?? [];

  const [detailDocId, setDetailDocId] = useState<string | null>(null);

  const [colWidths, setColWidths] = useState<number[]>(() =>
    isTableMode ? [140, ...columns.map(() => 140)] : [140, 0, 48, 56],
  );
  const resizing = useRef<{
    colIdx: number;
    startX: number;
    startWidth: number;
  } | null>(null);

  useEffect(() => {
    if (isTableMode) setColWidths([140, ...columns.map(() => 140)]);
  }, [isTableMode, columns.length]);

  const startResize = (e: React.MouseEvent, colIdx: number) => {
    e.preventDefault();
    e.stopPropagation();
    resizing.current = {
      colIdx,
      startX: e.clientX,
      startWidth: colWidths[colIdx],
    };
    const onMove = (ev: MouseEvent) => {
      if (!resizing.current) return;
      const delta = ev.clientX - resizing.current.startX;
      const newW = Math.max(60, resizing.current.startWidth + delta);
      setColWidths((p) => {
        const n = [...p];
        n[resizing.current!.colIdx] = newW;
        return n;
      });
    };
    const onUp = () => {
      resizing.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  if (!session) return null;

  const detailDoc = detailDocId
    ? (documents.find((d) => d.id === detailDocId) ?? null)
    : null;

  return (
    <div className="flex flex-col h-full">
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-auto"
        onScroll={onTableScroll}
      >
        {documents.length === 0 ? (
          <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
            No documents yet
          </div>
        ) : (
          <table className="w-full text-sm table-fixed">
            <thead className="sticky top-0 bg-white z-10">
              <tr className="h-10 border-b border-border text-muted-foreground divide-x divide-border">
                <th
                  className="pl-4 pr-3 py-2 text-left font-medium text-xs relative select-none"
                  style={{ width: colWidths[0] }}
                >
                  Filename
                  <div
                    className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-primary/40 transition-colors z-10"
                    onMouseDown={(e) => startResize(e, 0)}
                  />
                </th>

                {isTableMode ? (
                  columns.map((col, i) => (
                    <th
                      key={col.key}
                      className="px-3 py-2 text-left font-medium text-xs overflow-hidden relative select-none"
                      style={{ width: colWidths[i + 1] ?? 140 }}
                    >
                      <span className="block truncate" title={col.label}>
                        {col.label}
                      </span>
                      <div
                        className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-primary/40 transition-colors z-10"
                        onMouseDown={(e) => startResize(e, i + 1)}
                      />
                    </th>
                  ))
                ) : (
                  <>
                    <th className="px-3 py-2 text-left font-medium text-xs relative select-none">
                      Text Preview
                      <div
                        className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-primary/40 transition-colors z-10"
                        onMouseDown={(e) => startResize(e, 1)}
                      />
                    </th>
                    <th
                      className="px-3 py-2 text-center font-medium text-xs relative select-none"
                      style={{ width: colWidths[2] ?? 48 }}
                    >
                      Pgs
                      <div
                        className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-primary/40 transition-colors z-10"
                        onMouseDown={(e) => startResize(e, 2)}
                      />
                    </th>
                    <th
                      className="px-3 py-2 text-center font-medium text-xs relative select-none"
                      style={{ width: colWidths[3] ?? 56 }}
                    >
                      Tables
                    </th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {documents.map((doc) => {
                const isSelected = doc.id === selectedId;
                const isPending =
                  doc.status === "QUEUED" ||
                  doc.status === "SCANNING" ||
                  doc.status === "PROCESSING";

                return (
                  <tr
                    key={doc.id}
                    className={`h-10 border-b border-border cursor-pointer transition-colors group divide-x divide-border ${
                      isSelected
                        ? "bg-primary/5 hover:bg-primary/10"
                        : "hover:bg-gray-50"
                    }`}
                    onClick={() => {
                      onSelectId(doc.id);
                      if (isTableMode) setDetailDocId(doc.id);
                    }}
                  >
                    <td
                      className="pl-4 pr-3 py-2 font-medium text-foreground overflow-hidden"
                      style={{ width: colWidths[0] }}
                    >
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span
                          className="truncate block text-xs min-w-0"
                          title={doc.filename}
                        >
                          {doc.filename}
                        </span>
                        {isTableMode && !isPending && (
                          <Pencil className="h-3 w-3 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-60 transition-opacity" />
                        )}
                      </div>
                    </td>

                    {isTableMode ? (
                      columns.map((col, colIdx) => {
                        const cell = doc.extractedRow?.[col.key];
                        const answer = cell?.answer ?? "";
                        const score = cell?.score ?? 0;
                        const hasAnswer = answer.length > 0 && score > 0;

                        return (
                          <td
                            key={col.key}
                            className="px-3 py-2 text-xs overflow-hidden"
                            style={{ width: colWidths[colIdx + 1] ?? 140 }}
                          >
                            {isPending ? (
                              <span className="text-muted-foreground italic">
                                pending…
                              </span>
                            ) : hasAnswer ? (
                              <span className="flex items-center gap-1 min-w-0">
                                <span
                                  className="truncate block min-w-0"
                                  title={answer}
                                >
                                  {answer}
                                </span>
                                {score > 0 && (
                                  <span className="shrink-0 text-[10px] text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity">
                                    {Math.round(score * 100)}%
                                  </span>
                                )}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                        );
                      })
                    ) : (
                      <>
                        <td className="px-3 py-2 text-xs text-muted-foreground max-w-xs">
                          {isPending ? (
                            <span className="italic">pending…</span>
                          ) : doc.ocrPageCount > 0 ? (
                            <OcrTextPreview docId={doc.id} />
                          ) : (
                            <span>No OCR data</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-center font-mono text-xs">
                          {doc.ocrPageCount || "—"}
                        </td>
                        <td className="px-3 py-2 text-center font-mono text-xs">
                          {doc.ocrTableCount || "—"}
                        </td>
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {detailDoc && (
        <RowDetailDialog
          doc={detailDoc}
          session={session}
          onClose={() => setDetailDocId(null)}
          onSaved={() => {
            setDetailDocId(null);
            onRefresh?.();
          }}
        />
      )}
    </div>
  );
}

// ─── Row Detail / Edit Dialog ──────────────────────────────────────────────────

interface RowDetailProps {
  doc: DocumentListItem;
  session: SessionRecord;
  onClose: () => void;
  onSaved: () => void;
}

function RowDetailDialog({ doc, session, onClose, onSaved }: RowDetailProps) {
  const columns = session.columns ?? [];

  const [values, setValues] = useState<Record<string, string>>(() => {
    const row: Record<string, string> = {};
    for (const col of columns) {
      row[col.key] = doc.extractedRow?.[col.key]?.answer ?? "";
    }
    return row;
  });

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [pickField, setPickField] = useState<string | null>(null);

  const isPending =
    doc.status === "QUEUED" ||
    doc.status === "SCANNING" ||
    doc.status === "PROCESSING";

  const handleSave = async () => {
    setSaving(true);
    setError("");
    try {
      const newRow: Record<string, { answer: string; score: number }> = {};
      for (const col of columns) {
        const existing = doc.extractedRow?.[col.key];
        newRow[col.key] = {
          answer: values[col.key] ?? "",
          score:
            values[col.key] === (existing?.answer ?? "")
              ? (existing?.score ?? 0)
              : 1.0,
        };
      }
      await documentsApi.update(doc.id, { extractedRow: newRow });
      onSaved();
    } catch (err: any) {
      setError(err.message ?? "Failed to save changes.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Dialog open onOpenChange={(v) => !v && onClose()}>
        <DialogContent className="sm:max-w-[520px] gap-0 p-0 overflow-hidden">
          <DialogHeader className="px-6 pt-5 pb-4 border-b">
            <DialogTitle className="text-sm font-semibold truncate pr-8">
              {doc.filename}
            </DialogTitle>
            <p className="text-xs text-muted-foreground mt-0.5">
              Extracted fields — edit values and save to override.
            </p>
          </DialogHeader>

          <div className="px-6 py-4 space-y-4 max-h-[420px] overflow-y-auto">
            {columns.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No columns defined for this session.
              </p>
            ) : (
              columns.map((col) => {
                const existing = doc.extractedRow?.[col.key];
                const score = existing?.score ?? 0;
                const isDirty = values[col.key] !== (existing?.answer ?? "");

                return (
                  <div key={col.key}>
                    <div className="flex items-baseline justify-between mb-1">
                      <label className="text-xs font-semibold text-foreground">
                        {col.label}
                      </label>
                      {isDirty ? (
                        <span className="text-[10px] text-amber-600 font-medium">
                          edited
                        </span>
                      ) : score > 0 ? (
                        <span className="text-[10px] text-muted-foreground">
                          confidence {Math.round(score * 100)}%
                        </span>
                      ) : null}
                    </div>
                    <div className="flex gap-1.5">
                      <Input
                        className="h-8 text-xs flex-1"
                        placeholder={
                          isPending ? "waiting for OCR…" : col.question
                        }
                        disabled={isPending}
                        value={values[col.key] ?? ""}
                        onChange={(e) =>
                          setValues((v) => ({
                            ...v,
                            [col.key]: e.target.value,
                          }))
                        }
                      />
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-8 w-8 shrink-0"
                        disabled={isPending}
                        title="Manually select from document"
                        onClick={() => setPickField(col.key)}
                      >
                        <Crosshair className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {error && (
            <p className="mx-6 mb-1 text-xs text-destructive">{error}</p>
          )}

          <DialogFooter className="px-6 py-4 border-t">
            <Button variant="ghost" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={saving || isPending}
              onClick={handleSave}
            >
              {saving && (
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              )}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {pickField && (
        <MiniOcrPicker
          docId={doc.id}
          fieldLabel={
            columns.find((c) => c.key === pickField)?.label ?? pickField
          }
          onPick={(text) => {
            setValues((v) => ({ ...v, [pickField!]: text }));
            setPickField(null);
          }}
          onClose={() => setPickField(null)}
        />
      )}
    </>
  );
}

// ─── Mini OCR Picker ───────────────────────────────────────────────────────────

interface MiniOcrPickerProps {
  docId: string;
  fieldLabel: string;
  onPick: (text: string) => void;
  onClose: () => void;
}

function MiniOcrPicker({
  docId,
  fieldLabel,
  onPick,
  onClose,
}: MiniOcrPickerProps) {
  const [fullDoc, setFullDoc] = useState<DocumentRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [showOverlays, setShowOverlays] = useState(true);
  const [activeTab, setActiveTab] = useState<"formatted" | "raw">("formatted");
  const [selection, setSelection] = useState("");
  const [highlightedBlock, setHighlightedBlock] = useState<number | null>(null);

  useEffect(() => {
    setLoading(true);
    documentsApi
      .get(docId)
      .then(setFullDoc)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [docId]);

  const ocr = fullDoc?.ocrResult ?? null;
  const imageUrl = `http://localhost:3847/api/documents/${docId}/image`;

  const handleTextSelection = useCallback(() => {
    const sel = window.getSelection()?.toString().trim() ?? "";
    if (sel.length > 0) {
      setSelection(sel);
      setHighlightedBlock(null);
    }
  }, []);

  const handleBlockClick = (block: TextBlock, idx: number) => {
    setHighlightedBlock(idx);
    setSelection(block.text.trim());
    window.getSelection()?.removeAllRanges();
  };

  const fitToView = () => {
    setZoom(1);
    setRotation(0);
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-[92vw] max-h-[92vh] w-[92vw] h-[92vh] p-0 gap-0 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <Crosshair className="h-4 w-4 text-muted-foreground shrink-0" />
            <span className="text-sm font-semibold truncate">
              Selecting for: <span className="text-primary">{fieldLabel}</span>
            </span>
          </div>
          <p className="text-xs text-muted-foreground shrink-0 ml-4">
            Highlight text or click a bounding box, then press Extract
          </p>
        </div>

        {/* Body */}
        {loading ? (
          <div className="flex-1 flex items-center justify-center text-muted-foreground gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading document…
          </div>
        ) : (
          <div className="flex-1 flex overflow-hidden min-h-0">
            {/* Left: Image Viewer */}
            <div className="w-1/2 flex flex-col border-r">
              {/* Image toolbar */}
              <div className="flex items-center gap-1 px-2 py-1.5 border-b bg-muted/30 shrink-0">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => setZoom((z) => Math.min(z + 0.25, 5))}
                >
                  <ZoomIn className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => setZoom((z) => Math.max(z - 0.25, 0.25))}
                >
                  <ZoomOut className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => setRotation((r) => (r + 90) % 360)}
                >
                  <RotateCw className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={fitToView}
                >
                  <Maximize2 className="h-3.5 w-3.5" />
                </Button>
                <Separator orientation="vertical" className="mx-1 h-4" />
                <Button
                  variant={showOverlays ? "secondary" : "ghost"}
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => setShowOverlays((v) => !v)}
                >
                  <Eye className="h-3 w-3 mr-1" />
                  Boxes
                </Button>
                <span className="ml-auto text-xs text-muted-foreground">
                  {Math.round(zoom * 100)}%
                </span>
              </div>

              {/* Image area */}
              <div className="flex-1 overflow-auto bg-muted/20 flex items-start justify-center p-4">
                {fullDoc ? (
                  <div className="relative inline-block">
                    <img
                      src={imageUrl}
                      alt={fullDoc.filename}
                      className="max-w-none block"
                      style={{
                        transform: `scale(${zoom}) rotate(${rotation}deg)`,
                        transformOrigin: "top center",
                        transition: "transform 0.2s ease",
                      }}
                      draggable={false}
                    />
                    {showOverlays && ocr?.textBlocks && (
                      <div
                        className="absolute inset-0"
                        style={{
                          transform: `scale(${zoom}) rotate(${rotation}deg)`,
                          transformOrigin: "top center",
                        }}
                      >
                        {ocr.textBlocks.map((block, i) => {
                          const isHighlighted = highlightedBlock === i;
                          const conf = block.confidence ?? 100;
                          return (
                            <div
                              key={i}
                              className={cn(
                                "absolute border cursor-pointer transition-all",
                                isHighlighted
                                  ? "border-primary bg-primary/20 ring-1 ring-primary"
                                  : conf >= 90
                                    ? "border-green-500/50 bg-green-500/5 hover:bg-green-500/15"
                                    : conf >= 70
                                      ? "border-amber-500/50 bg-amber-500/5 hover:bg-amber-500/15"
                                      : "border-red-500/50 bg-red-500/5 hover:bg-red-500/15",
                              )}
                              style={{
                                left: block.bbox?.[0] ?? 0,
                                top: block.bbox?.[1] ?? 0,
                                width:
                                  (block.bbox?.[2] ?? 0) -
                                  (block.bbox?.[0] ?? 0),
                                height:
                                  (block.bbox?.[3] ?? 0) -
                                  (block.bbox?.[1] ?? 0),
                              }}
                              onClick={() => handleBlockClick(block, i)}
                              title={block.text}
                            />
                          );
                        })}
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-muted-foreground text-sm">
                    No image available.
                  </p>
                )}
              </div>
            </div>

            {/* Right: Selectable Text Tabs */}
            <div className="w-1/2 flex flex-col min-h-0">
              <Tabs
                value={activeTab}
                onValueChange={(v) => setActiveTab(v as "formatted" | "raw")}
                className="flex-1 flex flex-col min-h-0"
              >
                <TabsList className="mx-3 mt-2 mb-0 justify-start shrink-0">
                  <TabsTrigger value="formatted" className="text-xs gap-1">
                    <FileText className="h-3 w-3" /> Formatted
                  </TabsTrigger>
                  <TabsTrigger value="raw" className="text-xs gap-1">
                    <Type className="h-3 w-3" /> Raw
                  </TabsTrigger>
                </TabsList>

                <TabsContent
                  value="formatted"
                  className="flex-1 mt-0 min-h-0 overflow-auto"
                  onMouseUp={handleTextSelection}
                  onKeyUp={handleTextSelection}
                >
                  <div className="p-4 space-y-1.5 text-sm select-text cursor-text">
                    {ocr?.textBlocks && ocr.textBlocks.length > 0 ? (
                      ocr.textBlocks.map((block, i) => (
                        <p
                          key={i}
                          className={cn(
                            "leading-relaxed rounded px-0.5 transition-colors",
                            highlightedBlock === i && "bg-primary/15",
                            block.confidence < 70 &&
                              "text-red-400 underline decoration-dotted",
                            block.confidence >= 70 &&
                              block.confidence < 90 &&
                              "text-amber-400",
                          )}
                        >
                          {block.text}
                        </p>
                      ))
                    ) : (
                      <p className="text-muted-foreground">
                        No OCR text available.
                      </p>
                    )}
                  </div>
                </TabsContent>

                <TabsContent
                  value="raw"
                  className="flex-1 mt-0 min-h-0 overflow-auto"
                  onMouseUp={handleTextSelection}
                  onKeyUp={handleTextSelection}
                >
                  <div className="p-4 select-text cursor-text">
                    <pre className="text-xs font-mono whitespace-pre-wrap text-muted-foreground leading-relaxed">
                      {ocr?.textBlocks?.map((b) => b.text).join("\n") ||
                        "No OCR text available."}
                    </pre>
                  </div>
                </TabsContent>
              </Tabs>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t bg-muted/20 shrink-0">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            {selection ? (
              <>
                <span className="text-xs text-muted-foreground shrink-0">
                  Selected:
                </span>
                <span className="text-xs font-medium text-foreground truncate max-w-xs bg-primary/10 px-2 py-0.5 rounded">
                  {selection.length > 80
                    ? selection.slice(0, 80) + "…"
                    : selection}
                </span>
              </>
            ) : (
              <span className="text-xs text-muted-foreground italic">
                No text selected — highlight text or click a box
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0 ml-4">
            <Button variant="ghost" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={!selection.trim()}
              onClick={() => onPick(selection.trim())}
            >
              <Crosshair className="h-3.5 w-3.5 mr-1.5" />
              Extract
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── OCR Text Preview ──────────────────────────────────────────────────────────

function OcrTextPreview({ docId }: { docId: string }) {
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    documentsApi.get(docId).then((doc) => {
      if (!cancelled) {
        const text: string = doc.ocrResult?.fullText ?? "";
        setPreview(text.slice(0, 220).replace(/\n+/g, " ").trim() || "—");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [docId]);

  if (preview === null)
    return (
      <span className="text-muted-foreground italic text-xs">loading…</span>
    );

  return (
    <span
      className="line-clamp-2"
      title={preview.length === 220 ? preview + "…" : preview}
    >
      {preview}
      {preview.length >= 220 && "…"}
    </span>
  );
}
