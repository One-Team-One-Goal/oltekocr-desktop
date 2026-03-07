import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  formatConfidence,
  formatDate,
  cn,
} from "@/lib/utils";
import { documentsApi, exportApi } from "@/api/client";
import {
  Eye,
  RotateCcw,
  FileOutput,
  Trash2,
  CheckCircle2,
  MoreHorizontal,
  ChevronLeft,
  ChevronRight,
  Search,
} from "lucide-react";
import type { DocumentListItem } from "@shared/types";

interface DocumentTableProps {
  documents: DocumentListItem[];
  loading: boolean;
  onReview: (id: string) => void;
  onRefresh: () => void;
  onFilter: (status: string, search: string) => void;
  onExport: () => void;
  statusFilter: string;
  searchQuery: string;
}

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];
const DEFAULT_PAGE_SIZE = 20;

const TABS = [
  { value: "", label: "All" },
  { value: "REVIEW", label: "Pending Review" },
  { value: "QUEUED", label: "In Queue" },
  { value: "APPROVED", label: "Approved" },
  { value: "REJECTED", label: "Rejected" },
];

function StatusBadge({ status }: { status: string }) {
  const isDone = status === "APPROVED" || status === "EXPORTED";
  const isError = status === "REJECTED" || status === "ERROR";
  const isReview = status === "REVIEW";
  const isActive =
    status === "QUEUED" || status === "SCANNING" || status === "PROCESSING";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full border",
        isDone && "bg-green-500/10 text-green-400 border-green-500/20",
        isError && "bg-red-500/10 text-red-400 border-red-500/20",
        isReview && "bg-purple-500/10 text-purple-400 border-purple-500/20",
        isActive && "bg-amber-500/10 text-amber-400 border-amber-500/20",
        !isDone &&
          !isError &&
          !isReview &&
          !isActive &&
          "bg-zinc-500/10 text-zinc-400 border-zinc-500/20",
      )}
    >
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full shrink-0",
          isDone && "bg-green-400",
          isError && "bg-red-400",
          isReview && "bg-purple-400",
          isActive && "bg-amber-400",
          !isDone && !isError && !isReview && !isActive && "bg-zinc-400",
        )}
      />
      {statusLabel(status)}
    </span>
  );
}

