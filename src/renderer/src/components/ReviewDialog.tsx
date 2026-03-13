import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import {
  statusLabel,
  statusBadgeColor,
  formatConfidence,
  formatTime,
  formatDate,
  cn,
} from "@/lib/utils";
import { documentsApi } from "@/api/client";
import {
  CheckCircle2,
  XCircle,
  RotateCcw,
  ZoomIn,
  ZoomOut,
  RotateCw,
  Maximize2,
  Eye,
  Type,
  Table,
  BarChart3,
  FileText,
  Code2,
  Braces,
} from "lucide-react";
import type {
  DocumentRecord,
  DocumentListItem,
  ExtractionType,
  OcrResult,
  QualityCheck,
  SessionRecord,
  TextBlock,
} from "@shared/types";

interface ReviewDialogProps {
  documentId: string | null;
  open: boolean;
  onClose: () => void;
  onRefresh: () => void;
  session?: SessionRecord | null;
  selectedDocument?: DocumentListItem | null;
}

type FieldOverlayMatch = {
  key: string;
  label: string;
  answer: string;
  score: number;
  bbox: [number, number, number, number];
  blockIndexes: number[];
  color: string;
  borderColor: string;
  fillColor: string;
};

const FIELD_OVERLAY_COLORS = [
  {
    color: "#3b82f6",
    borderColor: "rgba(59, 130, 246, 0.95)",
    fillColor: "rgba(59, 130, 246, 0.18)",
  },
  {
    color: "#ef4444",
    borderColor: "rgba(239, 68, 68, 0.95)",
    fillColor: "rgba(239, 68, 68, 0.18)",
  },
  {
    color: "#10b981",
    borderColor: "rgba(16, 185, 129, 0.95)",
    fillColor: "rgba(16, 185, 129, 0.18)",
  },
  {
    color: "#f59e0b",
    borderColor: "rgba(245, 158, 11, 0.95)",
    fillColor: "rgba(245, 158, 11, 0.18)",
  },
  {
    color: "#8b5cf6",
    borderColor: "rgba(139, 92, 246, 0.95)",
    fillColor: "rgba(139, 92, 246, 0.18)",
  },
  {
    color: "#ec4899",
    borderColor: "rgba(236, 72, 153, 0.95)",
    fillColor: "rgba(236, 72, 153, 0.18)",
  },
  {
    color: "#14b8a6",
    borderColor: "rgba(20, 184, 166, 0.95)",
    fillColor: "rgba(20, 184, 166, 0.18)",
  },
  {
    color: "#f97316",
    borderColor: "rgba(249, 115, 22, 0.95)",
    fillColor: "rgba(249, 115, 22, 0.18)",
  },
];

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function normalizeLooseText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function mergeBboxes(
  blocks: Array<TextBlock & { matchIndex: number }>,
): [number, number, number, number] | null {
  const boxes = blocks.map((block) => block.bbox).filter(Boolean) as Array<
    [number, number, number, number]
  >;
  if (boxes.length === 0) return null;
  return [
    Math.min(...boxes.map((box) => box[0])),
    Math.min(...boxes.map((box) => box[1])),
    Math.max(...boxes.map((box) => box[2])),
    Math.max(...boxes.map((box) => box[3])),
  ];
}

