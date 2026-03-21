import { useMemo, useState, useEffect } from "react";
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
import type { SchemaPresetTab } from "@/components/sessions/SchemaBuilderDialog";

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
  tabs?: { name: string; rows: ContractRow[] }[];
}

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

function colsFromSchema(fields: SchemaPresetTab["fields"]) {
  return fields.map((f: { fieldKey: string; label: string }) => ({
    key: f.fieldKey,
    label: f.fieldKey,
  }));
}

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

interface ContractReviewDialogProps {
  documentId: string | null;
  schemaTabs?: SchemaPresetTab[];
  open: boolean;
  onClose: () => void;
  onRefresh: () => void;
}

export function ContractReviewDialog({
  documentId,
  schemaTabs = [],
  open,
  onClose,
  onRefresh,
}: ContractReviewDialogProps) {
  const [doc, setDoc] = useState<DocumentRecord | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState("");

  useEffect(() => {
    if (documentId && open) {
      setLoading(true);
      documentsApi
        .get(documentId)
        .then((d) => setDoc(d))
        .catch(console.error)
        .finally(() => setLoading(false));
      setActiveTab("");
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
  const tableTabs = useMemo(() => {
    if (!contractData) return [] as { key: string; label: string; rows: ContractRow[] }[];

    const extractedTabs = Array.isArray(contractData.tabs) ? contractData.tabs : [];

    if (schemaTabs.length > 0) {
      const legacyByIndex: ContractRow[][] = [
        contractData.rates ?? [],
        contractData.originArbs ?? [],
        contractData.destArbs ?? [],
      ];

      return schemaTabs.map((schemaTab, idx) => {
        const byName = extractedTabs.find(
          (tab) => tab.name.trim().toLowerCase() === schemaTab.name.trim().toLowerCase(),
        );
        const byIndex = extractedTabs[idx];
        const rows = byName?.rows ?? byIndex?.rows ?? legacyByIndex[idx] ?? [];

        return {
          key: `schema_${idx}`,
          label: schemaTab.name,
          rows,
        };
      });
    }

    if (extractedTabs.length > 0) {
      return extractedTabs.map((tab, idx) => ({
        key: `tab_${idx}`,
        label: tab.name,
        rows: tab.rows ?? [],
      }));
    }

    return [
      { key: "rates", label: "Rates", rows: contractData.rates ?? [] },
      { key: "origin", label: "Origin Arbitraries", rows: contractData.originArbs ?? [] },
      { key: "dest", label: "Destination Arbitraries", rows: contractData.destArbs ?? [] },
    ];
  }, [contractData, schemaTabs]);

  const tabCols = useMemo(() => {
    const out: Record<string, typeof RATE_COLS> = {};
    for (const tab of tableTabs) {
      const schemaTab = schemaTabs.find(
        (t) => t.name.trim().toLowerCase() === tab.label.trim().toLowerCase(),
      );
      out[tab.key] =
        schemaTab && schemaTab.fields.length > 0
          ? (colsFromSchema(schemaTab.fields) as typeof RATE_COLS)
          : RATE_COLS;
    }
    return out;
  }, [tableTabs, schemaTabs]);

  useEffect(() => {
    if (tableTabs.length === 0) {
      setActiveTab("");
      return;
    }

    if (!tableTabs.some((t) => t.key === activeTab)) {
      setActiveTab(tableTabs[0].key);
    }
  }, [tableTabs, activeTab]);

  const canApprove = doc?.status === "REVIEW" || doc?.status === "REJECTED";
  const canReject = doc?.status === "REVIEW" || doc?.status === "APPROVED";

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-[95vw] max-h-[95vh] w-[95vw] h-[95vh] p-0 gap-0 flex flex-col">
        <DialogHeader className="p-4 pb-2 flex-none">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 min-w-0">
              <DialogTitle className="text-lg truncate">
                {doc?.filename || "Loading..."}
              </DialogTitle>
              {doc && (
                <Badge className={statusBadgeColor(doc.status)} variant="outline">
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
            <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col min-h-0">
              <TabsList className="mx-4 mt-2 justify-start shrink-0">
                {tableTabs.map((tab) => (
                  <TabsTrigger key={tab.key} value={tab.key} className="text-xs">
                    {tab.label} ({tab.rows.length})
                  </TabsTrigger>
                ))}
              </TabsList>

              {tableTabs.map((tab) => (
                <TabsContent key={tab.key} value={tab.key} className="flex-1 mt-0 p-4 min-h-0 overflow-hidden">
                  <ScrollArea className="h-full">
                    <ContractTable rows={tab.rows} cols={tabCols[tab.key] ?? RATE_COLS} />
                  </ScrollArea>
                </TabsContent>
              ))}
            </Tabs>
          </>
        )}

        <Separator />

        <div className="p-3 flex items-center justify-between shrink-0">
          <div className="text-xs text-muted-foreground">
            {doc?.status === "REVIEW"
              ? "Review extraction and approve or reject"
              : doc?.status === "APPROVED"
                ? "This document is approved"
                : doc?.status === "REJECTED"
                  ? "This document is rejected"
                  : ""}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleReprocess}>
              <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
              Reprocess
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={handleReject}
              disabled={!canReject}
            >
              <XCircle className="h-3.5 w-3.5 mr-1.5" />
              Reject
            </Button>
            <Button size="sm" onClick={handleApprove} disabled={!canApprove}>
              <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
              Approve
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
