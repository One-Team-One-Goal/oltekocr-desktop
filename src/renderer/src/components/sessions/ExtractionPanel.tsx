import { useState, useEffect, useMemo } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { documentsApi } from "@/api/client";
import { statusLabel, statusBadgeColor } from "@/lib/utils";
import {
  CheckCircle2,
  XCircle,
  RotateCcw,
  AlertTriangle,
  Loader2,
  X,
  ChevronRight,
  ChevronDown,
  FileText,
} from "lucide-react";
import type { DocumentRecord } from "@shared/types";

// ─── Registry types ──────────────────────────────────────────────────────────
// To add support for a new document type:
//   1. Define a ColDef[] for its columns
//   2. Add an entry to DOC_TYPE_RENDERERS with the key matching extractedJson.type
//   3. Implement sections with getRows() and getHeaderFields()

interface ColDef {
  key: string;
  label: string;
  width?: string;
}

interface SectionDef {
  key: string;
  label: string;
  getRows: (data: Record<string, unknown>) => Record<string, string>[];
  /** Returns ColDef[] derived from the actual rows — no hardcoded columns. */
  getColumns: (rows: Record<string, string>[]) => ColDef[];
}

interface DocTypeRenderer {
  label: string;
  getHeaderFields: (
    data: Record<string, unknown>,
  ) => { label: string; value: string }[];
  sections: SectionDef[];
}

// ─── Dynamic column derivation ────────────────────────────────────────────────
// Known canonical key → display label + preferred width.
// Any key not listed here gets an auto-humanised label.

const KNOWN_COL_META: Record<string, { label: string; width?: string }> = {
  destinationCity:    { label: "Destination",   width: "160px" },
  destinationViaCity: { label: "Via City",       width: "130px" },
  originCity:         { label: "Origin",         width: "160px" },
  originViaCity:      { label: "Via City",       width: "130px" },
  baseRate20:         { label: "20'",            width: "60px"  },
  baseRate40:         { label: "40'",            width: "60px"  },
  baseRate40H:        { label: "40HC",           width: "60px"  },
  baseRate45:         { label: "45'",            width: "60px"  },
  agw20:              { label: "AGW 20'",        width: "65px"  },
  agw40:              { label: "AGW 40'",        width: "65px"  },
  agw45:              { label: "AGW 45'",        width: "65px"  },
  agw:                { label: "AGW",            width: "55px"  },
  amsChina:           { label: "AMS (CN/JP)",    width: "85px"  },
  heaHeavySurcharge:  { label: "HEA Heavy",      width: "75px"  },
  redSeaDiversion:    { label: "Red Sea Div.",   width: "80px"  },
  commodity:          { label: "Commodity",      width: "110px" },
  service:            { label: "Service",        width: "80px"  },
  remarks:            { label: "Remarks",        width: "130px" },
  scope:              { label: "Scope",          width: "80px"  },
  // origin context stamped from ORIGIN/ORIGIN VIA labels above each rate table
  origin:             { label: "Origin",         width: "220px" },
  originVia:          { label: "Origin Via",     width: "190px" },
  // short-form contract columns
  directCall:         { label: "Direct Call",    width: "75px"  },
  cntry:              { label: "Cntry",          width: "50px"  },
  cntry_2:            { label: "Via Cntry",      width: "50px"  },
};

/** Keys stamped on every row by the extractor — skip from column display. */
const SKIP_COL_KEYS = new Set([
  "carrier", "contractId", "effectiveDate", "expirationDate",
]);

/**
 * Build a ColDef list from the actual keys present in extracted rows.
 * Column order preserves insertion order (first-seen key wins).
 */
function colsFromRows(rows: Record<string, string>[]): ColDef[] {
  const seen = new Set<string>();
  const cols: ColDef[] = [];
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (seen.has(key) || SKIP_COL_KEYS.has(key)) continue;
      seen.add(key);
      const meta = KNOWN_COL_META[key];
      cols.push({
        key,
        label: meta?.label ?? key.replace(/([A-Z])/g, " $1").trim(),
        width: meta?.width,
      });
    }
  }
  return cols;
}

// ─── Document type renderer registry ─────────────────────────────────────────

