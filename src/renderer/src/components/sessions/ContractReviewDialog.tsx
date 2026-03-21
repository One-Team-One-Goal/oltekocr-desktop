import { useState, useEffect } from "react";
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
import { statusLabel, statusBadgeColor } from "@/lib/utils";
import { documentsApi } from "@/api/client";
import { CheckCircle2, XCircle, RotateCcw, AlertTriangle } from "lucide-react";
import type { DocumentRecord } from "@shared/types";

// ─── Contract data shapes ────────────────────────────────

interface ContractHeader {
  carrier: string;
  contractId: string;
  effectiveDate: string;
  expirationDate: string;
}

interface ContractRow {
  [key: string]: string;
}

interface ContractData {
  type: "CONTRACT";
  header: ContractHeader;
  rates: ContractRow[];
  originArbs: ContractRow[];
  destArbs: ContractRow[];
}

// ─── Column definitions ──────────────────────────────────

const RATE_COLS: { key: string; label: string; width?: string }[] = [
  { key: "point", label: "Point", width: "180px" },
  { key: "cntry", label: "Ctry", width: "50px" },
  { key: "term", label: "Term", width: "50px" },
  { key: "via", label: "Via", width: "120px" },
  { key: "type", label: "Type", width: "60px" },
  { key: "cur", label: "Cur", width: "50px" },
  { key: "20", label: "20'", width: "65px" },
  { key: "40", label: "40'", width: "65px" },
  { key: "40hc", label: "40HC", width: "65px" },
  { key: "45", label: "45'", width: "65px" },
  { key: "note", label: "Note", width: "50px" },
];

const ARB_COLS = RATE_COLS; // same layout for origin/dest arbitraries

// ─── Row renderer ────────────────────────────────────────

