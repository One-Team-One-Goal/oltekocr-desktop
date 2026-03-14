import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FileText,
  Filter as Funnel,
  ListFilter,
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

type FilterLogic = "AND" | "OR";
type FilterOp =
  | "contains"
  | "equals"
  | "startsWith"
  | "gt"
  | "lt"
  | "between"
  | "in";

interface FilterClause {
  id: string;
  field: string;
  op: FilterOp;
  value: string;
  valueTo?: string;
  enabled: boolean;
}

interface HeaderColumnFilter {
  op: Extract<
    FilterOp,
    "contains" | "equals" | "startsWith" | "gt" | "lt" | "between"
  >;
  value: string;
  valueTo?: string;
}

interface QuickFilters {
  usdOnly: boolean;
  hasOrigin: boolean;
  hasViaCity: boolean;
  directCallOnly: boolean;
  hasDestination: boolean;
}

interface SavedFilterView {
  id: string;
  name: string;
  activeTab: string;
  searchText: string;
  quickFilters: QuickFilters;
  logic: FilterLogic;
  clauses: FilterClause[];
  headerFilters: Record<string, HeaderColumnFilter>;
  sortKey: string;
  sortDir: "asc" | "desc";
}

// ─── Dynamic column derivation ────────────────────────────────────────────────
// Known canonical key → display label + preferred width.
// Any key not listed here gets an auto-humanised label.

const KNOWN_COL_META: Record<string, { label: string; width?: string }> = {
  destinationCity: { label: "Destination", width: "160px" },
  destinationViaCity: { label: "Via City", width: "130px" },
  originCity: { label: "Origin", width: "160px" },
  originViaCity: { label: "Via City", width: "130px" },
  baseRate20: { label: "20'", width: "60px" },
  baseRate40: { label: "40'", width: "60px" },
  baseRate40H: { label: "40HC", width: "60px" },
  baseRate45: { label: "45'", width: "60px" },
  agw20: { label: "AGW 20'", width: "65px" },
  agw40: { label: "AGW 40'", width: "65px" },
  agw45: { label: "AGW 45'", width: "65px" },
  agw: { label: "AGW", width: "55px" },
  amsChina: { label: "AMS (CN/JP)", width: "85px" },
  heaHeavySurcharge: { label: "HEA Heavy", width: "75px" },
  redSeaDiversion: { label: "Red Sea Div.", width: "80px" },
  commodity: { label: "Commodity", width: "110px" },
  service: { label: "Service", width: "80px" },
  remarks: { label: "Remarks", width: "130px" },
  scope: { label: "Scope", width: "80px" },
  // origin context stamped from ORIGIN/ORIGIN VIA labels above each rate table
  origin: { label: "Origin", width: "220px" },
  originVia: { label: "Origin Via", width: "190px" },
  // short-form contract columns
  directCall: { label: "Direct Call", width: "75px" },
  cntry: { label: "Cntry", width: "50px" },
  cntry_2: { label: "Via Cntry", width: "50px" },
};

