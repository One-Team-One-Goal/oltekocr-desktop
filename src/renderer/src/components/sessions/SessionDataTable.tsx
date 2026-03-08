import { useCallback, useEffect, useMemo, useState } from "react";
import { OcrEngineDialog } from "./OcrEngineDialog";
import { LlmDialog } from "./LlmDialog";
import { PdfModelDialog } from "./PdfModelDialog";
import { ProcessingLogSheet } from "./ProcessingLogSheet";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  type ColumnDef,
  type ColumnFiltersState,
  type PaginationState,
  type SortingState,
  type VisibilityState,
  type RowSelectionState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
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
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  statusLabel,
  statusColor,
  formatConfidence,
  formatShortDateTime,
} from "@/lib/utils";
import { documentsApi, exportApi, queueApi } from "@/api/client";
import {
  Eye,
  RotateCcw,
  FileOutput,
  Trash2,
  CheckCircle2,
  MoreHorizontal,
  Crosshair,
  ZoomIn,
  ZoomOut,
  RotateCw,
  Maximize2,
  FileText,
  Type,
  Layers,
  Loader2,
  ArrowUpDown,
  ChevronDown,
  Clock,
  ScanLine,
  XCircle,
  AlertCircle,
  ChevronsUpDown,
  Play,
  Square,
  Undo2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  DocumentListItem,
  DocumentRecord,
  SessionRecord,
  TextBlock,
} from "@shared/types";
import { ExtractionType } from "@shared/types";

const MODEL_DISPLAY_NAMES: Record<string, string> = {
  docling: "Docling 2.x",
  pdfplumber: "pdfplumber",
  pymupdf: "PyMuPDF (fitz)",
  unstructured: "Unstructured.io",
};

const EXTRACTION_TYPE_OPTIONS: {
  value: ExtractionType;
  label: string;
  color: string;
}[] = [
  { value: ExtractionType.AUTO, label: "Auto", color: "text-muted-foreground" },
  { value: ExtractionType.IMAGE, label: "Image", color: "text-sky-500" },
  {
    value: ExtractionType.PDF_TEXT,
    label: "PDF (Text)",
    color: "text-violet-500",
  },
  {
    value: ExtractionType.PDF_IMAGE,
    label: "PDF (Scanned)",
    color: "text-amber-500",
  },
  { value: ExtractionType.EXCEL, label: "Excel", color: "text-green-500" },
];

function extractionTypeColor(t: ExtractionType) {
  return EXTRACTION_TYPE_OPTIONS.find((o) => o.value === t)?.color ?? "";
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface SessionDataTableProps {
  documents: DocumentListItem[];
  loading: boolean;
  session: SessionRecord | null;
  onReview: (id: string) => void;
  onRefresh: () => void;
}

const DEFAULT_PAGE_SIZE = 10;
const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

// ─── Status Badge ─────────────────────────────────────────────────────────────

function StatusBadge({
  status,
  onShowLogs,
}: {
  status: string;
  onShowLogs?: () => void;
}) {
  const icons: Record<string, React.ReactNode> = {
    QUEUED: <Clock className="h-3 w-3" />,
    SCANNING: <ScanLine className="h-3 w-3" />,
    PROCESSING: <Loader2 className="h-3 w-3 animate-spin" />,
    CANCELLING: <Loader2 className="h-3 w-3 animate-spin" />,
    REVIEW: <Eye className="h-3 w-3" />,
    APPROVED: <CheckCircle2 className="h-3 w-3" />,
    REJECTED: <XCircle className="h-3 w-3" />,
    EXPORTED: <FileOutput className="h-3 w-3" />,
    ERROR: <AlertCircle className="h-3 w-3" />,
  };
  const isClickable = !!onShowLogs;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium",
        statusColor(status),
        isClickable &&
          "cursor-pointer border hover:border-border/50 focus:ring-0",
      )}
      onClick={
        isClickable
          ? (e) => {
              e.stopPropagation();
              onShowLogs?.();
            }
          : undefined
      }
      title={isClickable ? "Open logs" : undefined}
    >
      {icons[status] ?? null}
      {statusLabel(status)}
    </span>
  );
}

// ─── Sort Header Button ───────────────────────────────────────────────────────

