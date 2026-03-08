import { useState, useCallback, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { sessionsApi, queueApi, exportApi } from "@/api/client";
import { useWebSocket } from "@/hooks/useWebSocket";
import { SessionDataTable } from "./SessionDataTable";
import { ReviewDialog } from "@/components/ReviewDialog";
import { ContractReviewDialog } from "./ContractReviewDialog";
import { EditColumnsDialog } from "./EditColumnsDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ArrowLeft,
  FilePlus,
  FolderOpen,
  RefreshCw,
  FileOutput,
  Search,
  Table2,
  FileText,
  Columns,
  Play,
  Square,
  Loader2,
} from "lucide-react";
import type {
  SessionRecord,
  DocumentListItem,
  DashboardStats,
  WsEvent,
} from "@shared/types";

// ─── Stats Strip ──────────────────────────────────────────
function SessionStatsStrip({ stats }: { stats: DashboardStats | null }) {
  if (!stats) return null;

  const cells = [
    { label: "Total", value: stats.total, dot: "bg-gray-400" },
    { label: "Pending Review", value: stats.review, dot: "bg-[#a87527]" },
    {
      label: "In Queue",
      value: stats.queued + stats.processing,
      dot: "bg-amber-500",
    },
    { label: "Approved", value: stats.approved, dot: "bg-green-500" },
    { label: "Rejected", value: stats.rejected, dot: "bg-red-500" },
    {
      label: "Avg Confidence",
      value:
        stats.avgConfidence > 0 ? `${stats.avgConfidence.toFixed(1)}%` : "—",
      dot: "bg-blue-500",
    },
  ];

  return (
    <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden shrink-0">
      <div className="flex divide-x divide-border">
        {cells.map(({ label, value, dot }) => (
          <div key={label} className="flex-1 px-4 py-3 min-w-0">
            <p className="text-2xl font-bold text-foreground leading-none">
              {value}
            </p>
            <div className="flex items-center gap-1.5 mt-1.5">
              <span
                className={`inline-block h-2 w-2 rounded-full shrink-0 ${dot}`}
              />
              <span className="text-xs text-muted-foreground truncate">
                {label}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Session Detail ───────────────────────────────────────
export function SessionDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [session, setSession] = useState<SessionRecord | null>(null);
  const [documents, setDocuments] = useState<DocumentListItem[]>([]);
  const [filteredDocs, setFilteredDocs] = useState<DocumentListItem[]>([]);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [reviewDocId, setReviewDocId] = useState<string | null>(null);
  const [editColumnsOpen, setEditColumnsOpen] = useState(false);
  const [isStopPending, setIsStopPending] = useState(false);
  // Derived — true while any doc is actively running (not counting CANCELLING, so
  // pressing Stop flips the button to Play immediately even if Python is still finishing up)
  const isRunning = documents.some(
    (d) => d.status === "SCANNING" || d.status === "PROCESSING",
  );
  const isCancelling = documents.some((d) => d.status === "CANCELLING");

  useEffect(() => {
    // Clear pending state once active docs have transitioned out of running/cancelling.
    if (!isRunning && !isCancelling) {
      setIsStopPending(false);
    }
  }, [isRunning, isCancelling]);

  // Filter state
  const [statusFilter, setStatusFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");

  // ── Data fetching ──────────────────────────────────────
  const refresh = useCallback(async () => {
    if (!id) return;
    try {
      const [sessionData, docsData, statsData] = await Promise.all([
        sessionsApi.get(id),
        sessionsApi.getDocuments(id),
        sessionsApi.getStats(id),
      ]);
      setSession(sessionData);
      setDocuments(docsData);
      setStats(statsData);
    } catch (err) {
      console.error("Failed to fetch session:", err);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    setLoading(true);
    refresh();
  }, [refresh]);

  // ── Apply filters ──────────────────────────────────────
  useEffect(() => {
    let result = documents;
    if (statusFilter && statusFilter !== "all") {
      result = result.filter((d) => d.status === statusFilter);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter((d) => d.filename.toLowerCase().includes(q));
    }
    setFilteredDocs(result);
  }, [documents, statusFilter, searchQuery]);

  // ── WebSocket ──────────────────────────────────────────
  const handleWsEvent = useCallback(
    (event: WsEvent) => {
      if (event.event === "document:status" || event.event === "queue:update") {
        refresh();
      }
    },
    [refresh],
  );
  useWebSocket(handleWsEvent);

  // ── Add files ──────────────────────────────────────────
  const handleAddFiles = async () => {
    const result = await window.api.openFileDialog();
    if (!result.canceled && result.filePaths.length > 0) {
      await sessionsApi.ingestFiles(id!, result.filePaths);
      refresh();
    }
  };

  const handleAddFolder = async () => {
    const result = await window.api.openFolderDialog();
    if (!result.canceled && result.filePaths.length > 0) {
      await sessionsApi.ingestFolder(id!, result.filePaths[0]);
      refresh();
    }
  };

  // ── Play / Stop ──────────────────────────────────────────
  const handlePlayStop = async () => {
    if (isRunning) {
      setIsStopPending(true);
      await queueApi.pause();
      // Cancel any in-flight docs so they immediately flip to CANCELLING
      const activeIds = documents
        .filter((d) => d.status === "SCANNING" || d.status === "PROCESSING")
        .map((d) => d.id);
      if (activeIds.length > 0) {
        await queueApi.cancel(activeIds).catch(() => {});
      } else {
        setIsStopPending(false);
      }
    } else {
      const queuedIds = documents
        .filter((d) => d.status === "QUEUED")
        .map((d) => d.id);
      if (queuedIds.length > 0) {
        await queueApi.add(queuedIds);
      }
      await queueApi.resume();
    }
    refresh();
  };

  // ── Export session ─────────────────────────────────────
  const handleExport = async () => {
    const ids = documents.map((d) => d.id);
    if (ids.length === 0) return;
    await exportApi.exportDocuments(ids, "excel");
  };

  // ── Mode badge ─────────────────────────────────────────
  const modeBadge =
    session?.mode === "TABLE_EXTRACT" ? (
      <Table2 className="h-4 w-4" />
    ) : (
      <FileText className="h-3 w-3" />
    );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        Loading session…
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <header className="flex items-center justify-between h-14 px-4 border-b shrink-0 gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0"
            onClick={() => navigate("/")}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex items-center gap-2 min-w-0">
            <h1 className="text-base font-semibold truncate">
              {session?.name ?? "Session"}
            </h1>
            {modeBadge}
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {/* Play / Stop */}
          {(() => {
            const canStart =
              !isRunning &&
              !isStopPending &&
              !isCancelling &&
              documents.some((d) => d.status === "QUEUED");
            return (
              <Button
                variant={isRunning || isStopPending ? "destructive" : "ghost"}
                size="sm"
                className="gap-1.5 text-xs"
                onClick={handlePlayStop}
                disabled={isStopPending || (!isRunning && !canStart)}
              >
                {isStopPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : isRunning ? (
                  <Square className="h-3.5 w-3.5" />
                ) : (
                  <Play className="h-3.5 w-3.5" />
                )}
              </Button>
            );
          })()}

          {/* Add / Export button group */}
          <div className="flex">
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 text-xs rounded-r-none border-r-0"
              onClick={handleAddFiles}
            >
              <FilePlus className="h-3.5 w-3.5" />
              Add Files
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 text-xs rounded-none border-r-0"
              onClick={handleAddFolder}
            >
              <FolderOpen className="h-3.5 w-3.5" />
              Add Folder
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 text-xs rounded-l-none"
              onClick={handleExport}
            >
              <FileOutput className="h-3.5 w-3.5" />
              Export
            </Button>
          </div>

          <Button variant="ghost" size="icon" onClick={refresh}>
            <RefreshCw className="h-4 w-4" />
          </Button>
          {session?.mode === "TABLE_EXTRACT" && (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 text-xs"
              onClick={() => setEditColumnsOpen(true)}
            >
              <Columns className="h-3.5 w-3.5" />
              Edit Columns
            </Button>
          )}
        </div>
      </header>

      {/* Stats + filter */}
      <div className="px-4 pt-4 pb-3 space-y-3 shrink-0">
        <SessionStatsStrip stats={stats} />
      </div>

      {/* Unified data table */}
      <div className="flex-1 min-h-0 overflow-auto px-4 pb-4">
        <SessionDataTable
          documents={filteredDocs}
          loading={loading}
          session={session}
          onReview={setReviewDocId}
          onRefresh={refresh}
        />
      </div>

      {/* Review Dialog — OCR/TABLE sessions */}
      {reviewDocId && session?.mode !== "PDF_EXTRACT" && (
        <ReviewDialog
          documentId={reviewDocId}
          open={!!reviewDocId}
          onClose={() => setReviewDocId(null)}
          onRefresh={refresh}
        />
      )}

      {/* Contract Review Dialog — PDF_EXTRACT sessions */}
      {reviewDocId && session?.mode === "PDF_EXTRACT" && (
        <ContractReviewDialog
          documentId={reviewDocId}
          open={!!reviewDocId}
          onClose={() => setReviewDocId(null)}
          onRefresh={refresh}
        />
      )}

      {/* Edit Columns Dialog */}
      {editColumnsOpen && session?.mode === "TABLE_EXTRACT" && (
        <EditColumnsDialog
          open={editColumnsOpen}
          session={session}
          onClose={() => setEditColumnsOpen(false)}
          onSaved={refresh}
        />
      )}
    </div>
  );
}