/** Keys stamped on every row by the extractor — skip from column display. */
const SKIP_COL_KEYS = new Set([
  "carrier",
  "contractId",
  "effectiveDate",
  "expirationDate",
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

// ─── WebGL loader (empty table state) ──────────────────────────────────────

function TableLoadingWebGL({
  active,
  label,
}: {
  active: boolean;
  label: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!active) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl = canvas.getContext("webgl", {
      antialias: true,
      alpha: true,
      premultipliedAlpha: false,
    });
    if (!gl) return;

    const vertexSrc = `
      attribute vec2 a_position;
      attribute float a_size;
      attribute float a_alpha;
      varying float v_alpha;
      void main() {
        gl_Position = vec4(a_position, 0.0, 1.0);
        gl_PointSize = a_size;
        v_alpha = a_alpha;
      }
    `;

    const fragSrc = `
      precision mediump float;
      varying float v_alpha;
      void main() {
        vec2 p = gl_PointCoord - vec2(0.5);
        float d = length(p);
        float a = smoothstep(0.5, 0.28, d) * v_alpha;
        gl_FragColor = vec4(0.62, 0.78, 0.98, a);
      }
    `;

    const compile = (type: number, src: string) => {
      const shader = gl.createShader(type);
      if (!shader) return null;
      gl.shaderSource(shader, src);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        gl.deleteShader(shader);
        return null;
      }
      return shader;
    };

    const vs = compile(gl.VERTEX_SHADER, vertexSrc);
    const fs = compile(gl.FRAGMENT_SHADER, fragSrc);
    if (!vs || !fs) return;

    const program = gl.createProgram();
    if (!program) return;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return;

    gl.useProgram(program);

    const dotCount = 26;
    const positions = new Float32Array(dotCount * 2);
    const sizes = new Float32Array(dotCount);
    const alphas = new Float32Array(dotCount);

    const posBuffer = gl.createBuffer();
    const sizeBuffer = gl.createBuffer();
    const alphaBuffer = gl.createBuffer();
    if (!posBuffer || !sizeBuffer || !alphaBuffer) return;

    const posLoc = gl.getAttribLocation(program, "a_position");
    const sizeLoc = gl.getAttribLocation(program, "a_size");
    const alphaLoc = gl.getAttribLocation(program, "a_alpha");

    const state = {
      w: 1,
      h: 1,
      dpr: 1,
      tx: 0,
      ty: 0,
      x: 0,
      y: 0,
      raf: 0,
    };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      state.dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 2));
      state.w = Math.max(1, Math.floor(rect.width));
      state.h = Math.max(1, Math.floor(rect.height));
      canvas.width = Math.floor(state.w * state.dpr);
      canvas.height = Math.floor(state.h * state.dpr);
      gl.viewport(0, 0, canvas.width, canvas.height);
      state.tx = state.w * 0.5;
      state.ty = state.h * 0.5;
      if (state.x === 0 && state.y === 0) {
        state.x = state.tx;
        state.y = state.ty;
      }
    };

    const onMove = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      state.tx = e.clientX - rect.left;
      state.ty = e.clientY - rect.top;
    };

    const onLeave = () => {
      state.tx = state.w * 0.5;
      state.ty = state.h * 0.5;
    };

    const toClipX = (px: number) => (px / state.w) * 2 - 1;
    const toClipY = (py: number) => 1 - (py / state.h) * 2;

    const draw = (timeMs: number) => {
      state.x += (state.tx - state.x) * 0.09;
      state.y += (state.ty - state.y) * 0.09;

      const t = timeMs * 0.001;
      const baseR = Math.min(
        Math.max(Math.min(state.w, state.h) * 0.12, 44),
        92,
      );
      const breathe = Math.sin(t * 2.0) * 11;
      const spin = t * 0.45;

      for (let i = 0; i < dotCount; i++) {
        const p = i / dotCount;
        const a = p * Math.PI * 2 + spin;
        const ripple = Math.sin(t * 3.2 + p * Math.PI * 4) * 3.2;
        const r = baseR + breathe + ripple;
        const px = state.x + Math.cos(a) * r;
        const py = state.y + Math.sin(a) * r;
        positions[i * 2] = toClipX(px);
        positions[i * 2 + 1] = toClipY(py);
        sizes[i] = (4.0 + (1 + Math.sin(t * 3.0 + p * 6.0)) * 2.8) * state.dpr;
        alphas[i] = 0.3 + (1 + Math.sin(t * 4.0 + p * 8.0)) * 0.25;
      }

      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

      gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, positions, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(posLoc);
      gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

      gl.bindBuffer(gl.ARRAY_BUFFER, sizeBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, sizes, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(sizeLoc);
      gl.vertexAttribPointer(sizeLoc, 1, gl.FLOAT, false, 0, 0);

      gl.bindBuffer(gl.ARRAY_BUFFER, alphaBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, alphas, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(alphaLoc);
      gl.vertexAttribPointer(alphaLoc, 1, gl.FLOAT, false, 0, 0);

      gl.drawArrays(gl.POINTS, 0, dotCount);
      state.raf = requestAnimationFrame(draw);
    };

    resize();
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerleave", onLeave);
    window.addEventListener("resize", resize);
    state.raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(state.raf);
      window.removeEventListener("resize", resize);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerleave", onLeave);
      gl.deleteBuffer(posBuffer);
      gl.deleteBuffer(sizeBuffer);
      gl.deleteBuffer(alphaBuffer);
      gl.deleteProgram(program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
    };
  }, [active]);

  return (
    <div className="relative h-full w-full bg-background">
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="rounded-md border border-border/50 bg-background/70 px-3 py-1.5 text-xs text-muted-foreground backdrop-blur-sm">
          {label}
        </div>
      </div>
    </div>
  );
}

// ─── Section table ────────────────────────────────────────────────────────────