function SortHeader({
  column,
  label,
}: {
  column: import("@tanstack/react-table").Column<DocumentListItem>;
  label: string;
}) {
  return (
    <Button
      variant="ghost"
      size="sm"
      className="-ml-3 h-7 gap-1 px-2 text-xs font-medium"
      onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
    >
      {label}
      <ArrowUpDown className="h-3 w-3" />
    </Button>
  );
}

// ─── Per-status visible actions ──────────────────────────────────────────────

function visibleActions(status: string): Set<string> {
  switch (status) {
    case "QUEUED":
      return new Set(["play", "delete"]);
    case "SCANNING":
    case "PROCESSING":
      return new Set(["stop", "delete"]);
    case "CANCELLING":
      return new Set(["delete"]);
    case "REVIEW":
      return new Set(["review", "approve", "reprocess", "export", "delete"]);
    case "APPROVED":
      return new Set(["reprocess", "export", "delete"]);
    case "REJECTED":
      return new Set(["reprocess", "delete"]);
    case "EXPORTED":
      return new Set(["reprocess", "export", "delete"]);
    case "ERROR":
      return new Set(["play", "reprocess", "delete"]);
    default:
      return new Set(["review", "reprocess", "export", "delete"]);
  }
}

// ─── Row Actions Dropdown ─────────────────────────────────────────────────────