function findBestFieldMatch(
  blocks: TextBlock[],
  answer: string,
): { bbox: [number, number, number, number]; blockIndexes: number[] } | null {
  const trimmed = answer.trim();
  if (!trimmed) return null;

  const target = normalizeText(trimmed);
  const targetLoose = normalizeLooseText(trimmed);
  if (!targetLoose) return null;

  let bestMatch: {
    bbox: [number, number, number, number];
    blockIndexes: number[];
    score: number;
  } | null = null;

  for (let start = 0; start < blocks.length; start += 1) {
    const startBlock = blocks[start];
    if (!startBlock?.bbox) continue;

    const candidateBlocks: Array<TextBlock & { matchIndex: number }> = [];
    for (let end = start; end < Math.min(blocks.length, start + 6); end += 1) {
      const block = blocks[end];
      if (block.page !== startBlock.page) break;
      candidateBlocks.push({ ...block, matchIndex: end });

      const mergedBox = mergeBboxes(candidateBlocks);
      if (!mergedBox) continue;

      const combinedText = candidateBlocks.map((item) => item.text).join(" ");
      const normalized = normalizeText(combinedText);
      const normalizedLoose = normalizeLooseText(combinedText);

      let score = -1;
      if (normalizedLoose === targetLoose || normalized === target) {
        score = 1000 - candidateBlocks.length;
      } else if (
        normalizedLoose.includes(targetLoose) ||
        normalized.includes(target)
      ) {
        score = 850 - candidateBlocks.length;
      } else if (
        targetLoose.includes(normalizedLoose) &&
        normalizedLoose.length >= Math.min(10, targetLoose.length)
      ) {
        score = 700 - candidateBlocks.length;
      }

      if (score > (bestMatch?.score ?? -1)) {
        bestMatch = {
          bbox: mergedBox,
          blockIndexes: candidateBlocks.map((item) => item.matchIndex),
          score,
        };
      }
    }
  }

  return bestMatch
    ? { bbox: bestMatch.bbox, blockIndexes: bestMatch.blockIndexes }
    : null;
}

/** True when extraction type is a PDF pipeline */
function isPdfType(t: ExtractionType | string | undefined): boolean {
  return t === "PDF_TEXT" || t === "PDF_IMAGE";
}

/** True when extraction type is image-based (OCR) */
function isImageType(t: ExtractionType | string | undefined): boolean {
  return !t || t === "IMAGE" || t === "AUTO" || t === "PDF_IMAGE";
}