export function DocumentTable({
  documents,
  loading,
  onReview,
  onRefresh,
  onFilter,
  onExport,
  statusFilter,
  searchQuery,
}: DocumentTableProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [localSearch, setLocalSearch] = useState(searchQuery);

  const handleTabChange = (value: string) => {
    setPage(1);
    onFilter(value, localSearch);
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    onFilter(statusFilter, localSearch);
  };

  // ── Pagination ────────────────────────────────────────
  const totalPages = Math.max(1, Math.ceil(documents.length / pageSize));
  const safeCurrentPage = Math.min(page, totalPages);
  const start = (safeCurrentPage - 1) * pageSize;
  const end = start + pageSize;
  const paginatedDocs = documents.slice(start, end);

  const pageNumbers = (() => {
    const delta = 2;
    const range: number[] = [];
    for (
      let i = Math.max(1, safeCurrentPage - delta);
      i <= Math.min(totalPages, safeCurrentPage + delta);
      i++
    ) {
      range.push(i);
    }
    return range;
  })();

  // ── Selection ────────────────────────────────────────
  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === paginatedDocs.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(paginatedDocs.map((d) => d.id)));
    }
  };

  // ── Actions ──────────────────────────────────────────
  const handleAction = async (action: string, docId: string) => {
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

  const handleBulkExport = async () => {
    if (selectedIds.size === 0) return;
    try {
      await exportApi.exportDocuments(Array.from(selectedIds), "excel");
      onRefresh();
    } catch (err) {
      console.error("Bulk export failed:", err);
    }
  };

  return (
    <div className="rounded-xl border border-border/50 overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/50 gap-3">
        <Tabs
          value={statusFilter || ""}
          onValueChange={handleTabChange}
          className="w-auto"
        >
          <TabsList className="h-8 bg-secondary/40 p-0.5 gap-0.5">
            {TABS.map((tab) => (
              <TabsTrigger
                key={tab.value}
                value={tab.value}
                className="h-7 px-3 text-xs data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm"
              >
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <div className="flex items-center gap-2 ml-auto">
          {selectedIds.size > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleBulkExport}
              className="h-8 text-xs gap-1.5"
            >
              <FileOutput className="h-3.5 w-3.5" />
              Export {selectedIds.size}
            </Button>
          )}
          <form onSubmit={handleSearch} className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
            <Input
              placeholder="Search..."
              value={localSearch}
              onChange={(e) => setLocalSearch(e.target.value)}
              className="h-8 pl-8 w-44 text-xs bg-secondary/30 border-border/50"
            />
          </form>
          <Button
            variant="outline"
            size="sm"
            onClick={onExport}
            className="h-8 text-xs gap-1.5"
          >
            <FileOutput className="h-3.5 w-3.5" />
            Export All
          </Button>
        </div>
      </div>

      {/* Loading */}
      {loading ? (
        <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">
          Loading documents...
        </div>
      ) : documents.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-48 text-muted-foreground gap-2">
          <p className="text-sm font-medium">No documents found</p>
          <p className="text-xs">Load files or adjust your filters.</p>
        </div>
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow className="border-border/50 hover:bg-transparent">
                <TableHead className="w-10 pl-4">
                  <Checkbox
                    checked={
                      selectedIds.size === paginatedDocs.length &&
                      paginatedDocs.length > 0
                    }
                    onCheckedChange={toggleSelectAll}
                  />
                </TableHead>
                <TableHead>Filename</TableHead>
                <TableHead className="w-36">Status</TableHead>
                <TableHead className="w-36">Scanned</TableHead>
                <TableHead className="w-20 text-center">Conf.</TableHead>
                <TableHead className="w-16 text-center">Pages</TableHead>
                <TableHead className="w-16 text-center">Tables</TableHead>
                <TableHead className="w-28">Notes</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginatedDocs.map((doc) => (
                <TableRow
                  key={doc.id}
                  className="border-border/50 cursor-pointer"
                  onDoubleClick={() => onReview(doc.id)}
                >
                  <TableCell className="pl-4">
                    <Checkbox
                      checked={selectedIds.has(doc.id)}
                      onCheckedChange={() => toggleSelect(doc.id)}
                      onClick={(e) => e.stopPropagation()}
                    />
                  </TableCell>
                  <TableCell className="font-medium max-w-[200px]">
                    <span className="truncate block">{doc.filename}</span>
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={doc.status} />
                  </TableCell>
                  <TableCell className="text-muted-foreground text-xs">
                    {formatDate(doc.createdAt)}
                  </TableCell>
                  <TableCell className="text-center font-mono text-xs text-muted-foreground">
                    {formatConfidence(doc.ocrAvgConfidence)}
                  </TableCell>
                  <TableCell className="text-center font-mono text-xs text-muted-foreground">
                    {doc.ocrPageCount || "—"}
                  </TableCell>
                  <TableCell className="text-center font-mono text-xs text-muted-foreground">
                    {doc.ocrTableCount || "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-xs">
                    <span className="truncate block max-w-[100px]">
                      {doc.notes || "—"}
                    </span>
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-foreground"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-40">
                        <DropdownMenuItem
                          onClick={() => handleAction("review", doc.id)}
                        >
                          <Eye className="h-4 w-4 mr-2" />
                          Review
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => handleAction("approve", doc.id)}
                        >
                          <CheckCircle2 className="h-4 w-4 mr-2 text-green-500" />
                          Approve
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => handleAction("reprocess", doc.id)}
                        >
                          <RotateCcw className="h-4 w-4 mr-2 text-amber-500" />
                          Reprocess
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => handleAction("export", doc.id)}
                        >
                          <FileOutput className="h-4 w-4 mr-2" />
                          Export
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onClick={() => handleAction("delete", doc.id)}
                          className="text-red-400 focus:text-red-400"
                        >
                          <Trash2 className="h-4 w-4 mr-2" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {/* Pagination */}
          <div className="flex items-center justify-between px-4 py-3 border-t border-border/50">
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span>
                {documents.length === 0 ? "0" : start + 1}–
                {Math.min(end, documents.length)} of {documents.length}
              </span>
              <div className="flex items-center gap-1.5">
                <span>Show</span>
                <Select
                  value={String(pageSize)}
                  onValueChange={(val) => {
                    setPageSize(Number(val));
                    setPage(1);
                  }}
                >
                  <SelectTrigger className="h-7 w-14 text-xs">
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
            </div>

            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="icon"
                className="h-7 w-7"
                disabled={safeCurrentPage === 1}
                onClick={() => setPage((p) => p - 1)}
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </Button>

              {pageNumbers[0] > 1 && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 w-7 text-xs"
                    onClick={() => setPage(1)}
                  >
                    1
                  </Button>
                  {pageNumbers[0] > 2 && (
                    <span className="px-1 text-muted-foreground text-xs">
                      …
                    </span>
                  )}
                </>
              )}

              {pageNumbers.map((n) => (
                <Button
                  key={n}
                  size="sm"
                  variant={n === safeCurrentPage ? "default" : "outline"}
                  className="h-7 w-7 text-xs"
                  onClick={() => setPage(n)}
                >
                  {n}
                </Button>
              ))}

              {pageNumbers[pageNumbers.length - 1] < totalPages && (
                <>
                  {pageNumbers[pageNumbers.length - 1] < totalPages - 1 && (
                    <span className="px-1 text-muted-foreground text-xs">
                      …
                    </span>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 w-7 text-xs"
                    onClick={() => setPage(totalPages)}
                  >
                    {totalPages}
                  </Button>
                </>
              )}

              <Button
                variant="outline"
                size="icon"
                className="h-7 w-7"
                disabled={safeCurrentPage === totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