const DOC_TYPE_RENDERERS: Record<string, DocTypeRenderer> = {
  CONTRACT: {
    label: "Contract",
    getHeaderFields: (data) => {
      const h = (data.header ?? {}) as Record<string, string>;
      return [
        { label: "Contract ID", value: h.contractId ?? "—" },
        { label: "Carrier", value: h.carrier ?? "—" },
        { label: "Effective", value: h.effectiveDate ?? "—" },
        { label: "Expires", value: h.expirationDate ?? "—" },
      ];
    },
    sections: [
      {
        key: "rates",
        label: "Rates",
        getRows: (d) => (d.rates as Record<string, string>[]) ?? [],
        getColumns: colsFromRows,
      },
      {
        key: "originArbs",
        label: "Origin Arbitraries",
        getRows: (d) => (d.originArbs as Record<string, string>[]) ?? [],
        getColumns: colsFromRows,
      },
      {
        key: "destArbs",
        label: "Destination Arbitraries",
        getRows: (d) => (d.destArbs as Record<string, string>[]) ?? [],
        getColumns: colsFromRows,
      },
    ],
  },
  // ── Future document types ───────────────────────────────────────────────────
  // Add new entries here as extraction support grows. Example:
  //
  // INVOICE: {
  //   label: "Invoice",
  //   getHeaderFields: (data) => [...],
  //   sections: [
  //     { key: "lineItems", label: "Line Items", getRows: (d) => d.lineItems as any[], columns: INVOICE_COLS },
  //   ],
  // },
};

// ─── Section table ────────────────────────────────────────────────────────────

