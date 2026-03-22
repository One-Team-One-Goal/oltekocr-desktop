import { useState, useCallback, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { sessionsApi, queueApi, exportApi } from "@/api/client";
import { useWebSocket } from "@/hooks/useWebSocket";
import { SessionDataTable } from "./SessionDataTable";
import { ReviewDialog } from "@/components/ReviewDialog";
import { ContractReviewDialog } from "./ContractReviewDialog";
import { EditColumnsDialog } from "./EditColumnsDialog";
import { WindowControls } from "@/components/layout/SidebarContext";
import { ExtractionView } from "./ExtractionPanel";
import { checkUnsaved, markSaved } from "@/lib/unsaved-sessions";
import { toast } from "@/hooks/use-toast";

const drag = { WebkitAppRegion: "drag" } as React.CSSProperties;
const noDrag = { WebkitAppRegion: "no-drag" } as React.CSSProperties;
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
  const [isExporting, setIsExporting] = useState(false);
  const [isUnsaved, setIsUnsaved] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [queueState, setQueueState] = useState<{
    size: number;
    processing: string | null;
  }>({ size: 0, processing: null });
  const [progressByDocId, setProgressByDocId] = useState<
    Record<string, { progress: number; message: string }>
  >({});
  const prevQueueActiveRef = useRef(false);
  const statusMapRef = useRef<Record<string, string>>({});
  const statusInitializedRef = useRef(false);
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
      // Check unsaved status once session name is loaded
      if (id) {
        const unsaved = checkUnsaved(id);
        setIsUnsaved(unsaved);
        if (unsaved) setSaveName(sessionData.name);
      }
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

  useEffect(() => {
    let active = true;
    queueApi
      .status()
      .then((data) => {
        if (!active) return;
        setQueueState({
          size: Number(data?.size ?? 0),
          processing: data?.processing ?? null,
        });
      })
      .catch((err) => {
        console.warn("Failed to load queue status:", err);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (session?.mode === "PDF_EXTRACT" && id) {
      navigate(`/pdf-sessions/${id}`, { replace: true });
    }
  }, [session?.mode, id, navigate]);

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

  // PDF mode is single-document per session; open that document immediately.
  useEffect(() => {
    if (session?.mode !== "PDF_EXTRACT") return;
    if (selectedDocId) return;
    if (documents.length > 0) {
      setSelectedDocId(documents[0].id);
    }
  }, [session?.mode, documents, selectedDocId]);

  // ── WebSocket ──────────────────────────────────────────
  const handleWsEvent = useCallback(
    (event: WsEvent) => {
      if (event.event === "queue:update") {
        setQueueState({
          size: Number(event.data.size ?? 0),
          processing: event.data.processing ?? null,
        });
        refresh();
        return;
      }
      if (event.event === "processing:progress") {
        const { id: docId, progress, message } = event.data;
        setProgressByDocId((prev) => ({
          ...prev,
          [docId]: { progress, message },
        }));
        return;
      }
      if (event.event === "document:status") {
        refresh();
      }
    },
    [refresh],
  );
  useWebSocket(handleWsEvent);

  useEffect(() => {
    const isQueueActive = queueState.size > 0 || !!queueState.processing;
    if (prevQueueActiveRef.current && !isQueueActive) {
      toast({
        title: "Queue complete",
        description: "All queued files finished processing.",
      });
    }
    prevQueueActiveRef.current = isQueueActive;
  }, [queueState]);

  useEffect(() => {
    if (!statusInitializedRef.current) {
      for (const doc of documents) {
        statusMapRef.current[doc.id] = doc.status;
      }
      statusInitializedRef.current = true;
      return;
    }

    for (const doc of documents) {
      const prevStatus = statusMapRef.current[doc.id];
      if (prevStatus && prevStatus !== doc.status && doc.status === "REVIEW") {
        toast({
          title: "File processed",
          description: doc.filename,
        });
      }
      statusMapRef.current[doc.id] = doc.status;
    }
  }, [documents]);

  useEffect(() => {
    if (!isRunning) return;
    const timer = window.setInterval(() => {
      refresh();
    }, 2000);
    return () => window.clearInterval(timer);
  }, [isRunning, refresh]);

  // ── Save / back (unsaved sessions) ────────────────────
  const modeToRoute: Record<string, string> = {
    PDF_EXTRACT: "/",
    OCR_EXTRACT: "/ocr-extract",
    TABLE_EXTRACT: "/keyword-extract",
  };

  const handleSave = async () => {
    if (!id || !saveName.trim()) return;
    await sessionsApi.rename(id, saveName.trim());
    markSaved(id);
    setIsUnsaved(false);
    setSession((prev) => (prev ? { ...prev, name: saveName.trim() } : prev));
  };

  const handleBack = () => {
    if (id && isUnsaved) {
      markSaved(id); // accept the auto-generated "Unnamed N" name
    }
    navigate(modeToRoute[session?.mode ?? "PDF_EXTRACT"] ?? "/");
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
    setIsExporting(true);
    try {
      const result = await exportApi.exportDocuments(ids, "excel");

      const exportPath = result?.exportPath;
      if (!exportPath) {
        throw new Error("No export path returned by server");
      }

      if (session?.mode === "TABLE_EXTRACT") {
        const sessionName = (session.name || "Session")
          .replace(/[\\/:*?"<>|]/g, "_")
          .trim()
          .replace(/\s+/g, "_")
          .replace(/_+/g, "_")
          .slice(0, 120);
        const suggestedName = `${sessionName || "Session"}_${new Date().toISOString().slice(0, 10)}.xlsx`;

        const picked = await window.api.saveFileDialog({
          title: "Save Exported Excel",
          defaultPath: suggestedName,
          filters: [{ name: "Excel Workbook", extensions: ["xlsx"] }],
        });

        if (picked?.canceled || !picked?.filePath) {
          toast({
            title: "Export created",
            description: "Saved in app exports folder.",
            actionLabel: "Show in folder",
            onAction: () => window.api.showItemInFolder(exportPath),
          });
        } else {
          await window.api.copyFile(exportPath, picked.filePath);
          toast({
            title: "Export successful",
            description: `Saved to: ${picked.filePath.split(/[\\/]/).pop()}`,
            actionLabel: "Show in folder",
            onAction: () => window.api.showItemInFolder(picked.filePath),
          });
        }
      } else {
        await window.api.showItemInFolder(exportPath).catch(() => {});
      }

      refresh();
    } catch (err: any) {
      console.error("Export failed:", err);
      toast({
        title: "Export failed",
        description: err?.message || "Unknown error",
        variant: "destructive",
      });
    } finally {
      setIsExporting(false);
    }
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

  const selectedReviewDocument = reviewDocId
    ? (documents.find((d) => d.id === reviewDocId) ?? null)
    : null;
  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <header
        className="flex items-stretch h-14 pl-4 border-b shrink-0"
        style={drag}
      >
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0"
            onClick={handleBack}
            style={noDrag}
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
        <div className="flex items-center gap-1.5 shrink-0" style={noDrag}>
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

          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 text-xs"
            onClick={handleExport}
            disabled={isExporting}
          >
            <FileOutput className="h-3.5 w-3.5" />
            {isExporting ? "Exporting..." : "Export"}
          </Button>

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
        <WindowControls />
      </header>

      {/* Inline save bar — shown for newly created unsaved sessions */}
      {isUnsaved && (
        <div className="flex items-center gap-3 px-4 py-2 bg-amber-500/10 border-b border-amber-500/25 shrink-0">
          <span className="text-xs font-medium text-amber-600 dark:text-amber-400 shrink-0">
            Unsaved session
          </span>
          <Input
            value={saveName}
            onChange={(e) => setSaveName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSave()}
            placeholder="Session name…"
            className="h-7 max-w-xs text-xs"
          />
          <Button
            size="sm"
            className="h-7 text-xs"
            onClick={handleSave}
            disabled={!saveName.trim()}
          >
            Save
          </Button>
        </div>
      )}

      {/* Stats + filter */}
      <div className="px-4 pt-4 pb-3 space-y-3 shrink-0">
        {session?.mode === "PDF_EXTRACT" ? (
          <div className="rounded-md border bg-card px-4 py-2">
            <div className="grid grid-cols-[1.8fr_1fr_1fr_0.8fr_0.8fr_0.6fr_0.8fr_1fr] gap-3 text-[11px] font-medium text-muted-foreground">
              <span>Filename</span>
              <span>Status</span>
              <span>Scanned</span>
              <span>Time</span>
              <span>Conf.</span>
              <span>Pg</span>
              <span>Time</span>
              <span>Ext. Type</span>
            </div>
          </div>
        ) : (
          <SessionStatsStrip stats={stats} />
        )}
      </div>

      {/* Content area — PDF_EXTRACT with a selected doc: full-area extraction view */}
      {session?.mode === "PDF_EXTRACT" && selectedDocId ? (
        <ExtractionView
          documentId={selectedDocId}
          onClose={() => setSelectedDocId(null)}
          onRefresh={refresh}
        />
      ) : (
        <div className="flex-1 min-h-0 overflow-auto px-4 pb-4">
          <SessionDataTable
            documents={filteredDocs}
            loading={loading}
            session={session}
            onReview={setReviewDocId}
            onRefresh={refresh}
            selectedDocId={selectedDocId ?? undefined}
            onSelectDoc={setSelectedDocId}
          />
        </div>
      )}

      {/* Review Dialog — OCR/TABLE sessions */}
      {reviewDocId && session?.mode !== "PDF_EXTRACT" && (
        <ReviewDialog
          documentId={reviewDocId}
          open={!!reviewDocId}
          onClose={() => setReviewDocId(null)}
          onRefresh={refresh}
          session={session}
          selectedDocument={selectedReviewDocument}
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