function SectionTable({
  rows,
  cols,
  headerFilters,
  onHeaderFilterChange,
}: {
  rows: Record<string, string>[];
  cols: ColDef[];
  headerFilters?: Record<string, HeaderColumnFilter>;
  onHeaderFilterChange?: (key: string, next: HeaderColumnFilter | null) => void;
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

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 30,
    overscan: 30,
  });

  const virtualRows = rowVirtualizer.getVirtualItems();
  const totalSize = rowVirtualizer.getTotalSize();
  const topPadding = virtualRows.length > 0 ? virtualRows[0].start : 0;
  const bottomPadding =
    virtualRows.length > 0
      ? totalSize - virtualRows[virtualRows.length - 1].end
      : 0;

  return (
    <div
      ref={scrollRef}
      className="h-full min-h-0 overflow-auto extraction-table-scrollbar"
    >
      <table className="min-w-max w-full text-xs border-collapse">
        <thead className="bg-muted shadow-[0_1px_0_hsl(var(--border))] sticky top-0 z-10">
          <tr>
            <th className="px-2 py-1.5 text-left font-semibold border-b border-border whitespace-nowrap w-12 min-w-[48px]">
              #
            </th>
            {cols.map((col) => (
              <th
                key={col.key}
                className="group relative px-2 pr-7 py-1.5 text-left font-semibold border-b border-border whitespace-nowrap"
                style={{ minWidth: col.width }}
              >
                {col.label}
                {onHeaderFilterChange && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        aria-label={`Filter ${col.label} column`}
                        className={`absolute right-1 top-1/2 -translate-y-1/2 h-5 w-5 inline-flex items-center justify-center rounded-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring transition-opacity ${
                          headerFilters?.[col.key]
                            ? "opacity-100 text-primary"
                            : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 text-muted-foreground"
                        }`}
                      >
                        <Funnel className="h-3.5 w-3.5" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-56 p-2">
                      <div
                        className="space-y-2"
                        onKeyDown={(e) => e.stopPropagation()}
                      >
                        <p className="text-xs font-semibold text-muted-foreground">
                          Filter: {col.label}
                        </p>
                        <select
                          className="h-7 w-full rounded border bg-background px-2 text-xs"
                          value={headerFilters?.[col.key]?.op ?? "contains"}
                          onChange={(e) =>
                            onHeaderFilterChange(col.key, {
                              op: e.target.value as HeaderColumnFilter["op"],
                              value: headerFilters?.[col.key]?.value ?? "",
                              valueTo: headerFilters?.[col.key]?.valueTo,
                            })
                          }
                        >
                          <option value="contains">contains</option>
                          <option value="equals">equals</option>
                          <option value="startsWith">startsWith</option>
                          <option value="gt">&gt;</option>
                          <option value="lt">&lt;</option>
                          <option value="between">between</option>
                        </select>
                        <Input
                          value={headerFilters?.[col.key]?.value ?? ""}
                          onChange={(e) =>
                            onHeaderFilterChange(col.key, {
                              op: headerFilters?.[col.key]?.op ?? "contains",
                              value: e.target.value,
                              valueTo: headerFilters?.[col.key]?.valueTo,
                            })
                          }
                          className="h-7 text-xs"
                          placeholder="Value"
                        />
                        {(headerFilters?.[col.key]?.op ?? "contains") ===
                          "between" && (
                          <Input
                            value={headerFilters?.[col.key]?.valueTo ?? ""}
                            onChange={(e) =>
                              onHeaderFilterChange(col.key, {
                                op: headerFilters?.[col.key]?.op ?? "between",
                                value: headerFilters?.[col.key]?.value ?? "",
                                valueTo: e.target.value,
                              })
                            }
                            className="h-7 text-xs"
                            placeholder="Value to"
                          />
                        )}
                        <div className="flex justify-end">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-xs"
                            onClick={() => onHeaderFilterChange(col.key, null)}
                          >
                            Clear
                          </Button>
                        </div>
                      </div>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {topPadding > 0 && (
            <tr aria-hidden>
              <td
                colSpan={cols.length + 1}
                style={{ height: `${topPadding}px`, padding: 0, border: 0 }}
              />
            </tr>
          )}
          {virtualRows.map((virtualRow) => {
            const row = rows[virtualRow.index];
            return (
              <tr
                key={virtualRow.key}
                className="odd:bg-background even:bg-muted/20 hover:bg-accent/20 transition-colors"
              >
                <td className="px-2 py-1 border-b border-border/40 whitespace-nowrap align-top text-[11px] text-muted-foreground tabular-nums">
                  {virtualRow.index + 1}
                </td>
                {cols.map((col) => (
                  <td
                    key={col.key}
                    className="px-2 py-1 border-b border-border/40 whitespace-nowrap align-top text-[11px]"
                    style={{ minWidth: col.width }}
                  >
                    {row[col.key] ?? ""}
                  </td>
                ))}
              </tr>
            );
          })}
          {bottomPadding > 0 && (
            <tr aria-hidden>
              <td
                colSpan={cols.length + 1}
                style={{ height: `${bottomPadding}px`, padding: 0, border: 0 }}
              />
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface ExtractionViewProps {
  documentId: string;
  onClose: () => void;
  onRefresh?: () => void;
  onReprocess?: (doc: DocumentRecord) => Promise<void>;
  hideTopBar?: boolean;
  rawOpen?: boolean;
  onRawOpenChange?: (open: boolean) => void;
  tablesOpen?: boolean;
  onTablesOpenChange?: (open: boolean) => void;
}

// ─── ExtractionView ───────────────────────────────────────────────────────────

export function ExtractionView({
  documentId,
  onClose,
  onRefresh,
  onReprocess,
  hideTopBar,
  rawOpen: rawOpenProp,
  onRawOpenChange,
  tablesOpen: tablesOpenProp,
  onTablesOpenChange,
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
  const [isRightPanelCollapsed, setIsRightPanelCollapsed] = useState(true);
  const [isColumnsCollapsed, setIsColumnsCollapsed] = useState(true);
  const [isFiltersCollapsed, setIsFiltersCollapsed] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [quickFilters, setQuickFilters] = useState<QuickFilters>({
    usdOnly: false,
    hasOrigin: false,
    hasViaCity: false,
    directCallOnly: false,
    hasDestination: false,
  });
  const [logic, setLogic] = useState<FilterLogic>("AND");
  const [clauses, setClauses] = useState<FilterClause[]>([]);
  const [headerFilters, setHeaderFilters] = useState<
    Record<string, HeaderColumnFilter>
  >({});
  const [sortKey, setSortKey] = useState("");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [savedViews, setSavedViews] = useState<SavedFilterView[]>([]);
  const [viewName, setViewName] = useState("");
  const [rawOpenInternal, setRawOpenInternal] = useState(false);
  const [rawTab, setRawTab] = useState<"text" | "json">("text");
  const [tablesOpenInternal, setTablesOpenInternal] = useState(false);
  const [tablesSection, setTablesSection] = useState("");

  const effectiveRawOpen =
    rawOpenProp !== undefined ? rawOpenProp : rawOpenInternal;
  const setEffectiveRawOpen = (v: boolean) => {
    setRawOpenInternal(v);
    onRawOpenChange?.(v);
  };
  const effectiveTablesOpen =
    tablesOpenProp !== undefined ? tablesOpenProp : tablesOpenInternal;
  const setEffectiveTablesOpen = (v: boolean) => {
    setTablesOpenInternal(v);
    onTablesOpenChange?.(v);
  };
  // sectionCols[sectionKey] = derived ColDef[] from actual extracted rows
  const [sectionCols, setSectionCols] = useState<Record<string, ColDef[]>>({});

  const refreshCurrentDoc = useCallback(async () => {
    try {
      const nextDoc = await documentsApi.get(documentId);
      setDoc(nextDoc);
      onRefresh?.();
    } catch (err) {
      console.error(err);
    }
  }, [documentId, onRefresh]);

  // ── Fetch document ────────────────────────────────────────────────────────
  useEffect(() => {
    setLoading(true);
    refreshCurrentDoc()
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [refreshCurrentDoc]);

  useEffect(() => {
    if (!doc) return;
    const shouldPoll =
      doc.status === "QUEUED" ||
      doc.status === "SCANNING" ||
      doc.status === "PROCESSING" ||
      doc.status === "CANCELLING";
    if (!shouldPoll) return;

    const timer = window.setInterval(() => {
      refreshCurrentDoc();
    }, 1500);
    return () => window.clearInterval(timer);
  }, [doc, refreshCurrentDoc]);

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

  // Init tablesSection when the dialog is opened externally (hideTopBar mode)
  useEffect(() => {
    if (effectiveTablesOpen && !tablesSection) {
      const data = doc?.extractedJson as Record<string, unknown> | undefined;
      const type = data?.type as string | undefined;
      const r = type ? DOC_TYPE_RENDERERS[type] : null;
      if (r) setTablesSection(r.sections[0]?.key ?? "");
    }
  }, [effectiveTablesOpen, tablesSection, doc]);

  // ── Actions ───────────────────────────────────────────────────────────────
  const handleApprove = async () => {
    if (!doc) return;
    await documentsApi.approve(doc.id);
    refreshCurrentDoc();
  };

  const handleReject = async () => {
    if (!doc) return;
    const notes = prompt("Rejection reason (optional):");
    await documentsApi.reject(doc.id, notes || undefined);
    refreshCurrentDoc();
  };

  const handleReprocess = async () => {
    if (!doc) return;
    if (onReprocess) {
      await onReprocess(doc);
    } else {
      await documentsApi.reprocess(doc.id);
    }
    refreshCurrentDoc();
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
    () =>
      Object.values(sectionCols).reduce((acc, cols) => acc + cols.length, 0),
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

  const toggleSectionAll = (
    sectionKey: string,
    visible: boolean,
    cols: ColDef[],
  ) => {
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

  const activeSection =
    renderer?.sections.find((s) => s.key === activeTab) ??
    renderer?.sections[0] ??
    null;
  const activeSectionRows = activeSection
    ? activeSection.getRows(extractedData ?? {})
    : [];
  const activeSectionCols = activeSection
    ? (sectionCols[activeSection.key] ??
      activeSection.getColumns(activeSectionRows))
    : [];
  const visibleCols = activeSection
    ? activeSectionCols.filter(
        (c) => colVisibility[activeSection.key]?.[c.key] !== false,
      )
    : [];

  const getCell = (row: Record<string, string>, key: string) =>
    String(row[key] ?? "").trim();

  const evaluateClause = (
    row: Record<string, string>,
    clause: FilterClause,
  ): boolean => {
    if (!clause.enabled || !clause.field) return true;
    const raw = getCell(row, clause.field);
    const lhs = raw.toLowerCase();
    const rhs = clause.value.toLowerCase();
    switch (clause.op) {
      case "contains":
        return lhs.includes(rhs);
      case "equals":
        return lhs === rhs;
      case "startsWith":
        return lhs.startsWith(rhs);
      case "gt": {
        const a = Number(raw);
        const b = Number(clause.value);
        return Number.isFinite(a) && Number.isFinite(b) ? a > b : false;
      }
      case "lt": {
        const a = Number(raw);
        const b = Number(clause.value);
        return Number.isFinite(a) && Number.isFinite(b) ? a < b : false;
      }
      case "between": {
        const a = Number(raw);
        const b = Number(clause.value);
        const c = Number(clause.valueTo ?? "");
        return Number.isFinite(a) && Number.isFinite(b) && Number.isFinite(c)
          ? a >= Math.min(b, c) && a <= Math.max(b, c)
          : false;
      }
      case "in": {
        const items = clause.value
          .split(",")
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean);
        return items.length === 0 ? true : items.includes(lhs);
      }
      default:
        return true;
    }
  };

  const evaluateHeaderFilter = (
    row: Record<string, string>,
    key: string,
    filter: HeaderColumnFilter,
  ): boolean => {
    const raw = getCell(row, key);
    const lhs = raw.toLowerCase();
    const rhs = (filter.value ?? "").toLowerCase();
    switch (filter.op) {
      case "contains":
        return lhs.includes(rhs);
      case "equals":
        return lhs === rhs;
      case "startsWith":
        return lhs.startsWith(rhs);
      case "gt": {
        const a = Number(raw);
        const b = Number(filter.value);
        return Number.isFinite(a) && Number.isFinite(b) ? a > b : false;
      }
      case "lt": {
        const a = Number(raw);
        const b = Number(filter.value);
        return Number.isFinite(a) && Number.isFinite(b) ? a < b : false;
      }
      case "between": {
        const a = Number(raw);
        const b = Number(filter.value);
        const c = Number(filter.valueTo ?? "");
        return Number.isFinite(a) && Number.isFinite(b) && Number.isFinite(c)
          ? a >= Math.min(b, c) && a <= Math.max(b, c)
          : false;
      }
      default:
        return true;
    }
  };

  const filteredRows = useMemo(() => {
    const quickCheck = (row: Record<string, string>) => {
      if (quickFilters.usdOnly && getCell(row, "cur").toUpperCase() !== "USD")
        return false;
      if (quickFilters.hasOrigin && !getCell(row, "origin")) return false;
      if (quickFilters.hasViaCity && !getCell(row, "destinationViaCity"))
        return false;
      if (
        quickFilters.directCallOnly &&
        getCell(row, "directCall").toUpperCase() !== "Y"
      )
        return false;
      if (quickFilters.hasDestination && !getCell(row, "destinationCity"))
        return false;
      return true;
    };

    const searchCheck = (row: Record<string, string>) => {
      const q = searchText.trim().toLowerCase();
      if (!q) return true;
      return Object.values(row).some((v) =>
        String(v ?? "")
          .toLowerCase()
          .includes(q),
      );
    };

    const clauseCheck = (row: Record<string, string>) => {
      const enabled = clauses.filter((c) => c.enabled && c.field);
      if (enabled.length === 0) return true;
      return logic === "AND"
        ? enabled.every((c) => evaluateClause(row, c))
        : enabled.some((c) => evaluateClause(row, c));
    };

    const headerCheck = (row: Record<string, string>) => {
      const entries = Object.entries(headerFilters).filter(
        ([, f]) => (f.value ?? "").trim().length > 0,
      );
      if (entries.length === 0) return true;
      return entries.every(([k, f]) => evaluateHeaderFilter(row, k, f));
    };

    const out = activeSectionRows
      .filter(quickCheck)
      .filter(searchCheck)
      .filter(clauseCheck)
      .filter(headerCheck);

    if (!sortKey) return out;
    const sorted = [...out].sort((a, b) => {
      const av = getCell(a, sortKey);
      const bv = getCell(b, sortKey);
      const an = Number(av);
      const bn = Number(bv);
      const numeric = Number.isFinite(an) && Number.isFinite(bn);
      const cmp = numeric
        ? an - bn
        : av.localeCompare(bv, undefined, { sensitivity: "base" });
      return sortDir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [
    activeSectionRows,
    quickFilters,
    searchText,
    clauses,
    headerFilters,
    logic,
    sortKey,
    sortDir,
  ]);

  const storageKey = `extraction-filter-views-${documentId}-${activeTab}`;

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      const parsed = raw ? (JSON.parse(raw) as SavedFilterView[]) : [];
      setSavedViews(Array.isArray(parsed) ? parsed : []);
    } catch {
      setSavedViews([]);
    }
  }, [storageKey]);

  const persistViews = (views: SavedFilterView[]) => {
    setSavedViews(views);
    localStorage.setItem(storageKey, JSON.stringify(views));
  };

  const addClause = () => {
    const fallback = activeSectionCols[0]?.key ?? "";
    setClauses((prev) => [
      ...prev,
      {
        id: Math.random().toString(36).slice(2),
        field: fallback,
        op: "contains",
        value: "",
        enabled: true,
      },
    ]);
  };

  const saveCurrentView = () => {
    const name = viewName.trim();
    if (!name) return;
    const view: SavedFilterView = {
      id: Math.random().toString(36).slice(2),
      name,
      activeTab,
      searchText,
      quickFilters,
      logic,
      clauses,
      headerFilters,
      sortKey,
      sortDir,
    };
    persistViews([...savedViews, view]);
    setViewName("");
  };

  const loadView = (view: SavedFilterView) => {
    setSearchText(view.searchText);
    setQuickFilters(view.quickFilters);
    setLogic(view.logic);
    setClauses(view.clauses);
    setHeaderFilters(view.headerFilters ?? {});
    setSortKey(view.sortKey);
    setSortDir(view.sortDir);
  };

  const clearFilters = () => {
    setSearchText("");
    setQuickFilters({
      usdOnly: false,
      hasOrigin: false,
      hasViaCity: false,
      directCallOnly: false,
      hasDestination: false,
    });
    setClauses([]);
    setHeaderFilters({});
    setSortKey("");
    setSortDir("asc");
  };

  return (
    <div className="flex h-full min-h-0 overflow-hidden">
      {/* ── Main table area ──────────────────────────────────────────────── */}
      <div className="flex flex-col flex-1 min-h-0 overflow-hidden pt-5 pr-3">
        {!hideTopBar && (
          <div className="flex items-center justify-between gap-3 px-4 py-2 border-b shrink-0">
            <div className="flex items-center gap-2 min-w-0">
              <p
                className="text-sm font-medium truncate"
                title={doc?.filename ?? ""}
              >
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
                onClick={() => {
                  setRawTab("text");
                  setEffectiveRawOpen(true);
                }}
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
                  if (renderer)
                    setTablesSection(renderer.sections[0]?.key ?? "");
                  setEffectiveTablesOpen(true);
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
        )}

        {/* Table content */}
        {loading ? (
          <div className="flex flex-1 items-center justify-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm">Loading…</span>
          </div>
        ) : (
          <div className="flex flex-col flex-1 min-h-0">
            <div className="mx-4 mt-2 mb-0 shrink-0 flex items-center justify-between gap-2 pb-2">
              <div className="inline-flex items-stretch rounded-md border overflow-x-auto w-max max-w-full bg-background">
                {(
                  renderer?.sections ?? DOC_TYPE_RENDERERS.CONTRACT.sections
                ).map((s) => {
                  const rowCount = renderer
                    ? s.getRows(extractedData!).length
                    : 0;
                  const currentTab = activeTab || s.key;
                  const active = s.key === currentTab;
                  return (
                    <Button
                      key={s.key}
                      variant={active ? "secondary" : "ghost"}
                      size="sm"
                      className="h-8 text-xs whitespace-nowrap rounded-none border-r last:border-r-0 px-3"
                      onClick={() => setActiveTab(s.key)}
                    >
                      {s.label}
                      <span className="ml-1.5 text-[10px] text-muted-foreground">
                        ({rowCount})
                      </span>
                    </Button>
                  );
                })}
              </div>

              {hideTopBar && (
                <div className="flex items-center gap-2 shrink-0 ml-auto">
                  <div className="inline-flex items-stretch rounded-md border bg-background">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 text-xs rounded-none border-r px-3"
                      onClick={() => {
                        setRawTab("text");
                        setEffectiveRawOpen(true);
                      }}
                      disabled={!doc}
                    >
                      <FileText className="h-3 w-3 mr-1.5" />
                      Raw
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 text-xs rounded-none px-3"
                      onClick={() => {
                        if (renderer)
                          setTablesSection(renderer.sections[0]?.key ?? "");
                        setEffectiveTablesOpen(true);
                      }}
                      disabled={!renderer}
                    >
                      <FileText className="h-3 w-3 mr-1.5" />
                      Tables
                    </Button>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs gap-1"
                    onClick={handleReprocess}
                    disabled={!doc}
                  >
                    <RotateCcw className="h-3 w-3" />
                    Reprocess
                  </Button>
                </div>
              )}

              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8 shrink-0"
                onClick={() => setIsRightPanelCollapsed((prev) => !prev)}
                title={
                  isRightPanelCollapsed
                    ? "Show right panel"
                    : "Hide right panel"
                }
              >
                {isRightPanelCollapsed ? (
                  <ListFilter />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
              </Button>
            </div>
            <div className="flex flex-col flex-1 min-h-0 mt-2 px-4 pb-4">
              <div className="flex-1 min-h-0 rounded-md border overflow-hidden">
                {renderer ? (
                  <SectionTable
                    rows={filteredRows}
                    cols={visibleCols}
                    headerFilters={headerFilters}
                    onHeaderFilterChange={(key, next) => {
                      setHeaderFilters((prev) => {
                        const copy = { ...prev };
                        if (!next || !(next.value ?? "").trim()) {
                          delete copy[key];
                          return copy;
                        }
                        copy[key] = next;
                        return copy;
                      });
                    }}
                  />
                ) : (
                  <TableLoadingWebGL
                    active={
                      doc?.status === "QUEUED" ||
                      doc?.status === "SCANNING" ||
                      doc?.status === "PROCESSING" ||
                      doc?.status === "CANCELLING"
                    }
                    label={
                      doc?.status === "ERROR"
                        ? "Extraction failed"
                        : "Processing tables..."
                    }
                  />
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Right: column checkbox panel ─────────────────────────────────── */}
      <div
        className={`shrink-0 border-l flex flex-col bg-card overflow-hidden transition-[width,opacity,transform] duration-300 ease-out ${
          isRightPanelCollapsed
            ? "w-0 opacity-0 translate-x-2 border-transparent pointer-events-none"
            : "w-72 opacity-100 translate-x-0"
        }`}
      >
        {/* Contract header info */}
        {renderer && extractedData && (
          <div className="pt-3 border-b space-y-2 px-4 my-1 pb-4">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              {renderer.label} Info
            </p>
            {renderer.getHeaderFields(extractedData).map((f) => (
              <div key={f.label} className="flex flex-col min-w-0">
                <span className="text-xs text-muted-foreground uppercase tracking-wide leading-tight">
                  {f.label}
                </span>
                <span className="text-sm font-medium truncate" title={f.value}>
                  {f.value}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Column visibility checkboxes — only for the active tab */}
        <ScrollArea className="flex-1">
          <div className="py-1">
            {renderer && activeTab
              ? (() => {
                  const section = renderer.sections.find(
                    (s) => s.key === activeTab,
                  );
                  const cols = section ? (sectionCols[activeTab] ?? []) : [];
                  const sectionVis = colVisibility[activeTab] ?? {};
                  const checkedCount = cols.filter(
                    (c) => sectionVis[c.key] !== false,
                  ).length;
                  const allChecked = checkedCount === cols.length;
                  const parentChecked =
                    checkedCount === 0
                      ? false
                      : checkedCount === cols.length
                        ? true
                        : "indeterminate";
                  return (
                    <div>
                      <div className="flex items-center justify-between px-3 pt-2 pb-1.5">
                        <button
                          className="inline-flex items-center gap-1.5 pb-1 text-xs font-semibold text-muted-foreground uppercase tracking-wide hover:text-foreground"
                          onClick={() => setIsColumnsCollapsed((prev) => !prev)}
                        >
                          {isColumnsCollapsed ? (
                            <ChevronRight className="h-3 w-3" />
                          ) : (
                            <ChevronDown className="h-3 w-3" />
                          )}
                          Columns
                        </button>
                      </div>
                      {!isColumnsCollapsed && (
                        <div className="pb-2 space-y-2 text-sm px-5">
                          <label className="flex items-center gap-2 cursor-pointer select-none">
                            <Checkbox
                              checked={
                                parentChecked as boolean | "indeterminate"
                              }
                              onCheckedChange={(v) =>
                                toggleSectionAll(activeTab, !!v, cols)
                              }
                              className="h-3.5 w-3.5 [&_svg]:h-3 [&_svg]:w-3"
                            />
                            Select all
                          </label>
                          <div className="pl-5 space-y-2">
                            {cols.map((col) => (
                              <label
                                key={col.key}
                                className="flex items-center gap-2 text-sm cursor-pointer select-none"
                              >
                                <Checkbox
                                  checked={sectionVis[col.key] !== false}
                                  onCheckedChange={(v) =>
                                    toggleCol(activeTab, col.key, !!v)
                                  }
                                  className="h-3.5 w-3.5 [&_svg]:h-3 [&_svg]:w-3"
                                />
                                {col.label}
                              </label>
                            ))}
                          </div>
                        </div>
                      )}

                      <div className="mt-2">
                        <div className="flex items-center justify-between px-3 pb-1.5">
                          <button
                            className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide hover:text-foreground"
                            onClick={() =>
                              setIsFiltersCollapsed((prev) => !prev)
                            }
                          >
                            {isFiltersCollapsed ? (
                              <ChevronRight className="h-3 w-3" />
                            ) : (
                              <ChevronDown className="h-3 w-3" />
                            )}
                            Filters
                          </button>
                          <span className="text-xs text-muted-foreground pr-2">
                            {filteredRows.length}/{activeSectionRows.length}
                          </span>
                        </div>

                        {!isFiltersCollapsed && (
                          <div className="pb-3 space-y-3 text-sm pt-1 px-5">
                            <Input
                              value={searchText}
                              onChange={(e) => setSearchText(e.target.value)}
                              placeholder="Search all visible values"
                              className="h-8 text-sm"
                            />

                            <div className="flex flex-wrap gap-1">
                              {(
                                [
                                  ["usdOnly", "USD"],
                                  ["hasOrigin", "Has Origin"],
                                  ["hasViaCity", "Has Via"],
                                  ["directCallOnly", "Direct Call"],
                                  ["hasDestination", "Has Dest"],
                                ] as const
                              ).map(([key, label]) => (
                                <Button
                                  key={key}
                                  type="button"
                                  size="sm"
                                  variant={
                                    quickFilters[key] ? "secondary" : "outline"
                                  }
                                  className="h-7 px-3 text-xs"
                                  onClick={() =>
                                    setQuickFilters((prev) => ({
                                      ...prev,
                                      [key]: !prev[key],
                                    }))
                                  }
                                >
                                  {label}
                                </Button>
                              ))}
                            </div>

                            <div className="rounded-md border p-2 space-y-2">
                              <div className="flex items-center justify-between">
                                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                                  Logic
                                </span>
                                <div className="inline-flex rounded-md border overflow-hidden">
                                  <Button
                                    size="sm"
                                    variant={
                                      logic === "AND" ? "secondary" : "ghost"
                                    }
                                    className="h-7 px-3 text-xs rounded-none"
                                    onClick={() => setLogic("AND")}
                                  >
                                    AND
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant={
                                      logic === "OR" ? "secondary" : "ghost"
                                    }
                                    className="h-7 px-3 text-xs rounded-none border-l"
                                    onClick={() => setLogic("OR")}
                                  >
                                    OR
                                  </Button>
                                </div>
                              </div>

                              {clauses.map((clause) => (
                                <div
                                  key={clause.id}
                                  className="space-y-1 rounded border p-1.5"
                                >
                                  <div className="flex items-center gap-1">
                                    <select
                                      className="h-7 flex-1 rounded border bg-background px-2 text-xs"
                                      value={clause.field}
                                      onChange={(e) =>
                                        setClauses((prev) =>
                                          prev.map((c) =>
                                            c.id === clause.id
                                              ? {
                                                  ...c,
                                                  field: e.target.value,
                                                }
                                              : c,
                                          ),
                                        )
                                      }
                                    >
                                      {activeSectionCols.map((c) => (
                                        <option key={c.key} value={c.key}>
                                          {c.label}
                                        </option>
                                      ))}
                                    </select>
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="h-7 px-2 text-xs"
                                      onClick={() =>
                                        setClauses((prev) =>
                                          prev.filter(
                                            (c) => c.id !== clause.id,
                                          ),
                                        )
                                      }
                                    >
                                      ✕
                                    </Button>
                                  </div>
                                  <div className="flex items-center gap-1">
                                    <select
                                      className="h-7 w-28 rounded border bg-background px-2 text-xs"
                                      value={clause.op}
                                      onChange={(e) =>
                                        setClauses((prev) =>
                                          prev.map((c) =>
                                            c.id === clause.id
                                              ? {
                                                  ...c,
                                                  op: e.target
                                                    .value as FilterOp,
                                                }
                                              : c,
                                          ),
                                        )
                                      }
                                    >
                                      <option value="contains">contains</option>
                                      <option value="equals">equals</option>
                                      <option value="startsWith">
                                        startsWith
                                      </option>
                                      <option value="gt">&gt;</option>
                                      <option value="lt">&lt;</option>
                                      <option value="between">between</option>
                                      <option value="in">in (csv)</option>
                                    </select>
                                    <Input
                                      value={clause.value}
                                      onChange={(e) =>
                                        setClauses((prev) =>
                                          prev.map((c) =>
                                            c.id === clause.id
                                              ? {
                                                  ...c,
                                                  value: e.target.value,
                                                }
                                              : c,
                                          ),
                                        )
                                      }
                                      className="h-7 text-xs"
                                    />
                                    {clause.op === "between" && (
                                      <Input
                                        value={clause.valueTo ?? ""}
                                        onChange={(e) =>
                                          setClauses((prev) =>
                                            prev.map((c) =>
                                              c.id === clause.id
                                                ? {
                                                    ...c,
                                                    valueTo: e.target.value,
                                                  }
                                                : c,
                                            ),
                                          )
                                        }
                                        className="h-7 text-xs"
                                        placeholder="to"
                                      />
                                    )}
                                  </div>
                                </div>
                              ))}

                              <div className="flex gap-1">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 px-3 text-xs"
                                  onClick={addClause}
                                >
                                  + Clause
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 px-3 text-xs"
                                  onClick={clearFilters}
                                >
                                  Clear
                                </Button>
                              </div>
                            </div>

                            <div className="rounded-md border p-2 space-y-2">
                              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                                Sort
                              </span>
                              <div className="flex gap-1">
                                <select
                                  className="h-7 flex-1 rounded border bg-background px-2 text-xs"
                                  value={sortKey}
                                  onChange={(e) => setSortKey(e.target.value)}
                                >
                                  <option value="">No sort</option>
                                  {activeSectionCols.map((c) => (
                                    <option key={c.key} value={c.key}>
                                      {c.label}
                                    </option>
                                  ))}
                                </select>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 px-3 text-xs"
                                  onClick={() =>
                                    setSortDir((d) =>
                                      d === "asc" ? "desc" : "asc",
                                    )
                                  }
                                >
                                  {sortDir.toUpperCase()}
                                </Button>
                              </div>
                            </div>

                            <div className="rounded-md border p-2 space-y-2">
                              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                                Header Filters
                              </span>
                              {activeSectionCols.length === 0 ? (
                                <p className="text-xs text-muted-foreground">
                                  No columns available.
                                </p>
                              ) : (
                                <div className="space-y-2">
                                  {activeSectionCols.map((col) => {
                                    const hf = headerFilters[col.key];
                                    return (
                                      <div
                                        key={col.key}
                                        className="space-y-1 rounded border p-1.5"
                                      >
                                        <div className="flex items-center justify-between">
                                          <span className="text-xs font-medium truncate">
                                            {col.label}
                                          </span>
                                          <Button
                                            size="sm"
                                            variant={hf ? "secondary" : "ghost"}
                                            className="h-6 px-2 text-[10px]"
                                            onClick={() =>
                                              setHeaderFilters((prev) => {
                                                const copy = { ...prev };
                                                if (copy[col.key]) {
                                                  delete copy[col.key];
                                                } else {
                                                  copy[col.key] = {
                                                    op: "contains",
                                                    value: "",
                                                  };
                                                }
                                                return copy;
                                              })
                                            }
                                          >
                                            {hf ? "On" : "Off"}
                                          </Button>
                                        </div>

                                        {hf && (
                                          <div className="flex items-center gap-1">
                                            <select
                                              className="h-7 w-24 rounded border bg-background px-2 text-xs"
                                              value={hf.op}
                                              onChange={(e) =>
                                                setHeaderFilters((prev) => ({
                                                  ...prev,
                                                  [col.key]: {
                                                    ...prev[col.key],
                                                    op: e.target
                                                      .value as HeaderColumnFilter["op"],
                                                  },
                                                }))
                                              }
                                            >
                                              <option value="contains">
                                                contains
                                              </option>
                                              <option value="equals">
                                                equals
                                              </option>
                                              <option value="startsWith">
                                                startsWith
                                              </option>
                                              <option value="gt">&gt;</option>
                                              <option value="lt">&lt;</option>
                                              <option value="between">
                                                between
                                              </option>
                                            </select>
                                            <Input
                                              value={hf.value}
                                              onChange={(e) =>
                                                setHeaderFilters((prev) => ({
                                                  ...prev,
                                                  [col.key]: {
                                                    ...prev[col.key],
                                                    value: e.target.value,
                                                  },
                                                }))
                                              }
                                              className="h-7 text-xs"
                                            />
                                            {hf.op === "between" && (
                                              <Input
                                                value={hf.valueTo ?? ""}
                                                onChange={(e) =>
                                                  setHeaderFilters((prev) => ({
                                                    ...prev,
                                                    [col.key]: {
                                                      ...prev[col.key],
                                                      valueTo: e.target.value,
                                                    },
                                                  }))
                                                }
                                                className="h-7 text-xs"
                                                placeholder="to"
                                              />
                                            )}
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>

                            <div className="rounded-md border p-2 space-y-2">
                              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                                Saved Views
                              </span>
                              <div className="flex gap-1">
                                <Input
                                  value={viewName}
                                  onChange={(e) => setViewName(e.target.value)}
                                  placeholder="View name"
                                  className="h-7 text-xs"
                                />
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 px-3 text-xs"
                                  onClick={saveCurrentView}
                                >
                                  Save
                                </Button>
                              </div>
                              <div className="max-h-28 overflow-y-auto space-y-1">
                                {savedViews.map((view) => (
                                  <div
                                    key={view.id}
                                    className="flex items-center gap-1"
                                  >
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="h-7 flex-1 justify-start px-2 text-xs"
                                      onClick={() => loadView(view)}
                                    >
                                      {view.name}
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="h-7 px-2 text-xs"
                                      onClick={() =>
                                        persistViews(
                                          savedViews.filter(
                                            (v) => v.id !== view.id,
                                          ),
                                        )
                                      }
                                    >
                                      ✕
                                    </Button>
                                  </div>
                                ))}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })()
              : !loading && (
                  <p className="text-xs text-muted-foreground italic px-3 pt-2">
                    No data loaded
                  </p>
                )}
          </div>
        </ScrollArea>
      </div>

      {/* ── Tables preview dialog ─────────────────────────────────────────── */}
      {renderer && (
        <Dialog
          open={effectiveTablesOpen}
          onOpenChange={setEffectiveTablesOpen}
        >
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
                    <span className="ml-1.5 text-[10px] opacity-60">
                      ({count})
                    </span>
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
                            No rows extracted for this section. Reprocess the
                            document if expected.
                          </p>
                        ) : (
                          <div className="overflow-x-scroll rounded-md border [&::-webkit-scrollbar]:h-3 [&::-webkit-scrollbar-track]:bg-muted/30 [&::-webkit-scrollbar-thumb]:bg-border [&::-webkit-scrollbar-thumb]:rounded-full">
                            <SectionTable
                              rows={rows}
                              cols={sectionCols[s.key] ?? s.getColumns(rows)}
                            />
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
      <Dialog open={effectiveRawOpen} onOpenChange={setEffectiveRawOpen}>
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