function SectionTable({
  rows,
  cols,
}: {
  rows: Record<string, string>[];
  cols: ColDef[];
}) {
  if (cols.length === 0) {
    return (
      <div className="flex items-center justify-center h-10 text-muted-foreground text-xs italic px-4">
        No columns selected — check at least one column above.
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="flex items-center justify-center h-12 text-muted-foreground text-xs">
        No records
      </div>
    );
  }

  return (
    <table className="w-full text-xs border-collapse">
      <thead className="sticky top-0 bg-muted z-10 shadow-[0_1px_0_hsl(var(--border))]">
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
            className="odd:bg-background even:bg-muted/20 hover:bg-accent/20 transition-colors"
          >
            {cols.map((col) => (
              <td
                key={col.key}
                className="px-2 py-1 border-b border-border/40 whitespace-nowrap align-top text-[11px]"
              >
                {row[col.key] ?? ""}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface ExtractionViewProps {
  documentId: string;
  onClose: () => void;
  onRefresh?: () => void;
}

// ─── ExtractionView ───────────────────────────────────────────────────────────

export function ExtractionView({
  documentId,
  onClose,
  onRefresh,
}: ExtractionViewProps) {
  const [doc, setDoc] = useState<DocumentRecord | null>(null);
  const [loading, setLoading] = useState(false);
  // colVisibility[sectionKey][colKey] = visible
  const [colVisibility, setColVisibility] = useState<
    Record<string, Record<string, boolean>>
  >({});
  // sectionOpen[sectionKey] = expanded?
  const [sectionOpen, setSectionOpen] = useState<Record<string, boolean>>({});
  const [activeTab, setActiveTab] = useState<string>("");
  const [rawOpen, setRawOpen] = useState(false);
  const [rawTab, setRawTab] = useState<"text" | "json">("text");
  const [tablesOpen, setTablesOpen] = useState(false);
  const [tablesSection, setTablesSection] = useState("");
  // sectionCols[sectionKey] = derived ColDef[] from actual extracted rows
  const [sectionCols, setSectionCols] = useState<Record<string, ColDef[]>>({});

  // ── Fetch document ────────────────────────────────────────────────────────
  useEffect(() => {
    setLoading(true);
    documentsApi
      .get(documentId)
      .then(setDoc)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [documentId]);

  // ── Reset column visibility and active tab when document changes ──────────
  useEffect(() => {
    const data = doc?.extractedJson as Record<string, unknown> | undefined;
    const type = data?.type as string | undefined;
    const renderer = type ? DOC_TYPE_RENDERERS[type] : null;
    if (!renderer) {
      setColVisibility({});
      setSectionOpen({});
      setActiveTab("");
      return;
    }
    // Derive columns from actual extracted rows, then init visibility
    const initVis: Record<string, Record<string, boolean>> = {};
    const initOpen: Record<string, boolean> = {};
    const initCols: Record<string, ColDef[]> = {};
    for (const section of renderer.sections) {
      const rows = section.getRows(data as Record<string, unknown>);
      const cols = section.getColumns(rows);
      initCols[section.key] = cols;
      initVis[section.key] = {};
      initOpen[section.key] = true;
      for (const col of cols) {
        initVis[section.key][col.key] = true;
      }
    }
    setSectionCols(initCols);
    setColVisibility(initVis);
    setSectionOpen(initOpen);
    setActiveTab(renderer.sections[0]?.key ?? "");
  }, [doc?.id]);

  // ── Actions ───────────────────────────────────────────────────────────────
  const handleApprove = async () => {
    if (!doc) return;
    await documentsApi.approve(doc.id);
    onRefresh?.();
    documentsApi.get(doc.id).then(setDoc).catch(console.error);
  };

  const handleReject = async () => {
    if (!doc) return;
    const notes = prompt("Rejection reason (optional):");
    await documentsApi.reject(doc.id, notes || undefined);
    onRefresh?.();
    documentsApi.get(doc.id).then(setDoc).catch(console.error);
  };

  const handleReprocess = async () => {
    if (!doc) return;
    await documentsApi.reprocess(doc.id);
    onRefresh?.();
    documentsApi.get(doc.id).then(setDoc).catch(console.error);
  };

  // ── Derived ───────────────────────────────────────────────────────────────
  const extractedData = doc?.extractedJson as
    | Record<string, unknown>
    | undefined;
  const docType = extractedData?.type as string | undefined;
  const renderer = docType ? DOC_TYPE_RENDERERS[docType] : null;

  const canApprove = doc?.status === "REVIEW" || doc?.status === "REJECTED";
  const canReject = doc?.status === "REVIEW" || doc?.status === "APPROVED";

  const totalCheckedSlots = useMemo(
    () => Object.values(sectionCols).reduce((acc, cols) => acc + cols.length, 0),
    [sectionCols],
  );

  const checkedCount = useMemo(() => {
    let count = 0;
    for (const [sKey, cols] of Object.entries(sectionCols)) {
      for (const col of cols) {
        if (colVisibility[sKey]?.[col.key] !== false) count++;
      }
    }
    return count;
  }, [sectionCols, colVisibility]);

  const toggleCol = (sectionKey: string, colKey: string, visible: boolean) =>
    setColVisibility((prev) => ({
      ...prev,
      [sectionKey]: { ...prev[sectionKey], [colKey]: visible },
    }));

  const toggleSectionAll = (sectionKey: string, visible: boolean, cols: ColDef[]) => {
    const next: Record<string, boolean> = {};
    for (const col of cols) next[col.key] = visible;
    setColVisibility((prev) => ({ ...prev, [sectionKey]: next }));
  };

  const toggleAll = (visible: boolean) => {
    const next: Record<string, Record<string, boolean>> = {};
    for (const [sKey, cols] of Object.entries(sectionCols)) {
      next[sKey] = {};
      for (const col of cols) next[sKey][col.key] = visible;
    }
    setColVisibility(next);
  };

  const toggleSectionOpen = (key: string) =>
    setSectionOpen((prev) => ({ ...prev, [key]: !prev[key] }));

  return (
    <div className="flex flex-1 min-h-0 overflow-hidden">
      {/* ── Main table area ──────────────────────────────────────────────── */}
      <div className="flex flex-col flex-1 min-h-0 overflow-hidden">

        {/* Top bar: filename + status + actions */}
        <div className="flex items-center justify-between gap-3 px-4 py-2 border-b shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <p className="text-sm font-medium truncate" title={doc?.filename ?? ""}>
              {doc?.filename ?? "—"}
            </p>
            {doc && (
              <Badge
                className={`text-[10px] px-1.5 py-0 h-4 shrink-0 ${statusBadgeColor(doc.status)}`}
                variant="outline"
              >
                {statusLabel(doc.status)}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs gap-1"
              onClick={() => { setRawTab("text"); setRawOpen(true); }}
              title="Preview raw PyMuPDF output"
            >
              <FileText className="h-3 w-3" />
              Raw
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs gap-1"
              onClick={() => {
                if (renderer) setTablesSection(renderer.sections[0]?.key ?? "");
                setTablesOpen(true);
              }}
              title="Preview extracted tables per section"
              disabled={!renderer}
            >
              <FileText className="h-3 w-3" />
              Tables
            </Button>
            <Separator orientation="vertical" className="h-5" />
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs gap-1"
              onClick={handleReprocess}
            >
              <RotateCcw className="h-3 w-3" />
              Reprocess
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs gap-1 text-destructive hover:text-destructive"
              onClick={handleReject}
              disabled={!canReject}
            >
              <XCircle className="h-3 w-3" />
              Reject
            </Button>
            <Button
              size="sm"
              className="h-7 text-xs gap-1 bg-green-600 hover:bg-green-700 text-white"
              onClick={handleApprove}
              disabled={!canApprove}
            >
              <CheckCircle2 className="h-3 w-3" />
              Approve
            </Button>
            <Separator orientation="vertical" className="h-5" />
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              title="Back to document list"
              onClick={onClose}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        {/* Table content */}
        {loading ? (
          <div className="flex flex-1 items-center justify-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm">Loading…</span>
          </div>
        ) : !renderer ? (
          <div className="flex flex-col flex-1 items-center justify-center gap-3 text-muted-foreground">
            <AlertTriangle className="h-7 w-7" />
            <span className="text-xs text-center px-8">
              {doc?.status === "ERROR"
                ? "Extraction failed — use Reprocess to retry."
                : doc?.status === "QUEUED" ||
                    doc?.status === "PROCESSING" ||
                    doc?.status === "SCANNING"
                  ? "Processing in progress…"
                  : "No extracted data available yet."}
            </span>
          </div>
        ) : (
          <Tabs
            value={activeTab}
            onValueChange={setActiveTab}
            className="flex flex-col flex-1 min-h-0"
          >
            <TabsList className="mx-4 mt-2 mb-0 justify-start shrink-0 h-8">
              {renderer.sections.map((s) => {
                const rowCount = s.getRows(extractedData!).length;
                return (
                  <TabsTrigger key={s.key} value={s.key} className="text-xs h-7">
                    {s.label}
                    <span className="ml-1.5 text-[10px] text-muted-foreground">
                      ({rowCount})
                    </span>
                  </TabsTrigger>
                );
              })}
            </TabsList>
            {renderer.sections.map((s) => {
              const rows = s.getRows(extractedData!);
              const visibleCols = (sectionCols[s.key] ?? s.getColumns(rows)).filter(
                (c) => colVisibility[s.key]?.[c.key] !== false,
              );
              return (
                <TabsContent
                  key={s.key}
                  value={s.key}
                  className="flex-1 mt-2 overflow-hidden px-4 pb-4"
                >
                  <div className="overflow-x-scroll overflow-y-scroll h-full rounded-md border [&::-webkit-scrollbar]:h-3 [&::-webkit-scrollbar]:w-3 [&::-webkit-scrollbar-track]:bg-muted/30 [&::-webkit-scrollbar-thumb]:bg-border [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-corner]:bg-muted/30">
                    <SectionTable rows={rows} cols={visibleCols} />
                  </div>
                </TabsContent>
              );
            })}
          </Tabs>
        )}
      </div>

      {/* ── Right: column checkbox panel ─────────────────────────────────── */}
      <div className="w-52 shrink-0 border-l flex flex-col bg-card">
        {/* Contract header info */}
        {renderer && extractedData && (
          <div className="px-3 pt-3 pb-2.5 border-b space-y-2">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
              {renderer.label} Info
            </p>
            {renderer.getHeaderFields(extractedData).map((f) => (
              <div key={f.label} className="flex flex-col min-w-0">
                <span className="text-[10px] text-muted-foreground uppercase tracking-wide leading-tight">
                  {f.label}
                </span>
                <span className="text-xs font-medium truncate" title={f.value}>
                  {f.value}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Column visibility checkboxes — only for the active tab */}
        <ScrollArea className="flex-1">
          <div className="py-1">
            {renderer && activeTab ? (() => {
              const section = renderer.sections.find((s) => s.key === activeTab);
              const cols = section ? (sectionCols[activeTab] ?? []) : [];
              const sectionVis = colVisibility[activeTab] ?? {};
              const checkedCount = cols.filter((c) => sectionVis[c.key] !== false).length;
              const allChecked = checkedCount === cols.length;
              return (
                <div>
                  <div className="flex items-center justify-between px-3 pt-2 pb-1.5">
                    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
                      Columns
                    </p>
                    <button
                      className="text-[10px] text-muted-foreground hover:text-foreground underline underline-offset-2"
                      onClick={() => toggleSectionAll(activeTab, !allChecked, cols)}
                    >
                      {allChecked ? "Deselect all" : "Select all"}
                    </button>
                  </div>
                  <div className="px-3 pb-2 space-y-1.5">
                    {cols.map((col) => (
                      <label
                        key={col.key}
                        className="flex items-center gap-2 text-xs cursor-pointer select-none"
                      >
                        <Checkbox
                          checked={sectionVis[col.key] !== false}
                          onCheckedChange={(v) => toggleCol(activeTab, col.key, !!v)}
                          className="h-3.5 w-3.5"
                        />
                        {col.label}
                      </label>
                    ))}
                  </div>
                </div>
              );
            })() : !loading && (
              <p className="text-xs text-muted-foreground italic px-3 pt-2">
                No data loaded
              </p>
            )}
          </div>
        </ScrollArea>
      </div>

      {/* ── Tables preview dialog ─────────────────────────────────────────── */}
      {renderer && (
        <Dialog open={tablesOpen} onOpenChange={setTablesOpen}>
          <DialogContent className="max-w-5xl w-full h-[80vh] flex flex-col p-0 gap-0">
            <DialogHeader className="px-4 pt-4 pb-0 shrink-0">
              <DialogTitle className="text-sm font-semibold">
                Extracted Tables —{" "}
                <span className="text-muted-foreground font-normal">
                  {doc?.filename ?? ""}
                </span>
              </DialogTitle>
            </DialogHeader>

            {/* Section switcher buttons */}
            <div className="flex gap-0 border-b mt-3 px-4 shrink-0">
              {renderer.sections.map((s) => {
                const count = s.getRows(extractedData!).length;
                return (
                  <button
                    key={s.key}
                    onClick={() => setTablesSection(s.key)}
                    className={`px-3 py-1.5 text-xs font-medium border-b-2 -mb-px transition-colors ${
                      tablesSection === s.key
                        ? "border-primary text-foreground"
                        : "border-transparent text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {s.label}
                    <span className="ml-1.5 text-[10px] opacity-60">({count})</span>
                  </button>
                );
              })}
            </div>

            {/* Table content — all columns visible in this preview */}
            <ScrollArea className="flex-1 min-h-0">
              <div className="px-4 py-3">
                {renderer.sections
                  .filter((s) => s.key === tablesSection)
                  .map((s) => {
                    const rows = s.getRows(extractedData!);
                    return (
                      <div key={s.key}>
                        {rows.length === 0 ? (
                          <p className="text-xs text-muted-foreground italic py-4 text-center">
                            No rows extracted for this section. Reprocess the document if expected.
                          </p>
                        ) : (
                          <div className="overflow-x-scroll rounded-md border [&::-webkit-scrollbar]:h-3 [&::-webkit-scrollbar-track]:bg-muted/30 [&::-webkit-scrollbar-thumb]:bg-border [&::-webkit-scrollbar-thumb]:rounded-full">
                            <SectionTable rows={rows} cols={sectionCols[s.key] ?? s.getColumns(rows)} />
                          </div>
                        )}
                      </div>
                    );
                  })}
              </div>
            </ScrollArea>
          </DialogContent>
        </Dialog>
      )}

      {/* ── Raw preview dialog ────────────────────────────────────────────── */}
      <Dialog open={rawOpen} onOpenChange={setRawOpen}>
        <DialogContent className="max-w-4xl w-full h-[80vh] flex flex-col p-0 gap-0">
          <DialogHeader className="px-4 pt-4 pb-0 shrink-0">
            <DialogTitle className="text-sm font-semibold">
              Raw PyMuPDF Output —{" "}
              <span className="text-muted-foreground font-normal">
                {doc?.filename ?? ""}
              </span>
            </DialogTitle>
          </DialogHeader>

          {/* Tab switcher */}
          <div className="flex gap-0 border-b mt-3 px-4 shrink-0">
            {(["text", "json"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setRawTab(t)}
                className={`px-3 py-1.5 text-xs font-medium border-b-2 -mb-px transition-colors ${
                  rawTab === t
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {t === "text" ? "Full Text (per page)" : "Extracted JSON"}
              </button>
            ))}
          </div>

          {/* Content */}
          <ScrollArea className="flex-1 min-h-0">
            <div className="px-4 py-3">
              {rawTab === "text" ? (
                (() => {
                  const rawPages = (extractedData?.rawPages ?? []) as {
                    page: number;
                    text: string;
                  }[];
                  if (rawPages.length === 0) {
                    return (
                      <p className="text-xs text-muted-foreground italic">
                        No raw text available. Reprocess the document to
                        populate this field.
                      </p>
                    );
                  }
                  return (
                    <div className="space-y-4">
                      {rawPages.map(({ page, text }) => (
                        <div key={page}>
                          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                            Page {page}
                          </p>
                          <pre className="text-[11px] font-mono whitespace-pre-wrap bg-muted/40 rounded p-2.5 leading-relaxed">
                            {text || "(empty)"}
                          </pre>
                        </div>
                      ))}
                    </div>
                  );
                })()
              ) : (
                <pre className="text-[11px] font-mono whitespace-pre-wrap bg-muted/40 rounded p-2.5 leading-relaxed">
                  {JSON.stringify(
                    (() => {
                      // Omit rawPages from JSON view to keep it readable
                      if (!extractedData) return null;
                      const { rawPages: _, ...rest } = extractedData as Record<
                        string,
                        unknown
                      > & { rawPages?: unknown };
                      return rest;
                    })(),
                    null,
                    2,
                  )}
                </pre>
              )}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </div>
  );
}