function ContractTable({
  rows,
  cols,
}: {
  rows: ContractRow[];
  cols: typeof RATE_COLS;
}) {
  if (rows.length === 0) {
    return (
      <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
        No records found
      </div>
    );
  }

  return (
    <div className="overflow-auto h-full">
      <table className="w-full text-xs border-collapse">
        <thead className="sticky top-0 z-10 bg-muted">
          <tr>
            {cols.map((col) => (
              <th
                key={col.key}
                className="px-2 py-1.5 text-left font-semibold border-b border-border whitespace-nowrap"
                style={{ minWidth: col.width }}
              >
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={i}
              className="odd:bg-background even:bg-muted/30 hover:bg-accent/30 transition-colors"
            >
              {cols.map((col) => (
                <td
                  key={col.key}
                  className="px-2 py-1 border-b border-border/50 whitespace-pre-wrap align-top"
                >
                  {row[col.key] ?? ""}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Dialog ──────────────────────────────────────────────

interface ContractReviewDialogProps {
  documentId: string | null;
  open: boolean;
  onClose: () => void;
  onRefresh: () => void;
}

export function ContractReviewDialog({
  documentId,
  open,
  onClose,
  onRefresh,
}: ContractReviewDialogProps) {
  const [doc, setDoc] = useState<DocumentRecord | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState("rates");

  useEffect(() => {
    if (documentId && open) {
      setLoading(true);
      documentsApi
        .get(documentId)
        .then((d) => setDoc(d))
        .catch(console.error)
        .finally(() => setLoading(false));
      setActiveTab("rates");
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

  // Parse contract data from extractedJson
  const contractData: ContractData | null = (() => {
    try {
      const raw = doc?.extractedJson as ContractData | undefined;
      if (raw?.type === "CONTRACT") return raw;
      return null;
    } catch {
      return null;
    }
  })();

  const header = contractData?.header;
  const rates = contractData?.rates ?? [];
  const originArbs = contractData?.originArbs ?? [];
  const destArbs = contractData?.destArbs ?? [];

  const canApprove =
    doc?.status === "REVIEW" || doc?.status === "REJECTED";
  const canReject = doc?.status === "REVIEW" || doc?.status === "APPROVED";

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-[95vw] max-h-[95vh] w-[95vw] h-[95vh] p-0 gap-0 flex flex-col">
        {/* Header */}
        <DialogHeader className="p-4 pb-2 flex-none">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 min-w-0">
              <DialogTitle className="text-lg truncate">
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
            {header && (
              <div className="flex items-center gap-4 text-xs text-muted-foreground shrink-0 ml-4">
                <span>
                  <span className="font-medium text-foreground">Contract:</span>{" "}
                  {header.contractId || "—"}
                </span>
                <span>
                  <span className="font-medium text-foreground">Carrier:</span>{" "}
                  {header.carrier}
                </span>
                {header.effectiveDate && (
                  <span>
                    <span className="font-medium text-foreground">Eff:</span>{" "}
                    {header.effectiveDate}
                  </span>
                )}
                {header.expirationDate && (
                  <span>
                    <span className="font-medium text-foreground">Exp:</span>{" "}
                    {header.expirationDate}
                  </span>
                )}
              </div>
            )}
          </div>
        </DialogHeader>

        <Separator />

        {loading ? (
          <div className="flex-1 flex items-center justify-center text-muted-foreground">
            Loading document...
          </div>
        ) : !contractData ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-muted-foreground">
            <AlertTriangle className="h-8 w-8" />
            <span className="text-sm">
              {doc?.status === "ERROR"
                ? "Extraction failed — reprocess to retry"
                : "No contract data available yet"}
            </span>
            <Button variant="outline" size="sm" onClick={handleReprocess}>
              <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
              Reprocess
            </Button>
          </div>
        ) : (
          <>
            {/* Record counts strip */}
            <div className="flex items-center gap-6 px-4 py-2 bg-muted/30 border-b text-xs shrink-0">
              <span>
                <span className="font-semibold text-foreground">
                  {rates.length}
                </span>{" "}
                rate rows
              </span>
              <span>
                <span className="font-semibold text-foreground">
                  {originArbs.length}
                </span>{" "}
                origin arb rows
              </span>
              <span>
                <span className="font-semibold text-foreground">
                  {destArbs.length}
                </span>{" "}
                dest arb rows
              </span>
            </div>

            {/* Tabs */}
            <Tabs
              value={activeTab}
              onValueChange={setActiveTab}
              className="flex-1 flex flex-col min-h-0"
            >
              <TabsList className="mx-4 mt-2 justify-start shrink-0">
                <TabsTrigger value="rates" className="text-xs">
                  Rates ({rates.length})
                </TabsTrigger>
                <TabsTrigger value="origin" className="text-xs">
                  Origin Arbitraries ({originArbs.length})
                </TabsTrigger>
                <TabsTrigger value="dest" className="text-xs">
                  Destination Arbitraries ({destArbs.length})
                </TabsTrigger>
              </TabsList>

              <TabsContent
                value="rates"
                className="flex-1 mt-0 p-4 min-h-0 overflow-hidden"
              >
                <ScrollArea className="h-full">
                  <ContractTable rows={rates} cols={RATE_COLS} />
                </ScrollArea>
              </TabsContent>

              <TabsContent
                value="origin"
                className="flex-1 mt-0 p-4 min-h-0 overflow-hidden"
              >
                <ScrollArea className="h-full">
                  <ContractTable rows={originArbs} cols={ARB_COLS} />
                </ScrollArea>
              </TabsContent>

              <TabsContent
                value="dest"
                className="flex-1 mt-0 p-4 min-h-0 overflow-hidden"
              >
                <ScrollArea className="h-full">
                  <ContractTable rows={destArbs} cols={ARB_COLS} />
                </ScrollArea>
              </TabsContent>
            </Tabs>
          </>
        )}

        <Separator />

        {/* Action footer */}
        <div className="flex items-center justify-between p-3 flex-none">
          <Button variant="outline" size="sm" onClick={handleReprocess}>
            <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
            Reprocess
          </Button>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={handleReject}
              disabled={!canReject}
            >
              <XCircle className="h-3.5 w-3.5 mr-1.5" />
              Reject
            </Button>
            <Button
              size="sm"
              className="bg-green-600 hover:bg-green-700 text-white"
              onClick={handleApprove}
              disabled={!canApprove}
            >
              <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
              Approve
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
