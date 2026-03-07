import { useMemo } from "react";
import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  statusLabel,
  statusColor,
  statusDotColor,
  formatConfidence,
  formatDate,
} from "@/lib/utils";
import { documentsApi, exportApi, queueApi } from "@/api/client";
import {
  Eye,
  RotateCcw,
  FileOutput,
  Trash2,
  CheckCircle2,
  MoreHorizontal,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import type { DocumentListItem } from "@shared/types";

interface FilesTableProps {
  documents: DocumentListItem[];
  loading: boolean;
  selectedId: string | null;
  onSelectId: (id: string) => void;
  onReview: (id: string) => void;
  onRefresh: () => void;
  scrollContainerRef?: React.RefObject<HTMLDivElement>;
  onTableScroll?: () => void;
}

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];
const DEFAULT_PAGE_SIZE = 20;

// ─── Row Actions ──────────────────────────────────────────────────────────────
function RowActions({
  docId,
  onReview,
  onRefresh,
}: {
  docId: string;
  onReview: (id: string) => void;
  onRefresh: () => void;
}) {
  const run = async (action: string) => {
    try {
      switch (action) {
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
  };

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
        <DropdownMenuItem onClick={() => run("review")}>
          <Eye className="h-4 w-4" /> Review
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => run("approve")}>
          <CheckCircle2 className="h-4 w-4 text-green-500" /> Approve
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => run("reprocess")}>
          <RotateCcw className="h-4 w-4 text-amber-500" /> Reprocess
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => run("export")}>
          <FileOutput className="h-4 w-4" /> Export
        </DropdownMenuItem>
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

// ─── Column definitions ───────────────────────────────────────────────────────
function buildColumns(
  onReview: (id: string) => void,
  onRefresh: () => void,
): ColumnDef<DocumentListItem>[] {
  return [
    {
      accessorKey: "filename",
      header: "Filename",
      size: 175,
      cell: ({ row }) => (
        <span
          className="truncate block text-xs font-medium"
          title={row.original.filename}
        >
          {row.original.filename}
        </span>
      ),
    },
    {
      accessorKey: "status",
      header: "Status",
      size: 110,
      cell: ({ row }) => (
        <span
          className={`inline-flex items-center gap-1 font-medium text-xs ${statusColor(row.original.status)}`}
        >
          <span
            className={`inline-block h-1.5 w-1.5 rounded-full shrink-0 ${statusDotColor(row.original.status)}`}
          />
          {statusLabel(row.original.status)}
        </span>
      ),
    },
    {
      accessorKey: "createdAt",
      header: "Scanned",
      size: 130,
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground">
          {formatDate(row.original.createdAt)}
        </span>
      ),
    },
    {
      accessorKey: "ocrAvgConfidence",
      header: "Conf.",
      size: 60,
      cell: ({ row }) => (
        <span className="font-mono text-xs block text-center">
          {formatConfidence(row.original.ocrAvgConfidence)}
        </span>
      ),
    },
    {
      accessorKey: "ocrPageCount",
      header: "Pg",
      size: 44,
      cell: ({ row }) => (
        <span className="font-mono text-xs block text-center">
          {row.original.ocrPageCount || "—"}
        </span>
      ),
    },
    {
      id: "actions",
      header: "",
      size: 44,
      cell: ({ row }) => (
        <div className="flex justify-center">
          <RowActions
            docId={row.original.id}
            onReview={onReview}
            onRefresh={onRefresh}
          />
        </div>
      ),
    },
  ];
}

// ─── Files Table ──────────────────────────────────────────────────────────────
export function FilesTable({
  documents,
  loading,
  selectedId,
  onSelectId,
  onReview,
  onRefresh,
  scrollContainerRef,
  onTableScroll,
}: FilesTableProps) {
  const columns = useMemo(
    () => buildColumns(onReview, onRefresh),
    [onReview, onRefresh],
  );

  const table = useReactTable({
    data: documents,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: DEFAULT_PAGE_SIZE } },
  });

  const { pageIndex, pageSize } = table.getState().pagination;
  const totalRows = documents.length;
  const rangeStart = pageIndex * pageSize + 1;
  const rangeEnd = Math.min((pageIndex + 1) * pageSize, totalRows);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        Loading documents…
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Scrollable table area */}
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-auto"
        onScroll={onTableScroll}
      >
        {documents.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
            <p className="text-sm font-medium">No documents yet</p>
            <p className="text-xs">Add files to this session to get started.</p>
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
                      className="py-2 text-xs font-medium text-muted-foreground"
                    >
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
              {table.getRowModel().rows.map((row) => {
                const isSelected = row.original.id === selectedId;
                return (
                  <TableRow
                    key={row.id}
                    data-state={isSelected ? "selected" : undefined}
                    className="h-10 cursor-pointer divide-x divide-border"
                    onClick={() => onSelectId(row.original.id)}
                    onDoubleClick={() => onReview(row.original.id)}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id} className="py-2 text-xs">
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

      {/* Pagination footer */}
      {totalRows > DEFAULT_PAGE_SIZE && (
        <div className="flex items-center justify-between px-4 py-2.5 border-t border-border bg-card shrink-0">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>
              {rangeStart}–{rangeEnd} of {totalRows}
            </span>
            <Select
              value={String(pageSize)}
              onValueChange={(val) => {
                table.setPageSize(Number(val));
                table.setPageIndex(0);
              }}
            >
              <SelectTrigger className="h-6 w-14 text-xs shadow-sm">
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
          <div className="flex items-center gap-0.5">
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              disabled={!table.getCanPreviousPage()}
              onClick={() => table.previousPage()}
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </Button>
            {(() => {
              const count = table.getPageCount();
              const current = pageIndex + 1;
              const pages: (number | "…")[] = [];
              for (let i = 1; i <= count; i++) {
                if (i === 1 || i === count || Math.abs(i - current) <= 2) {
                  pages.push(i);
                } else if (pages[pages.length - 1] !== "…") {
                  pages.push("…");
                }
              }
              return pages.map((item, idx) =>
                item === "…" ? (
                  <span
                    key={`e${idx}`}
                    className="px-1 text-xs text-muted-foreground"
                  >
                    …
                  </span>
                ) : (
                  <Button
                    key={item}
                    size="sm"
                    variant={item === current ? "default" : "ghost"}
                    className="h-6 w-6 text-xs"
                    onClick={() => table.setPageIndex((item as number) - 1)}
                  >
                    {item}
                  </Button>
                ),
              );
            })()}
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              disabled={!table.getCanNextPage()}
              onClick={() => table.nextPage()}
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
