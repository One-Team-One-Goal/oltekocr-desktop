import { documentsApi } from "@/api/client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
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
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
  const sessionColumns = session?.columns ?? [];
  const [detailDocId, setDetailDocId] = useState<string | null>(null);

  const columns = useMemo((): ColumnDef<DocumentListItem>[] => {
    const isPending = (doc: DocumentListItem) =>
      doc.status === "QUEUED" ||
      doc.status === "SCANNING" ||
      doc.status === "PROCESSING";

    const filenameCol: ColumnDef<DocumentListItem> = {
      accessorKey: "filename",
      header: "Filename",
      size: 160,
      cell: ({ row }) => (
        <div className="flex items-center gap-1.5 min-w-0">
          <span
            className="truncate text-xs font-medium min-w-0"
            title={row.original.filename}
          >
            {row.original.filename}
          </span>
          {isTableMode && !isPending(row.original) && (
            <Pencil className="h-3 w-3 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-60 transition-opacity" />
          )}
        </div>
      ),
    };

    if (isTableMode) {
      return [
        filenameCol,
        ...sessionColumns.map(
          (col): ColumnDef<DocumentListItem> => ({
            id: col.key,
            header: col.label,
            size: 160,
            cell: ({ row }) => {
              if (isPending(row.original)) {
                return (
                  <span className="text-muted-foreground italic text-xs">
                    pending…
                  </span>
                );
              }
              const cell = row.original.extractedRow?.[col.key];
              const answer = cell?.answer ?? "";
              const score = cell?.score ?? 0;
              if (answer.length > 0 && score > 0) {
                return (
                  <span className="flex items-center gap-1 min-w-0">
                    <span className="truncate text-xs" title={answer}>
                      {answer}
                    </span>
                    <span className="shrink-0 text-[10px] text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity">
                      {Math.round(score * 100)}%
                    </span>
                  </span>
                );
              }
              return <span className="text-muted-foreground text-xs">—</span>;
            },
          }),
        ),
      ];
    }

    // OCR mode
    return [
      filenameCol,
      {
        id: "textPreview",
        header: "Text Preview",
        cell: ({ row }) => {
          if (isPending(row.original)) {
            return (
              <span className="italic text-muted-foreground text-xs">
                pending…
              </span>
            );
          }
          if (row.original.ocrPageCount > 0) {
            return <OcrTextPreview docId={row.original.id} />;
          }
          return (
            <span className="text-muted-foreground text-xs">No OCR data</span>
          );
        },
      },
      {
        accessorKey: "ocrPageCount",
        header: "Pgs",
        size: 60,
        cell: ({ row }) => (
          <span className="font-mono text-xs block text-center">
            {row.original.ocrPageCount || "—"}
          </span>
        ),
      },
      {
        accessorKey: "ocrTableCount",
        header: "Tables",
        size: 72,
        cell: ({ row }) => (
          <span className="font-mono text-xs block text-center">
            {(row.original as any).ocrTableCount || "—"}
          </span>
        ),
      },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTableMode, sessionColumns]);

  const table = useReactTable({
    data: documents,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

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
          <table
            className="w-full caption-bottom text-sm"
            style={{ tableLayout: "fixed" }}
          >
            <colgroup>
              {table.getFlatHeaders().map((header) => (
                <col key={header.id} style={{ width: header.getSize() }} />
              ))}
            </colgroup>
            <TableHeader className="sticky top-0 bg-card z-10">
              {table.getHeaderGroups().map((hg) => (
                <TableRow
                  key={hg.id}
                  className="h-10 hover:bg-transparent divide-x divide-border"
                >
                  {hg.headers.map((header) => (
                    <TableHead
                      key={header.id}
                      className="py-2 text-xs font-medium text-muted-foreground overflow-hidden"
                    >
                      <span className="truncate block" title={header.id}>
                        {header.isPlaceholder
                          ? null
                          : flexRender(
                              header.column.columnDef.header,
                              header.getContext(),
                            )}
                      </span>
                    </TableHead>
                  ))}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {table.getRowModel().rows.map((row) => {
                const isSelected = row.original.id === selectedId;
                return (
                  <TableRow
                    key={row.id}
                    data-state={isSelected ? "selected" : undefined}
                    className="h-10 cursor-pointer divide-x divide-border group"
                    onClick={() => {
                      onSelectId(row.original.id);
                      if (isTableMode) setDetailDocId(row.original.id);
                    }}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <TableCell
                        key={cell.id}
                        className="py-2 text-xs overflow-hidden"
                      >
                        {flexRender(
                          cell.column.columnDef.cell,
                          cell.getContext(),
                        )}
                      </TableCell>
                    ))}
                  </TableRow>
                );
              })}
            </TableBody>
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
