import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  statusLabel,
  statusColor,
  statusDotColor,
  formatConfidence,
  formatTime,
  formatDate,
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
} from "lucide-react";
import type { DocumentListItem } from "@shared/types";

interface DocumentTableProps {
  documents: DocumentListItem[];
  loading: boolean;
  onReview: (id: string) => void;
  onRefresh: () => void;
}

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];
const DEFAULT_PAGE_SIZE = 20;

export function DocumentTable({
  documents,
  loading,
  onReview,
  onRefresh,
}: DocumentTableProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    docId: string;
  } | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);

  // ── Pagination ────────────────────────────────────────
  const totalPages = Math.max(1, Math.ceil(documents.length / pageSize));
  const safeCurrentPage = Math.min(page, totalPages);
  const start = (safeCurrentPage - 1) * pageSize;
  const end = start + pageSize;
  const paginatedDocs = documents.slice(start, end);

  const handlePageSizeChange = (val: string) => {
    setPageSize(Number(val));
    setPage(1);
  };

  // Visible page buttons (max 5 centered around current)
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

  // ── Context menu ─────────────────────────────────────
  const handleContextMenu = (e: React.MouseEvent, docId: string) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, docId });
  };

  const closeContextMenu = () => setContextMenu(null);

  const handleAction = async (action: string, docId: string) => {
    closeContextMenu();
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

  // ── States ────────────────────────────────────────────
  if (loading) {
    return (
      <div className="bg-white border border-border rounded-xl flex items-center justify-center h-64 text-muted-foreground shadow-sm">
        Loading documents...
      </div>
    );
  }

  return (
    <div className="bg-white border border-border rounded-xl shadow-sm overflow-hidden">
      {/* Table header row */}
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-border">
        <h2 className="text-base font-semibold text-foreground">
          All Documents
        </h2>
        <div className="flex items-center gap-2">
          {selectedIds.size > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleBulkExport}
              className="text-xs shadow-sm"
            >
              <FileOutput className="h-3.5 w-3.5 mr-1" />
              Export {selectedIds.size} selected
            </Button>
          )}
        </div>
      </div>

      {/* Empty state */}
      {documents.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-48 text-muted-foreground gap-2">
          <p className="text-base font-medium">No documents yet</p>
          <p className="text-sm">
            Load files or set up a folder watcher to get started.
          </p>
        </div>
      ) : (
        <>
          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="pl-5 pr-3 py-3 text-left font-medium w-8">
                    <input
                      type="checkbox"
                      checked={
                        selectedIds.size === paginatedDocs.length &&
                        paginatedDocs.length > 0
                      }
                      onChange={toggleSelectAll}
                      className="rounded-sm"
                    />
                  </th>
                  <th className="px-4 py-3 text-left font-medium">Filename</th>
                  <th className="px-4 py-3 text-left font-medium w-28">
                    Status
                  </th>
                  <th className="px-4 py-3 text-left font-medium w-36">
                    Scanned
                  </th>
                  <th className="px-4 py-3 text-center font-medium w-20">
                    Conf.
                  </th>
                  <th className="px-4 py-3 text-center font-medium w-16">
                    Pages
                  </th>
                  <th className="px-4 py-3 text-center font-medium w-16">
                    Tables
                  </th>
                  <th className="px-4 py-3 text-left font-medium w-28">
                    Notes
                  </th>
                  <th className="px-4 py-3 text-center font-medium w-16">
                    Action
                  </th>
                </tr>
              </thead>
              <tbody>
                {paginatedDocs.map((doc) => (
                  <tr
                    key={doc.id}
                    className="border-b border-border last:border-0 hover:bg-gray-50 cursor-pointer transition-colors"
                    onDoubleClick={() => onReview(doc.id)}
                    onContextMenu={(e) => handleContextMenu(e, doc.id)}
                  >
                    <td className="pl-5 pr-3 py-3">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(doc.id)}
                        onChange={() => toggleSelect(doc.id)}
                        className="rounded-sm"
                        onClick={(e) => e.stopPropagation()}
                      />
                    </td>
                    <td className="px-4 py-3 font-medium text-foreground max-w-[220px]">
                      <span className="truncate block">{doc.filename}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center gap-1.5 font-medium ${statusColor(doc.status)}`}
                      >
                        <span
                          className={`inline-block h-2 w-2 rounded-full shrink-0 ${statusDotColor(doc.status)}`}
                        />
                        {statusLabel(doc.status)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">
                      {formatDate(doc.createdAt)}
                    </td>
                    <td className="px-4 py-3 text-center font-mono text-xs">
                      {formatConfidence(doc.ocrAvgConfidence)}
                    </td>
                    <td className="px-4 py-3 text-center font-mono text-xs">
                      {doc.ocrPageCount || "—"}
                    </td>
                    <td className="px-4 py-3 text-center font-mono text-xs">
                      {doc.ocrTableCount || "—"}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">
                      <span className="truncate block max-w-[100px]">
                        {doc.notes || "—"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleContextMenu(
                            e as unknown as React.MouseEvent,
                            doc.id,
                          );
                        }}
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination footer */}
          <div className="flex items-center justify-between px-5 py-3.5 border-t border-border">
            {/* Showing X-Y of N + per-page selector */}
            <div className="flex items-center gap-3 text-sm text-muted-foreground">
              <span>
                Showing {documents.length === 0 ? 0 : start + 1} to{" "}
                {Math.min(end, documents.length)} of {documents.length}{" "}
                documents
              </span>
              <div className="flex items-center gap-1.5">
                <span className="text-xs">Show:</span>
                <Select
                  value={String(pageSize)}
                  onValueChange={handlePageSizeChange}
                >
                  <SelectTrigger className="h-7 w-16 text-xs bg-white shadow-sm">
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
                <span className="text-xs">per page</span>
              </div>
            </div>

            {/* Page number buttons */}
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8 shadow-sm"
                disabled={safeCurrentPage === 1}
                onClick={() => setPage((p) => p - 1)}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>

              {pageNumbers[0] > 1 && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 w-8 shadow-sm text-xs"
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
                  className={`h-8 w-8 text-xs shadow-sm ${n === safeCurrentPage ? "bg-primary text-primary-foreground hover:bg-primary/90" : "bg-white"}`}
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
                    className="h-8 w-8 shadow-sm text-xs"
                    onClick={() => setPage(totalPages)}
                  >
                    {totalPages}
                  </Button>
                </>
              )}

              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8 shadow-sm"
                disabled={safeCurrentPage === totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </>
      )}

      {/* Context Menu */}
      {contextMenu && (
        <>
          <div className="fixed inset-0 z-40" onClick={closeContextMenu} />
          <div
            className="fixed z-50 min-w-[160px] rounded-lg border border-border bg-white p-1 shadow-lg"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            <CtxItem
              icon={<Eye className="h-4 w-4" />}
              label="Review"
              onClick={() => handleAction("review", contextMenu.docId)}
            />
            <CtxItem
              icon={<CheckCircle2 className="h-4 w-4 text-green-500" />}
              label="Approve"
              onClick={() => handleAction("approve", contextMenu.docId)}
            />
            <CtxItem
              icon={<RotateCcw className="h-4 w-4 text-amber-500" />}
              label="Reprocess"
              onClick={() => handleAction("reprocess", contextMenu.docId)}
            />
            <CtxItem
              icon={<FileOutput className="h-4 w-4" />}
              label="Export"
              onClick={() => handleAction("export", contextMenu.docId)}
            />
            <div className="my-1 h-px bg-border" />
            <CtxItem
              icon={<Trash2 className="h-4 w-4 text-red-500" />}
              label="Delete"
              className="text-red-500"
              onClick={() => handleAction("delete", contextMenu.docId)}
            />
          </div>
        </>
      )}
    </div>
  );
}

function CtxItem({
  icon,
  label,
  onClick,
  className = "",
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      className={`flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-sm hover:bg-gray-50 transition-colors ${className}`}
      onClick={onClick}
    >
      {icon} {label}
    </button>
  );
}