export function ReviewDialog({
  documentId,
  open,
  onClose,
  onRefresh,
  session,
  selectedDocument,
}: ReviewDialogProps) {
  const [doc, setDoc] = useState<DocumentRecord | null>(null);
  const [loading, setLoading] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [showOverlays, setShowOverlays] = useState(true);
  const [activeTab, setActiveTab] = useState("formatted");
  const [activeFieldKey, setActiveFieldKey] = useState<string | null>(null);
  const viewerRef = useRef<HTMLDivElement>(null);
  const imageElRef = useRef<HTMLImageElement>(null);
  const panStartRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (documentId && open) {
      setLoading(true);
      documentsApi
        .get(documentId)
        .then((d) => {
          setDoc(d);
          // Default tab: JSON for PDFs, formatted for images
          if (isPdfType(d.extractionType)) {
            setActiveTab("json");
          } else {
            setActiveTab("formatted");
          }
        })
        .catch(console.error)
        .finally(() => setLoading(false));
      setZoom(1);
      setRotation(0);
      setPan({ x: 0, y: 0 });
      setActiveFieldKey(null);
    }
  }, [documentId, open]);

  const handleApprove = async () => {
    if (!doc) return;
    await documentsApi.approve(doc.id);
    onRefresh();
    onClose();
  };

  const handleReject = async () => {
    if (!doc) return;
    const notes = prompt("Rejection reason (optional):");
    await documentsApi.reject(doc.id, notes || undefined);
    onRefresh();
    onClose();
  };

  const handleReprocess = async () => {
    if (!doc) return;
    await documentsApi.reprocess(doc.id);
    onRefresh();
    onClose();
  };

  const zoomIn = () => setZoom((z) => Math.min(z + 0.25, 5));
  const zoomOut = () => setZoom((z) => Math.max(z - 0.25, 0.25));
  const rotate = () => setRotation((r) => (r + 90) % 360);
  const fitToView = useCallback(() => {
    const viewer = viewerRef.current;
    const image = imageElRef.current;
    if (!viewer || !image) {
      setZoom(1);
      setRotation(0);
      setPan({ x: 0, y: 0 });
      return;
    }

    const viewerPadding = 24;
    const availableWidth = Math.max(viewer.clientWidth - viewerPadding, 1);
    const availableHeight = Math.max(viewer.clientHeight - viewerPadding, 1);
    const naturalWidth = Math.max(image.naturalWidth, 1);
    const naturalHeight = Math.max(image.naturalHeight, 1);
    const fitZoom = Math.min(
      availableWidth / naturalWidth,
      availableHeight / naturalHeight,
      5,
    );

    setZoom(Math.max(fitZoom, 0.1));
    setRotation(0);
    setPan({ x: 0, y: 0 });
  }, []);

  const onImageLoad = useCallback(() => {
    fitToView();
  }, [fitToView]);

  const startPanning = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 2) return;
    e.preventDefault();
    setIsPanning(true);
    panStartRef.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
  };

  const onPanMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isPanning || !panStartRef.current) return;
    e.preventDefault();
    setPan({
      x: e.clientX - panStartRef.current.x,
      y: e.clientY - panStartRef.current.y,
    });
  };

  const stopPanning = () => {
    setIsPanning(false);
    panStartRef.current = null;
  };

  const onViewerWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (!isImage) return;
    e.preventDefault();
    const delta = e.deltaY < 0 ? 0.1 : -0.1;
    setZoom((z) => Math.max(0.1, Math.min(5, z + delta)));
  };

  const ocr: OcrResult | null = doc?.ocrResult ?? null;
  const quality: QualityCheck | null = doc?.quality ?? null;
  const extType = doc?.extractionType;
  const isPdf = isPdfType(extType);
  const isImage = isImageType(extType);
  const extractedRow = selectedDocument?.extractedRow ?? null;

  const fieldMatches = useMemo<FieldOverlayMatch[]>(() => {
    if (
      !isImage ||
      !ocr?.textBlocks ||
      !session?.columns?.length ||
      !extractedRow
    ) {
      return [];
    }

    return session.columns
      .map((column, index) => {
        const extracted = extractedRow[column.key];
        const answer = extracted?.answer?.trim();
        if (!answer) return null;

        const match = findBestFieldMatch(ocr.textBlocks, answer);
        if (!match) return null;

        const palette =
          FIELD_OVERLAY_COLORS[index % FIELD_OVERLAY_COLORS.length];
        return {
          key: column.key,
          label: column.label,
          answer,
          score: extracted.score,
          bbox: match.bbox,
          blockIndexes: match.blockIndexes,
          color: palette.color,
          borderColor: palette.borderColor,
          fillColor: palette.fillColor,
        };
      })
      .filter((match): match is FieldOverlayMatch => match !== null);
  }, [extractedRow, isImage, ocr?.textBlocks, session?.columns]);

  const blockFieldLookup = useMemo(() => {
    const lookup = new Map<number, FieldOverlayMatch>();
    fieldMatches.forEach((match) => {
      match.blockIndexes.forEach((blockIndex) => {
        if (!lookup.has(blockIndex)) {
          lookup.set(blockIndex, match);
        }
      });
    });
    return lookup;
  }, [fieldMatches]);

  useEffect(() => {
    if (fieldMatches.length === 0) {
      setActiveFieldKey(null);
      return;
    }
    setActiveFieldKey((current) =>
      current && fieldMatches.some((match) => match.key === current)
        ? current
        : fieldMatches[0].key,
    );
  }, [fieldMatches]);

  const imageUrl = doc
    ? `http://localhost:3847/api/documents/${doc.id}/image`
    : "";

  const focusFieldMatch = useCallback(
    (match: FieldOverlayMatch) => {
      const image = imageElRef.current;
      if (!image) return;

      const centerX = (match.bbox[0] + match.bbox[2]) / 2;
      const centerY = (match.bbox[1] + match.bbox[3]) / 2;
      const offsetX = centerX - image.naturalWidth / 2;
      const offsetY = centerY - image.naturalHeight / 2;
      const radians = (rotation * Math.PI) / 180;
      const rotatedX =
        offsetX * Math.cos(radians) - offsetY * Math.sin(radians);
      const rotatedY =
        offsetX * Math.sin(radians) + offsetY * Math.cos(radians);

      setActiveFieldKey(match.key);
      setShowOverlays(true);
      setPan({
        x: -rotatedX * zoom,
        y: -rotatedY * zoom,
      });
    },
    [rotation, zoom],
  );

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-[95vw] max-h-[95vh] w-[95vw] h-[95vh] p-0 gap-0 flex flex-col">
        {/* Header */}
        <DialogHeader className="p-4 pb-2 flex-none">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <DialogTitle className="text-lg">
                {doc?.filename || "Loading..."}
              </DialogTitle>
              {doc && (
                <Badge
                  className={statusBadgeColor(doc.status)}
                  variant="outline"
                >
                  {statusLabel(doc.status)}
                </Badge>
              )}
              {doc && extType && (
                <Badge variant="outline" className="text-xs font-normal">
                  {extType === "PDF_TEXT"
                    ? "PDF (Text)"
                    : extType === "PDF_IMAGE"
                      ? "PDF (Scanned)"
                      : extType === "IMAGE"
                        ? "Image"
                        : extType === "EXCEL"
                          ? "Excel"
                          : extType}
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              {doc && <span>Scanned: {formatDate(doc.createdAt)}</span>}
            </div>
          </div>
        </DialogHeader>

        <Separator />

        {loading ? (
          <div className="flex-1 flex items-center justify-center text-muted-foreground">
            Loading document...
          </div>
        ) : (
          <div className="flex-1 flex overflow-hidden min-h-0">
            {/* Left: Document Viewer */}
            <div className="w-1/2 flex flex-col border-r min-h-0">
              {isPdf ? (
                /* ── PDF Viewer ─────────────────────────── */
                <>
                  <div className="flex items-center gap-1 p-2 border-b bg-muted/30">
                    <span className="text-xs text-muted-foreground">
                      PDF Preview
                    </span>
                  </div>
                  <div className="flex-1 min-h-0 bg-background/50">
                    <iframe
                      src={imageUrl}
                      className="w-full h-full border-0"
                      title={doc?.filename ?? "PDF preview"}
                    />
                  </div>
                </>
              ) : (
                /* ── Image Viewer ───────────────────────── */
                <>
                  <div className="flex items-center gap-1 p-2 border-b bg-muted/30">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={zoomIn}
                    >
                      <ZoomIn className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={zoomOut}
                    >
                      <ZoomOut className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={rotate}
                    >
                      <RotateCw className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={fitToView}
                    >
                      <Maximize2 className="h-4 w-4" />
                    </Button>
                    <Separator orientation="vertical" className="mx-1 h-5" />
                    <Button
                      variant={showOverlays ? "secondary" : "ghost"}
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => setShowOverlays(!showOverlays)}
                    >
                      <Eye className="h-3 w-3 mr-1" />
                      Overlays
                    </Button>
                    <span className="ml-auto text-xs text-muted-foreground">
                      {Math.round(zoom * 100)}%
                    </span>
                  </div>
                  <div
                    ref={viewerRef}
                    className={cn(
                      "relative flex-1 overflow-hidden bg-background/50",
                      isPanning ? "cursor-grabbing" : "cursor-default",
                    )}
                    onMouseDown={startPanning}
                    onMouseMove={onPanMove}
                    onMouseUp={stopPanning}
                    onMouseLeave={stopPanning}
                    onContextMenu={(e) => {
                      if (isPanning) {
                        e.preventDefault();
                      }
                    }}
                    onWheel={onViewerWheel}
                  >
                    {fieldMatches.length > 0 && (
                      <div className="absolute left-3 top-3 z-10 max-h-[calc(100%-1.5rem)] overflow-auto">
                        <div className="space-y-1">
                          {fieldMatches.map((match) => {
                            const isActive = match.key === activeFieldKey;
                            return (
                              <button
                                key={match.key}
                                type="button"
                                className={cn(
                                  "flex w-full items-start gap-2 rounded-lg p-1 text-left transition-colors",
                                  isActive
                                    ? "text-foreground"
                                    : "hover:bg-muted/60 text-muted-foreground hover:text-foreground",
                                )}
                                onClick={() => focusFieldMatch(match)}
                              >
                                <span
                                  className="mt-1 h-3 w-3 shrink-0 rounded-full"
                                  style={{ backgroundColor: match.color }}
                                />
                                <span className="min-w-0 truncate text-xs font-medium">
                                  {match.label}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                    {doc && (
                      <div className="absolute inset-0 overflow-hidden select-none">
                        <div
                          className="absolute left-1/2 top-1/2"
                          style={{
                            transform: `translate(${pan.x}px, ${pan.y}px)`,
                            transition: isPanning
                              ? "none"
                              : "transform 0.15s ease-out",
                          }}
                        >
                          <div
                            className="relative"
                            style={{
                              transform: `translate(-50%, -50%) scale(${zoom}) rotate(${rotation}deg)`,
                              transformOrigin: "center center",
                              transition: isPanning
                                ? "none"
                                : "transform 0.2s ease",
                            }}
                          >
                            <img
                              ref={imageElRef}
                              src={imageUrl}
                              alt={doc.filename}
                              className="max-w-none"
                              onLoad={onImageLoad}
                              draggable={false}
                            />
                            {showOverlays && ocr?.textBlocks && (
                              <div className="absolute inset-0 pointer-events-none">
                                {ocr.textBlocks.map((block, i) => (
                                  <div
                                    key={i}
                                    className="absolute border"
                                    data-block-index={i}
                                    style={{
                                      left: block.bbox?.[0] ?? 0,
                                      top: block.bbox?.[1] ?? 0,
                                      width:
                                        (block.bbox?.[2] ?? 0) -
                                        (block.bbox?.[0] ?? 0),
                                      height:
                                        (block.bbox?.[3] ?? 0) -
                                        (block.bbox?.[1] ?? 0),
                                      borderColor: blockFieldLookup.has(i)
                                        ? blockFieldLookup.get(i)?.borderColor
                                        : block.confidence >= 90
                                          ? "rgba(34, 197, 94, 0.35)"
                                          : block.confidence >= 70
                                            ? "rgba(234, 179, 8, 0.35)"
                                            : "rgba(239, 68, 68, 0.35)",
                                      backgroundColor: blockFieldLookup.has(i)
                                        ? blockFieldLookup.get(i)?.fillColor
                                        : block.confidence >= 90
                                          ? "rgba(34, 197, 94, 0.03)"
                                          : block.confidence >= 70
                                            ? "rgba(234, 179, 8, 0.03)"
                                            : "rgba(239, 68, 68, 0.03)",
                                    }}
                                  />
                                ))}
                                {fieldMatches.map((match) => {
                                  const isActive = match.key === activeFieldKey;
                                  return (
                                    <div
                                      key={match.key}
                                      className="absolute rounded-md border-2"
                                      style={{
                                        left: match.bbox[0],
                                        top: match.bbox[1],
                                        width: match.bbox[2] - match.bbox[0],
                                        height: match.bbox[3] - match.bbox[1],
                                        borderColor: match.borderColor,
                                        backgroundColor: match.fillColor,
                                        boxShadow: isActive
                                          ? `0 0 0 2px ${match.fillColor}, 0 0 18px ${match.fillColor}`
                                          : undefined,
                                      }}
                                    >
                                      <div
                                        className="absolute -top-6 left-0 rounded-md px-2 py-0.5 text-[10px] font-medium text-white shadow-sm"
                                        style={{ backgroundColor: match.color }}
                                      >
                                        {match.label}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>

            {/* Right: OCR / Extraction Data Tabs */}
            <div className="w-1/2 flex flex-col min-h-0">
              <Tabs
                value={activeTab}
                onValueChange={setActiveTab}
                className="flex-1 flex flex-col min-h-0"
              >
                <TabsList className="mx-2 mt-2 justify-start">
                  {isPdf ? (
                    /* PDF tab order: JSON first */
                    <>
                      <TabsTrigger value="json" className="text-xs gap-1">
                        <Braces className="h-3 w-3" /> JSON
                      </TabsTrigger>
                      <TabsTrigger value="formatted" className="text-xs gap-1">
                        <FileText className="h-3 w-3" /> Formatted
                      </TabsTrigger>
                      <TabsTrigger value="raw" className="text-xs gap-1">
                        <Type className="h-3 w-3" /> Raw
                      </TabsTrigger>
                      <TabsTrigger value="tables" className="text-xs gap-1">
                        <Table className="h-3 w-3" /> Tables
                      </TabsTrigger>
                    </>
                  ) : (
                    /* Image tab order: Formatted first */
                    <>
                      <TabsTrigger value="formatted" className="text-xs gap-1">
                        <FileText className="h-3 w-3" /> Formatted
                      </TabsTrigger>
                      <TabsTrigger value="raw" className="text-xs gap-1">
                        <Type className="h-3 w-3" /> Raw
                      </TabsTrigger>
                      <TabsTrigger value="tables" className="text-xs gap-1">
                        <Table className="h-3 w-3" /> Tables
                      </TabsTrigger>
                      <TabsTrigger value="json" className="text-xs gap-1">
                        <Braces className="h-3 w-3" /> JSON
                      </TabsTrigger>
                    </>
                  )}
                  <TabsTrigger value="quality" className="text-xs gap-1">
                    <BarChart3 className="h-3 w-3" /> Quality
                  </TabsTrigger>
                  <TabsTrigger value="extract" className="text-xs gap-1">
                    <Code2 className="h-3 w-3" /> Extract
                  </TabsTrigger>
                </TabsList>

                {/* ── JSON Tab ─────────────────────────────── */}
                <TabsContent
                  value="json"
                  className="flex-1 mt-0 p-0 overflow-hidden min-h-0"
                >
                  <div className="h-full overflow-auto p-4">
                    {ocr ? (
                      <pre className="text-xs font-mono whitespace-pre-wrap">
                        {JSON.stringify(ocr, null, 2)}
                      </pre>
                    ) : (
                      <p className="text-muted-foreground">
                        No JSON data available. Process the document first.
                      </p>
                    )}
                  </div>
                </TabsContent>

                {/* ── Formatted Tab ────────────────────────── */}
                <TabsContent
                  value="formatted"
                  className="flex-1 mt-0 p-0 overflow-hidden min-h-0"
                >
                  <div className="h-full overflow-auto p-4">
                    {ocr?.textBlocks && ocr.textBlocks.length > 0 ? (
                      <div className="space-y-2 text-sm whitespace-pre-wrap">
                        {ocr.textBlocks.map((block, i) => (
                          <p key={i}>
                            <span
                              className={cn(
                                blockFieldLookup.has(i) && "font-medium",
                                block.confidence < 70 &&
                                  "text-red-400 underline decoration-dotted",
                                block.confidence < 90 &&
                                  block.confidence >= 70 &&
                                  "text-amber-400",
                              )}
                              style={
                                blockFieldLookup.has(i)
                                  ? {
                                      color: blockFieldLookup.get(i)?.color,
                                    }
                                  : undefined
                              }
                            >
                              {block.text}
                            </span>
                          </p>
                        ))}
                      </div>
                    ) : (
                      <p className="text-muted-foreground">
                        No OCR text available.
                      </p>
                    )}
                  </div>
                </TabsContent>

                {/* ── Raw Tab ──────────────────────────────── */}
                <TabsContent
                  value="raw"
                  className="flex-1 mt-0 p-0 overflow-hidden min-h-0"
                >
                  <div className="h-full overflow-auto p-4">
                    <pre className="text-xs font-mono whitespace-pre-wrap text-muted-foreground">
                      {ocr?.textBlocks?.map((b) => b.text).join("\n") ||
                        "No OCR text available."}
                    </pre>
                  </div>
                </TabsContent>

                {/* ── Tables Tab ───────────────────────────── */}
                <TabsContent
                  value="tables"
                  className="flex-1 mt-0 p-0 overflow-hidden min-h-0"
                >
                  <div className="h-full overflow-auto p-4">
                    {ocr?.tables && ocr.tables.length > 0 ? (
                      <div className="space-y-6">
                        {ocr.tables.map((table, ti) => (
                          <div key={ti} className="space-y-2">
                            <h4 className="text-sm font-medium">
                              Table {ti + 1}
                            </h4>
                            <div className="overflow-auto rounded-md border">
                              <table className="text-xs w-full">
                                <tbody>
                                  {Array.from({ length: table.rows }).map(
                                    (_, ri) => (
                                      <tr
                                        key={ri}
                                        className="border-b last:border-0"
                                      >
                                        {table.cells
                                          .filter((c) => c.row === ri)
                                          .sort((a, b) => a.col - b.col)
                                          .map((cell, ci) => (
                                            <td
                                              key={ci}
                                              className="p-1.5 border-r last:border-0"
                                              colSpan={cell.colSpan || 1}
                                              rowSpan={cell.rowSpan || 1}
                                            >
                                              {cell.text}
                                            </td>
                                          ))}
                                      </tr>
                                    ),
                                  )}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-muted-foreground">
                        No tables detected.
                      </p>
                    )}
                  </div>
                </TabsContent>

                {/* ── Quality Tab ──────────────────────────── */}
                <TabsContent
                  value="quality"
                  className="flex-1 mt-0 p-0 overflow-hidden min-h-0"
                >
                  <div className="h-full overflow-auto p-4">
                    {quality ? (
                      <div className="space-y-4">
                        <div className="grid grid-cols-2 gap-3">
                          <MetricCard label="DPI" value={quality.dpi} />
                          <MetricCard
                            label="Width"
                            value={`${quality.width}px`}
                          />
                          <MetricCard
                            label="Height"
                            value={`${quality.height}px`}
                          />
                          <MetricCard
                            label="Blur Score"
                            value={quality.blurScore.toFixed(1)}
                          />
                          <MetricCard
                            label="Blurry"
                            value={quality.isBlurry ? "Yes" : "No"}
                          />
                          <MetricCard
                            label="Skewed"
                            value={
                              quality.isSkewed
                                ? `Yes (${quality.skewAngle.toFixed(1)}°)`
                                : "No"
                            }
                          />
                        </div>
                        {quality.issues.length > 0 && (
                          <div className="space-y-2">
                            <h4 className="text-sm font-medium text-amber-400">
                              Issues
                            </h4>
                            <ul className="list-disc list-inside text-xs text-muted-foreground space-y-1">
                              {quality.issues.map((issue, i) => (
                                <li key={i}>{issue}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {ocr && (
                          <div className="space-y-2 border-t pt-4">
                            <h4 className="text-sm font-medium">OCR Metrics</h4>
                            <div className="grid grid-cols-2 gap-3">
                              <MetricCard
                                label="Avg Confidence"
                                value={formatConfidence(ocr.avgConfidence)}
                              />
                              <MetricCard
                                label="Processing Time"
                                value={formatTime(ocr.processingTime)}
                              />
                              <MetricCard label="Pages" value={ocr.pageCount} />
                            </div>
                          </div>
                        )}
                      </div>
                    ) : (
                      <p className="text-muted-foreground">
                        No quality data available.
                      </p>
                    )}
                  </div>
                </TabsContent>

                {/* ── Extract Tab ──────────────────────────── */}
                <TabsContent
                  value="extract"
                  className="flex-1 mt-0 p-0 overflow-hidden min-h-0"
                >
                  <div className="h-full overflow-auto p-4">
                    {doc?.extractedJson &&
                    Object.keys(doc.extractedJson).length > 0 ? (
                      <pre className="text-xs font-mono whitespace-pre-wrap">
                        {JSON.stringify(doc.extractedJson, null, 2)}
                      </pre>
                    ) : (
                      <div className="text-muted-foreground space-y-2">
                        <p>No extracted data available.</p>
                        <p className="text-xs">
                          Data extraction will be available when the LLM
                          integration is configured.
                        </p>
                      </div>
                    )}
                  </div>
                </TabsContent>
              </Tabs>
            </div>
          </div>
        )}

        {/* Footer: Action Buttons */}
        <Separator />
        <div className="flex items-center justify-between p-4 flex-none">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {ocr && (
              <>
                <span>Confidence: {formatConfidence(ocr.avgConfidence)}</span>
                <span>·</span>
                <span>{ocr.textBlocks.length} blocks</span>
                <span>·</span>
                <span>{ocr.tables.length} tables</span>
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={onClose}>
              Close
            </Button>
            <Button
              variant="outline"
              className="text-amber-400 border-amber-400/30 hover:bg-amber-400/10"
              onClick={handleReprocess}
            >
              <RotateCcw className="h-4 w-4 mr-1" />
              Reprocess
            </Button>
            <Button
              variant="outline"
              className="text-red-400 border-red-400/30 hover:bg-red-400/10"
              onClick={handleReject}
            >
              <XCircle className="h-4 w-4 mr-1" />
              Reject
            </Button>
            <Button
              className="bg-green-600 hover:bg-green-700 text-white"
              onClick={handleApprove}
            >
              <CheckCircle2 className="h-4 w-4 mr-1" />
              Approve
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Metric Card ──────────────────────────────────────────────────────────────

function MetricCard({
  label,
  value,
  className,
}: {
  label: string;
  value: string | number;
  className?: string;
}) {
  return (
    <div className={cn("rounded-md border p-3", className)}>
      <p className="text-[10px] text-muted-foreground uppercase tracking-wide">
        {label}
      </p>
      <p className="text-sm font-medium mt-0.5">{value}</p>
    </div>
  );
}
