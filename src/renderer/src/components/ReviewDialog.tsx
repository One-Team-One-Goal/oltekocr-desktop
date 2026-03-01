import { useState, useEffect, useRef, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
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
} from "lucide-react";
import type { DocumentRecord, OcrResult, QualityCheck } from "@shared/types";

interface ReviewDialogProps {
  documentId: string | null;
  open: boolean;
  onClose: () => void;
  onRefresh: () => void;
}

export function ReviewDialog({
  documentId,
  open,
  onClose,
  onRefresh,
}: ReviewDialogProps) {
  const [doc, setDoc] = useState<DocumentRecord | null>(null);
  const [loading, setLoading] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [showOverlays, setShowOverlays] = useState(true);
  const [activeTab, setActiveTab] = useState("formatted");
  const imageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (documentId && open) {
      setLoading(true);
      documentsApi
        .get(documentId)
        .then((d) => setDoc(d))
        .catch(console.error)
        .finally(() => setLoading(false));
      setZoom(1);
      setRotation(0);
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
  const fitToView = () => {
    setZoom(1);
    setRotation(0);
  };

  // ocrResult and quality are nested objects on DocumentRecord
  const ocr: OcrResult | null = doc?.ocrResult ?? null;
  const quality: QualityCheck | null = doc?.quality ?? null;

  const imageUrl = doc
    ? `http://localhost:3847/api/documents/${doc.id}/image`
    : "";

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
          <div className="flex-1 flex overflow-hidden">
            {/* Left: Image Viewer */}
            <div className="w-1/2 flex flex-col border-r">
              {/* Image Toolbar */}
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

              {/* Image Area */}
              <div
                ref={imageRef}
                className="flex-1 overflow-auto bg-background/50 flex items-center justify-center"
              >
                {doc && (
                  <div className="relative inline-block">
                    <img
                      src={imageUrl}
                      alt={doc.filename}
                      className="max-w-none"
                      style={{
                        transform: `scale(${zoom}) rotate(${rotation}deg)`,
                        transformOrigin: "center center",
                        transition: "transform 0.2s ease",
                      }}
                      draggable={false}
                    />
                    {/* OCR Bounding Box Overlays */}
                    {showOverlays && ocr?.textBlocks && (
                      <div
                        className="absolute inset-0 pointer-events-none"
                        style={{
                          transform: `scale(${zoom}) rotate(${rotation}deg)`,
                          transformOrigin: "center center",
                        }}
                      >
                        {ocr.textBlocks.map((block, i) => (
                          <div
                            key={i}
                            className="absolute border"
                            style={{
                              left: block.bbox?.[0] ?? 0,
                              top: block.bbox?.[1] ?? 0,
                              width:
                                (block.bbox?.[2] ?? 0) - (block.bbox?.[0] ?? 0),
                              height:
                                (block.bbox?.[3] ?? 0) - (block.bbox?.[1] ?? 0),
                              borderColor:
                                block.confidence >= 90
                                  ? "rgba(34, 197, 94, 0.6)"
                                  : block.confidence >= 70
                                    ? "rgba(234, 179, 8, 0.6)"
                                    : "rgba(239, 68, 68, 0.6)",
                              backgroundColor:
                                block.confidence >= 90
                                  ? "rgba(34, 197, 94, 0.05)"
                                  : block.confidence >= 70
                                    ? "rgba(234, 179, 8, 0.05)"
                                    : "rgba(239, 68, 68, 0.05)",
                            }}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Right: OCR Data Tabs */}
            <div className="w-1/2 flex flex-col">
              <Tabs
                value={activeTab}
                onValueChange={setActiveTab}
                className="flex-1 flex flex-col"
              >
                <TabsList className="mx-2 mt-2 justify-start">
                  <TabsTrigger value="formatted" className="text-xs gap-1">
                    <FileText className="h-3 w-3" /> Formatted
                  </TabsTrigger>
                  <TabsTrigger value="raw" className="text-xs gap-1">
                    <Type className="h-3 w-3" /> Raw
                  </TabsTrigger>
                  <TabsTrigger value="tables" className="text-xs gap-1">
                    <Table className="h-3 w-3" /> Tables
                  </TabsTrigger>
                  <TabsTrigger value="quality" className="text-xs gap-1">
                    <BarChart3 className="h-3 w-3" /> Quality
                  </TabsTrigger>
                  <TabsTrigger value="extract" className="text-xs gap-1">
                    <Code2 className="h-3 w-3" /> Extract
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="formatted" className="flex-1 mt-0 p-0">
                  <ScrollArea className="h-full p-4">
                    {ocr?.textBlocks && ocr.textBlocks.length > 0 ? (
                      <div className="space-y-2 text-sm whitespace-pre-wrap">
                        {ocr.textBlocks.map((block, i) => (
                          <p key={i}>
                            <span
                              className={cn(
                                block.confidence < 70 &&
                                  "text-red-400 underline decoration-dotted",
                                block.confidence < 90 &&
                                  block.confidence >= 70 &&
                                  "text-amber-400",
                              )}
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
                  </ScrollArea>
                </TabsContent>

                <TabsContent value="raw" className="flex-1 mt-0 p-0">
                  <ScrollArea className="h-full p-4">
                    <pre className="text-xs font-mono whitespace-pre-wrap text-muted-foreground">
                      {ocr?.textBlocks?.map((b) => b.text).join("\n") ||
                        "No OCR text available."}
                    </pre>
                  </ScrollArea>
                </TabsContent>

                <TabsContent value="tables" className="flex-1 mt-0 p-0">
                  <ScrollArea className="h-full p-4">
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
                  </ScrollArea>
                </TabsContent>

                <TabsContent value="quality" className="flex-1 mt-0 p-0">
                  <ScrollArea className="h-full p-4">
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
                  </ScrollArea>
                </TabsContent>

                <TabsContent value="extract" className="flex-1 mt-0 p-0">
                  <ScrollArea className="h-full p-4">
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
                  </ScrollArea>
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
