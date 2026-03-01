import { useState, useRef } from "react";
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
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    docId: string;
  } | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);

  const [colWidths, setColWidths] = useState([160, 112, 144, 64, 48]);
  const resizing = useRef<{
    colIdx: number;
    startX: number;
    startWidth: number;
  } | null>(null);
  const startResize = (e: React.MouseEvent, colIdx: number) => {
    e.preventDefault();
    e.stopPropagation();
    resizing.current = {
      colIdx,
      startX: e.clientX,
      startWidth: colWidths[colIdx],
    };
    const onMove = (ev: MouseEvent) => {
      if (!resizing.current) return;
      const delta = ev.clientX - resizing.current.startX;
      const newW = Math.max(48, resizing.current.startWidth + delta);
      setColWidths((p) => {
        const n = [...p];
        n[resizing.current!.colIdx] = newW;
        return n;
      });
    };
    const onUp = () => {
      resizing.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const totalPages = Math.max(1, Math.ceil(documents.length / pageSize));
  const safeCurrentPage = Math.min(page, totalPages);
  const start = (safeCurrentPage - 1) * pageSize;
  const end = start + pageSize;
  const paginatedDocs = documents.slice(start, end);

  const handlePageSizeChange = (val: string) => {
    setPageSize(Number(val));
    setPage(1);
  };

  const pageNumbers = (() => {
    const delta = 2;
    const range: number[] = [];
    for (
      let i = Math.max(1, safeCurrentPage - delta);
      i <= Math.min(totalPages, safeCurrentPage + delta);
      i++
    )
      range.push(i);
    return range;
  })();

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

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        Loading documents…
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Table */}
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
          <table className="w-full text-sm table-fixed">
            <thead className="sticky top-0 bg-white z-10">
              <tr className="h-10 border-b border-border text-muted-foreground divide-x divide-border">
                {(
                  ["Filename", "Status", "Scanned", "Conf.", "Pg"] as const
                ).map((label, i) => (
                  <th
                    key={label}
                    className={`py-2 font-medium text-xs relative select-none ${
                      i >= 3
                        ? "text-center px-3"
                        : i === 0
                          ? "pl-4 pr-3 text-left"
                          : "px-3 text-left"
                    }`}
                    style={{ width: colWidths[i] }}
                  >
                    {label}
                    <div
                      className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-primary/40 transition-colors z-10"
                      onMouseDown={(e) => startResize(e, i)}
                    />
                  </th>
                ))}
                <th className="px-3 py-2 text-center font-medium text-xs w-10 shrink-0"></th>
              </tr>
            </thead>
            <tbody>
              {paginatedDocs.map((doc) => {
                const isSelected = doc.id === selectedId;
                return (
                  <tr
                    key={doc.id}
                    className={`h-10 border-b border-border cursor-pointer transition-colors divide-x divide-border ${
                      isSelected
                        ? "bg-primary/5 hover:bg-primary/10"
                        : "hover:bg-gray-50"
                    }`}
                    onClick={() => onSelectId(doc.id)}
                    onDoubleClick={() => onReview(doc.id)}
                    onContextMenu={(e) => handleContextMenu(e, doc.id)}
                  >
                    <td className="pl-4 pr-3 py-2 font-medium text-foreground max-w-[160px]">
                      <span className="truncate block text-xs">
                        {doc.filename}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`inline-flex items-center gap-1 font-medium text-xs ${statusColor(doc.status)}`}
                      >
                        <span
                          className={`inline-block h-1.5 w-1.5 rounded-full shrink-0 ${statusDotColor(doc.status)}`}
                        />
                        {statusLabel(doc.status)}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground text-xs">
                      {formatDate(doc.createdAt)}
                    </td>
                    <td className="px-3 py-2 text-center font-mono text-xs">
                      {formatConfidence(doc.ocrAvgConfidence)}
                    </td>
                    <td className="px-3 py-2 text-center font-mono text-xs">
                      {doc.ocrPageCount || "—"}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleContextMenu(
                            e as unknown as React.MouseEvent,
                            doc.id,
                          );
                        }}
                      >
                        <MoreHorizontal className="h-3.5 w-3.5" />
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination footer */}
      {documents.length > DEFAULT_PAGE_SIZE && (
        <div className="flex items-center justify-between px-4 py-2.5 border-t border-border bg-white shrink-0">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>
              {start + 1}–{Math.min(end, documents.length)} of{" "}
              {documents.length}
            </span>
            <Select
              value={String(pageSize)}
              onValueChange={handlePageSizeChange}
            >
              <SelectTrigger className="h-6 w-14 text-xs bg-white shadow-sm">
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
              disabled={safeCurrentPage === 1}
              onClick={() => setPage((p) => p - 1)}
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </Button>
            {pageNumbers.map((n) => (
              <Button
                key={n}
                size="sm"
                variant={n === safeCurrentPage ? "default" : "ghost"}
                className={`h-6 w-6 text-xs ${n === safeCurrentPage ? "bg-primary text-white" : ""}`}
                onClick={() => setPage(n)}
              >
                {n}
              </Button>
            ))}
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              disabled={safeCurrentPage === totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}

      {/* Context Menu */}
      {contextMenu && (
        <>
          <div className="fixed inset-0 z-40" onClick={closeContextMenu} />
          <div
            className="fixed z-50 min-w-[160px] rounded-lg border border-border bg-white p-1 shadow-lg"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            {[
              {
                icon: <Eye className="h-4 w-4" />,
                label: "Review",
                action: "review",
              },
              {
                icon: <CheckCircle2 className="h-4 w-4 text-green-500" />,
                label: "Approve",
                action: "approve",
              },
              {
                icon: <RotateCcw className="h-4 w-4 text-amber-500" />,
                label: "Reprocess",
                action: "reprocess",
              },
              {
                icon: <FileOutput className="h-4 w-4" />,
                label: "Export",
                action: "export",
              },
            ].map(({ icon, label, action }) => (
              <button
                key={action}
                className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-sm hover:bg-gray-50 transition-colors"
                onClick={() => handleAction(action, contextMenu.docId)}
              >
                {icon} {label}
              </button>
            ))}
            <div className="my-1 h-px bg-border" />
            <button
              className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-sm hover:bg-gray-50 transition-colors text-red-500"
              onClick={() => handleAction("delete", contextMenu.docId)}
            >
              <Trash2 className="h-4 w-4" /> Delete
            </button>
          </div>
        </>
      )}
    </div>
  );
}