function RowActions({
  docId,
  status,
  runAction,
}: {
  docId: string;
  status: string;
  runAction: (action: string, docId: string) => void;
}) {
  const run = (action: string) => runAction(action, docId);
  const show = visibleActions(status);
  const hasQueueSection = show.has("play") || show.has("stop");
  const hasActionSection =
    show.has("review") ||
    show.has("approve") ||
    show.has("reprocess") ||
    show.has("export");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={(e) => e.stopPropagation()}
        >
          <MoreHorizontal className="h-3.5 w-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[160px]">
        {show.has("play") && (
          <DropdownMenuItem onClick={() => run("play")}>
            <Play className="h-4 w-4 text-green-500" /> Start
          </DropdownMenuItem>
        )}
        {show.has("stop") && (
          <DropdownMenuItem onClick={() => run("stop")}>
            <Square className="h-4 w-4 text-red-500" /> Stop
          </DropdownMenuItem>
        )}
        {hasQueueSection && hasActionSection && <DropdownMenuSeparator />}
        {show.has("review") && (
          <DropdownMenuItem onClick={() => run("review")}>
            <Eye className="h-4 w-4" /> Review
          </DropdownMenuItem>
        )}
        {show.has("approve") && (
          <DropdownMenuItem onClick={() => run("approve")}>
            <CheckCircle2 className="h-4 w-4 text-green-500" /> Approve
          </DropdownMenuItem>
        )}
        {show.has("reprocess") && (
          <DropdownMenuItem onClick={() => run("reprocess")}>
            <RotateCcw className="h-4 w-4 text-amber-500" /> Reprocess
          </DropdownMenuItem>
        )}
        {show.has("export") && (
          <DropdownMenuItem onClick={() => run("export")}>
            <FileOutput className="h-4 w-4" /> Export
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="text-destructive focus:text-destructive"
          onClick={() => run("delete")}
        >
          <Trash2 className="h-4 w-4" /> Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ─── Batch Toolbar ────────────────────────────────────────────────────────────

function BatchToolbar({
  count,
  ids,
  onClear,
  onRefresh,
}: {
  count: number;
  ids: string[];
  onClear: () => void;
  onRefresh: () => void;
}) {
  const [batchType, setBatchType] = useState<ExtractionType>(
    ExtractionType.AUTO,
  );
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <>
      <span className="text-xs text-muted-foreground shrink-0">
        {count} selected
      </span>
      <Button
        variant="outline"
        size="sm"
        className="gap-1.5 text-xs h-8"
        onClick={async () => {
          await queueApi.add(ids);
          onClear();
          onRefresh();
        }}
      >
        <Play className="h-3.5 w-3.5 text-green-500" />
      </Button>
      <Button
        variant="outline"
        size="sm"
        className="gap-1.5 text-xs h-8"
        onClick={async () => {
          await queueApi.cancel(ids).catch(() => {});
          onClear();
          onRefresh();
        }}
      >
        <Square className="h-3.5 w-3.5 text-red-500" />
      </Button>
      <Button
        variant="outline"
        size="sm"
        className="gap-1.5 text-xs h-8 text-destructive hover:text-destructive hover:bg-destructive/10 border-destructive/30"
        onClick={() => setConfirmDelete(true)}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
      <Dialog
        open={confirmDelete}
        onOpenChange={(v) => !v && setConfirmDelete(false)}
      >
        <DialogContent className="sm:max-w-[380px]">
          <DialogHeader>
            <DialogTitle>
              Delete {count} document{count !== 1 ? "s" : ""}?
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This will permanently delete the selected document
            {count !== 1 ? "s" : ""} and cannot be undone.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={async () => {
                setConfirmDelete(false);
                await Promise.all(ids.map((id) => documentsApi.delete(id)));
                onClear();
                onRefresh();
              }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <div className="flex items-center gap-1 border-l pl-2">
        <Layers className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <Select
          value={batchType}
          onValueChange={(v) => setBatchType(v as ExtractionType)}
        >
          <SelectTrigger className="h-8 w-36 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {EXTRACTION_TYPE_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value} className="text-xs">
                <span className={opt.color}>{opt.label}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          size="sm"
          className="h-8 text-xs px-3"
          onClick={async () => {
            await documentsApi.batchUpdateExtractionType(ids, batchType);
            onClear();
            onRefresh();
          }}
        >
          Apply
        </Button>
      </div>
    </>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function SessionDataTable({
  documents,
  loading,
  session,
  onReview,
  onRefresh,
}: SessionDataTableProps) {
  const isTableMode = session?.mode === "TABLE_EXTRACT";
  const sessionColumns = session?.columns ?? [];
  const [pickTarget, setPickTarget] = useState<{
    docId: string;
    colKey: string;
    colLabel: string;
  } | null>(null);

  // Shadcn DataTable state
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [statusFilter, setStatusFilter] = useState("all");
  const [ocrEngineOpen, setOcrEngineOpen] = useState(false);
  const [llmOpen, setLlmOpen] = useState(false);
  const [pdfModelOpen, setPdfModelOpen] = useState(false);
  const [selectedOcrName, setSelectedOcrName] = useState("RapidOCR");
  const [selectedLlmName, setSelectedLlmName] = useState("GPT-4o");
  const [selectedPdfModelName, setSelectedPdfModelName] = useState(
    () =>
      MODEL_DISPLAY_NAMES[session?.extractionModel ?? "docling"] ??
      "Docling 2.x",
  );
  const [logSheetOpen, setLogSheetOpen] = useState(false);
  const [logSheetDocId, setLogSheetDocId] = useState<string | null>(null);
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: DEFAULT_PAGE_SIZE,
  });

  // Disable model selectors that are irrelevant to the current document set.
  // AUTO rows are treated as unknown, so they don't force a disable.
  const onlyImages = useMemo(
    () =>
      documents.length > 0 &&
      documents.every(
        (d) =>
          d.extractionType === ExtractionType.IMAGE ||
          d.extractionType === ExtractionType.EXCEL,
      ),
    [documents],
  );
  const onlyPdfs = useMemo(
    () =>
      documents.length > 0 &&
      documents.every(
        (d) =>
          d.extractionType === ExtractionType.PDF_TEXT ||
          d.extractionType === ExtractionType.PDF_IMAGE,
      ),
    [documents],
  );

  const isPending = (doc: DocumentListItem) =>
    doc.status === "QUEUED" ||
    doc.status === "SCANNING" ||
    doc.status === "PROCESSING";

  // ── Shared doc action handler ─────────────────────────────────────
  const runDocAction = useCallback(
    async (action: string, docId: string) => {
      try {
        switch (action) {
          case "play":
            await queueApi.add([docId]);
            await queueApi.resume();
            onRefresh();
            break;
          case "stop":
            await queueApi.cancel([docId]).catch(() => {});
            onRefresh();
            break;
          case "review":
            onReview(docId);
            break;
          case "approve":
            await documentsApi.approve(docId);
            onRefresh();
            break;
          case "reprocess":
            await documentsApi.reprocess(docId);
            await queueApi.add([docId]);
            onRefresh();
            break;
          case "export":
            await exportApi.exportDocuments([docId], "excel");
            onRefresh();
            break;
          case "delete":
            if (confirm("Delete this document? This cannot be undone.")) {
              await documentsApi.delete(docId);
              onRefresh();
            }
            break;
        }
      } catch (err) {
        console.error(`Action ${action} failed:`, err);
      }
    },
    [onReview, onRefresh],
  );

  const columns = useMemo((): ColumnDef<DocumentListItem>[] => {
    const selectCol: ColumnDef<DocumentListItem> = {
      id: "select",
      header: ({ table }) => (
        <Checkbox
          checked={
            table.getIsAllPageRowsSelected() ||
            (table.getIsSomePageRowsSelected() && "indeterminate")
          }
          onCheckedChange={(v) => table.toggleAllPageRowsSelected(!!v)}
          aria-label="Select all"
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          checked={row.getIsSelected()}
          onCheckedChange={(v) => row.toggleSelected(!!v)}
          aria-label="Select row"
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
        />
      ),
      enableHiding: false,
      enableSorting: false,
      enableResizing: false,
      size: 40,
    };

    const fixed: ColumnDef<DocumentListItem>[] = [
      {
        accessorKey: "filename",
        header: ({ column }) => (
          <Button
            variant="ghost"
            size="sm"
            className="-ml-3 h-7 text-xs font-medium gap-1 px-2"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            Filename
            <ArrowUpDown className="h-3 w-3" />
          </Button>
        ),
        size: 120,
        cell: ({ row }) => (
          <div className="flex items-center gap-1.5 min-w-0">
            <span
              className="truncate text-xs font-medium"
              title={row.original.filename}
            >
              {row.original.filename}
            </span>
          </div>
        ),
      },
      {
        accessorKey: "status",
        header: ({ column }) => <SortHeader column={column} label="Status" />,
        size: 130,
        cell: ({ row }) => (
          <StatusBadge
            status={row.original.status}
            onShowLogs={() => {
              setLogSheetDocId(row.original.id);
              setLogSheetOpen(true);
            }}
          />
        ),
      },
      {
        accessorKey: "createdAt",
        header: ({ column }) => <SortHeader column={column} label="Scanned" />,
        size: 120,
        cell: ({ row }) => (
          <span className="font-mono text-xs text-muted-foreground">
            {formatShortDateTime(row.original.createdAt)}
          </span>
        ),
      },
      {
        accessorKey: "ocrAvgConfidence",
        header: ({ column }) => <SortHeader column={column} label="Conf." />,
        size: 80,
        cell: ({ row }) => (
          <span className="font-mono text-xs">
            {formatConfidence(row.original.ocrAvgConfidence)}
          </span>
        ),
      },
      {
        accessorKey: "ocrPageCount",
        header: ({ column }) => <SortHeader column={column} label="Pg" />,
        size: 60,
        cell: ({ row }) => (
          <span className="font-mono text-xs">
            {row.original.ocrPageCount || "—"}
          </span>
        ),
      },
      {
        id: "extractionType",
        header: "Ext. Type",
        size: 140,
        cell: ({ row }) => {
          const current = (row.original.extractionType ??
            "IMAGE") as ExtractionType;
          return (
            <Select
              value={current}
              onValueChange={async (val) => {
                try {
                  await documentsApi.update(row.original.id, {
                    extractionType: val,
                  });
                  onRefresh();
                } catch (err) {
                  console.error("Failed to update extraction type:", err);
                }
              }}
            >
              <SelectTrigger
                className="h-7 text-xs border-none shadow-none bg-transparent gap-1 w-full px-1 border border-border rounded-full focus:ring-0"
                onClick={(e) => e.stopPropagation()}
              >
                <span
                  className={cn(
                    "font-medium px-2 py-1 border border-border rounded-full",
                    extractionTypeColor(current),
                  )}
                >
                  <SelectValue />
                </span>
              </SelectTrigger>
              <SelectContent onClick={(e) => e.stopPropagation()}>
                {EXTRACTION_TYPE_OPTIONS.map((opt) => (
                  <SelectItem
                    key={opt.value}
                    value={opt.value}
                    className="text-xs"
                  >
                    <span className={opt.color}>{opt.label}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          );
        },
      },
    ];

    const dynamicCols: ColumnDef<DocumentListItem>[] = isTableMode
      ? sessionColumns.map((col) => ({
          id: col.key,
          header: ({
            column,
          }: {
            column: import("@tanstack/react-table").Column<DocumentListItem>;
          }) => <SortHeader column={column} label={col.label} />,
          size: 150,
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
            return (
              <div
                className="group/cell flex items-center gap-1 min-w-0"
                onClick={(e) => e.stopPropagation()}
              >
                <span className="truncate text-xs flex-1" title={answer}>
                  {answer || <span className="text-muted-foreground">—</span>}
                </span>
                {score > 0 && (
                  <span className="shrink-0 text-[10px] text-muted-foreground">
                    {Math.round(score * 100)}%
                  </span>
                )}
                <button
                  className="shrink-0 opacity-0 group-hover/cell:opacity-100 transition-opacity ml-1 text-muted-foreground hover:text-foreground"
                  title={`Manually select value for ${col.label}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setPickTarget({
                      docId: row.original.id,
                      colKey: col.key,
                      colLabel: col.label,
                    });
                  }}
                >
                  <Undo2 className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          },
        }))
      : [];

    const actionsCol: ColumnDef<DocumentListItem> = {
      id: "actions",
      header: "",
      enableHiding: false,
      enableSorting: false,
      enableResizing: false,
      size: 50,
      cell: ({ row }) => (
        <div className="flex justify-center">
          <RowActions
            docId={row.original.id}
            status={row.original.status}
            runAction={runDocAction}
          />
        </div>
      ),
    };

    return [selectCol, ...fixed, ...dynamicCols, actionsCol];
  }, [isTableMode, sessionColumns, runDocAction]);

  const filteredData = useMemo(
    () =>
      statusFilter === "all"
        ? documents
        : documents.filter((d) => d.status === statusFilter),
    [documents, statusFilter],
  );

  const table = useReactTable({
    data: filteredData,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: setRowSelection,
    onPaginationChange: setPagination,
    state: {
      sorting,
      columnFilters,
      columnVisibility,
      rowSelection,
      pagination,
    },
    initialState: { pagination: { pageSize: DEFAULT_PAGE_SIZE } },
  });

  const detailDoc = pickTarget
    ? (documents.find((d) => d.id === pickTarget.docId) ?? null)
    : null;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-24 text-muted-foreground text-sm">
        Loading documents…
      </div>
    );
  }

  return (
    <div className="w-full">
      {/* Toolbar */}
      <div className="flex items-center gap-2 py-4">
        <Input
          placeholder="Filter filename..."
          value={
            (table.getColumn("filename")?.getFilterValue() as string) ?? ""
          }
          onChange={(e) =>
            table.getColumn("filename")?.setFilterValue(e.target.value)
          }
          className="max-w-sm bg-card"
        />
        {/* Batch actions — shown when rows are selected */}
        {table.getFilteredSelectedRowModel().rows.length > 0 && (
          <BatchToolbar
            count={table.getFilteredSelectedRowModel().rows.length}
            ids={table
              .getFilteredSelectedRowModel()
              .rows.map((r) => r.original.id)}
            onClear={() => setRowSelection({})}
            onRefresh={onRefresh}
          />
        )}
        <Select
          value={statusFilter}
          onValueChange={(v) => {
            setStatusFilter(v);
          }}
        >
          <SelectTrigger className="w-36 bg-card">
            <SelectValue placeholder="All Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            {[
              "QUEUED",
              "SCANNING",
              "PROCESSING",
              "REVIEW",
              "APPROVED",
              "REJECTED",
              "EXPORTED",
              "ERROR",
            ].map((s) => (
              <SelectItem key={s} value={s}>
                {s.charAt(0) + s.slice(1).toLowerCase()}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" className="bg-card">
              Columns <ChevronDown className="ml-2 h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {table
              .getAllColumns()
              .filter((col) => col.getCanHide())
              .map((col) => (
                <DropdownMenuCheckboxItem
                  key={col.id}
                  className="capitalize"
                  checked={col.getIsVisible()}
                  onCheckedChange={(v) => col.toggleVisibility(!!v)}
                >
                  {typeof col.columnDef.header === "string"
                    ? col.columnDef.header
                    : col.id}
                </DropdownMenuCheckboxItem>
              ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <div className="ml-auto flex items-center gap-2">
          <TooltipProvider delayDuration={300}>
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="gap-1.5 text-xs"
                    disabled={onlyImages}
                    onClick={() => setPdfModelOpen(true)}
                  >
                    {selectedPdfModelName}
                    <ChevronsUpDown className="h-3.5 w-3.5" />
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>
                {onlyImages
                  ? "Not used — session contains image files only."
                  : "For extracting text inside of a PDF / Word."}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <TooltipProvider delayDuration={300}>
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="gap-1.5 text-xs"
                    disabled={onlyPdfs}
                    onClick={() => setOcrEngineOpen(true)}
                  >
                    {selectedOcrName}
                    <ChevronsUpDown className="h-3.5 w-3.5" />
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>
                {onlyPdfs
                  ? "Not used — session contains PDF files only."
                  : "Image and PDF containing image only."}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <TooltipProvider delayDuration={300}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-1.5 text-xs"
                  onClick={() => setLlmOpen(true)}
                >
                  {selectedLlmName}
                  <ChevronsUpDown className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                For extracting and transforming data.
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-md border overflow-hidden">
        <Table>
          <TableHeader className="bg-card [&>tr:last-child]:border-b">
            {table.getHeaderGroups().map((hg) => (
              <TableRow key={hg.id}>
                {hg.headers.map((header) => (
                  <TableHead key={header.id}>
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row) => (
                <ContextMenu key={row.id}>
                  <ContextMenuTrigger asChild>
                    <TableRow
                      data-state={row.getIsSelected() && "selected"}
                      className="cursor-pointer"
                      onDoubleClick={() => onReview(row.original.id)}
                    >
                      {row.getVisibleCells().map((cell) => (
                        <TableCell key={cell.id} className="overflow-hidden">
                          <div
                            className="truncate"
                            title={
                              typeof cell.getValue() === "string"
                                ? (cell.getValue() as string)
                                : undefined
                            }
                          >
                            {flexRender(
                              cell.column.columnDef.cell,
                              cell.getContext(),
                            )}
                          </div>
                        </TableCell>
                      ))}
                    </TableRow>
                  </ContextMenuTrigger>
                  {(() => {
                    const show = visibleActions(row.original.status);
                    const hasQueueSection =
                      show.has("play") || show.has("stop");
                    const hasActionSection =
                      show.has("review") ||
                      show.has("approve") ||
                      show.has("reprocess") ||
                      show.has("export");
                    return (
                      <ContextMenuContent className="min-w-[160px]">
                        {show.has("play") && (
                          <ContextMenuItem
                            onClick={() =>
                              runDocAction("play", row.original.id)
                            }
                          >
                            <Play className="h-4 w-4 text-green-500" /> Start
                          </ContextMenuItem>
                        )}
                        {show.has("stop") && (
                          <ContextMenuItem
                            onClick={() =>
                              runDocAction("stop", row.original.id)
                            }
                          >
                            <Square className="h-4 w-4 text-red-500" /> Stop
                          </ContextMenuItem>
                        )}
                        {hasQueueSection && hasActionSection && (
                          <ContextMenuSeparator />
                        )}
                        {show.has("review") && (
                          <ContextMenuItem
                            onClick={() =>
                              runDocAction("review", row.original.id)
                            }
                          >
                            <Eye className="h-4 w-4" /> Review
                          </ContextMenuItem>
                        )}
                        {show.has("approve") && (
                          <ContextMenuItem
                            onClick={() =>
                              runDocAction("approve", row.original.id)
                            }
                          >
                            <CheckCircle2 className="h-4 w-4 text-green-500" />{" "}
                            Approve
                          </ContextMenuItem>
                        )}
                        {show.has("reprocess") && (
                          <ContextMenuItem
                            onClick={() =>
                              runDocAction("reprocess", row.original.id)
                            }
                          >
                            <RotateCcw className="h-4 w-4 text-amber-500" />{" "}
                            Reprocess
                          </ContextMenuItem>
                        )}
                        {show.has("export") && (
                          <ContextMenuItem
                            onClick={() =>
                              runDocAction("export", row.original.id)
                            }
                          >
                            <FileOutput className="h-4 w-4" /> Export
                          </ContextMenuItem>
                        )}
                        <ContextMenuSeparator />
                        <ContextMenuItem
                          className="text-destructive focus:text-destructive"
                          onClick={() =>
                            runDocAction("delete", row.original.id)
                          }
                        >
                          <Trash2 className="h-4 w-4" /> Delete
                        </ContextMenuItem>
                      </ContextMenuContent>
                    );
                  })()}
                </ContextMenu>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="h-24 text-center"
                >
                  No results.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-end space-x-2 py-4">
        <div className="flex-1 text-sm text-muted-foreground">
          {table.getFilteredSelectedRowModel().rows.length} of{" "}
          {table.getFilteredRowModel().rows.length} row(s) selected.
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">Rows per page</span>
            <Select
              value={String(pagination.pageSize)}
              onValueChange={(v) =>
                setPagination({ pageIndex: 0, pageSize: Number(v) })
              }
            >
              <SelectTrigger className="h-8 w-16 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAGE_SIZE_OPTIONS.map((n) => (
                  <SelectItem key={n} value={String(n)} className="text-xs">
                    {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
            >
              Previous
            </Button>
            <span className="text-xs text-muted-foreground px-1">
              {table.getState().pagination.pageIndex + 1} /{" "}
              {table.getPageCount()}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
            >
              Next
            </Button>
          </div>
        </div>
      </div>

      {/* Inline field picker for dynamic columns */}
      {pickTarget && detailDoc && session && (
        <InlineFieldSaver
          doc={detailDoc}
          session={session}
          initialColKey={pickTarget.colKey}
          onClose={() => setPickTarget(null)}
          onSaved={() => {
            setPickTarget(null);
            onRefresh();
          }}
        />
      )}

      <PdfModelDialog
        open={pdfModelOpen}
        onClose={() => setPdfModelOpen(false)}
        sessionId={session?.id}
        currentModel={session?.extractionModel}
        onSelectionChange={setSelectedPdfModelName}
      />
      <OcrEngineDialog
        open={ocrEngineOpen}
        onClose={() => setOcrEngineOpen(false)}
        onSelectionChange={setSelectedOcrName}
      />
      <LlmDialog
        open={llmOpen}
        onClose={() => setLlmOpen(false)}
        onSelectionChange={setSelectedLlmName}
      />
      <ProcessingLogSheet
        open={logSheetOpen}
        documentId={logSheetDocId}
        onOpenChange={(open) => {
          setLogSheetOpen(open);
          if (!open) setLogSheetDocId(null);
        }}
      />
    </div>
  );
}

// ─── Row Detail / Edit Dialog ─────────────────────────────────────────────────

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

// ─── Inline Field Saver (hover crosshair → MiniOcrPicker → auto-save) ─────────

interface InlineFieldSaverProps {
  doc: DocumentListItem;
  session: SessionRecord;
  initialColKey: string;
  onClose: () => void;
  onSaved: () => void;
}

function InlineFieldSaver({
  doc,
  session,
  initialColKey,
  onClose,
  onSaved,
}: InlineFieldSaverProps) {
  const col = session.columns?.find((c) => c.key === initialColKey);

  const handlePick = async (text: string) => {
    try {
      const existing = doc.extractedRow ?? {};
      const newRow = {
        ...Object.fromEntries(Object.entries(existing).map(([k, v]) => [k, v])),
        [initialColKey]: { answer: text, score: 1.0 },
      };
      await documentsApi.update(doc.id, { extractedRow: newRow });
      onSaved();
    } catch (err) {
      console.error("Failed to save field:", err);
      onClose();
    }
  };

  return (
    <MiniOcrPicker
      docId={doc.id}
      fieldLabel={col?.label ?? initialColKey}
      onPick={handlePick}
      onClose={onClose}
    />
  );
}

// ─── Mini OCR Picker ──────────────────────────────────────────────────────────

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
  const isPdfDoc =
    fullDoc?.extractionType === ExtractionType.PDF_TEXT ||
    fullDoc?.extractionType === ExtractionType.PDF_IMAGE ||
    (fullDoc?.filename ?? "").toLowerCase().endsWith(".pdf");

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

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-[92vw] max-h-[92vh] w-[92vw] h-[92vh] p-0 gap-0 flex flex-col">
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

        {loading ? (
          <div className="flex-1 flex items-center justify-center text-muted-foreground gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading document…
          </div>
        ) : (
          <div className="flex-1 flex overflow-hidden min-h-0">
            <div className="w-1/2 flex flex-col border-r">
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
                  onClick={() => {
                    setZoom(1);
                    setRotation(0);
                  }}
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
              <div className="flex-1 overflow-auto bg-muted/20 flex items-start justify-center p-4">
                {fullDoc ? (
                  isPdfDoc ? (
                    <div className="w-full h-full min-h-[420px] rounded border bg-background overflow-hidden">
                      <iframe
                        src={`${imageUrl}#toolbar=1&navpanes=0&view=FitH`}
                        className="w-full h-full border-0"
                        title={fullDoc.filename || "PDF preview"}
                      />
                    </div>
                  ) : (
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
                  )
                ) : (
                  <p className="text-muted-foreground text-sm">
                    No image available.
                  </p>
                )}
              </div>
            </div>

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
