import { useState, useCallback, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Panel, Group as PanelGroup } from "react-resizable-panels";
import { sessionsApi, queueApi, documentsApi, exportApi } from "@/api/client";
import { useWebSocket } from "@/hooks/useWebSocket";
import { FilesTable } from "./FilesTable";
import { ExtractedTable } from "./ExtractedTable";
import { ReviewDialog } from "@/components/ReviewDialog";
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
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reviewDocId, setReviewDocId] = useState<string | null>(null);
  const [editColumnsOpen, setEditColumnsOpen] = useState(false);

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
      const docs = await sessionsApi.ingestFiles(id!, result.filePaths);
      await queueApi.add(docs.map((d: any) => d.id));
      refresh();
    }
  };

  const handleAddFolder = async () => {
    const result = await window.api.openFolderDialog();
    if (!result.canceled && result.filePaths.length > 0) {
      const docs = await sessionsApi.ingestFolder(id!, result.filePaths[0]);
      await queueApi.add(docs.map((d: any) => d.id));
      refresh();
    }
  };

  // ── Export session ─────────────────────────────────────
  const handleExport = async () => {
    const ids = documents.map((d) => d.id);
    if (ids.length === 0) return;
    await exportApi.exportDocuments(ids, "excel");
  };

  // ── Scroll sync ────────────────────────────────────────────────────────────
  const leftScrollRef = useRef<HTMLDivElement>(null);
  const rightScrollRef = useRef<HTMLDivElement>(null);
  const syncing = useRef(false);

  const handleLeftScroll = () => {
    if (syncing.current || !leftScrollRef.current || !rightScrollRef.current)
      return;
    syncing.current = true;
    rightScrollRef.current.scrollTop = leftScrollRef.current.scrollTop;
    syncing.current = false;
  };

  const handleRightScroll = () => {
    if (syncing.current || !leftScrollRef.current || !rightScrollRef.current)
      return;
    syncing.current = true;
    leftScrollRef.current.scrollTop = rightScrollRef.current.scrollTop;
    syncing.current = false;
  };

  // ── Mode badge ─────────────────────────────────────────
  const modeBadge =
    session?.mode === "TABLE_EXTRACT" ? (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-violet-50 text-violet-700 border border-violet-200 text-xs font-medium">
        <Table2 className="h-3 w-3" />
        Table Extract
      </span>
    ) : (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200 text-xs font-medium">
        <FileText className="h-3 w-3" />
        OCR Extract
      </span>
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
      <header className="flex items-center justify-between h-14 px-4 border-b bg-card shrink-0 gap-3">
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
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 text-xs"
            onClick={handleAddFiles}
          >
            <FilePlus className="h-3.5 w-3.5" />
            Add Files
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 text-xs"
            onClick={handleAddFolder}
          >
            <FolderOpen className="h-3.5 w-3.5" />
            Add Folder
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 text-xs"
            onClick={handleExport}
          >
            <FileOutput className="h-3.5 w-3.5" />
            Export
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
      </header>

      {/* Stats + filter */}
      <div className="px-4 pt-4 pb-3 space-y-3 shrink-0">
        <SessionStatsStrip stats={stats} />

        {/* Filter bar */}
        <div className="flex items-center gap-2 bg-card border border-border rounded-xl shadow-sm px-3 py-2">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-8 w-36 text-xs border-0 shadow-none bg-transparent">
              <SelectValue placeholder="All Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-xs">
                All Status
              </SelectItem>
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
                <SelectItem key={s} value={s} className="text-xs capitalize">
                  {s.charAt(0) + s.slice(1).toLowerCase()}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="h-4 w-px bg-border" />
          <div className="relative flex-1">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Search filename…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-8 pl-7 text-xs border-0 shadow-none bg-transparent focus-visible:ring-0"
            />
          </div>
        </div>
      </div>

      {/* Split pane: Files | Extracted */}
      <div className="flex-1 min-h-0 px-4 pb-4">
        <PanelGroup
          orientation="horizontal"
          className="h-full bg-card border border-border rounded-xl shadow-sm overflow-hidden"
        >
          {/* Left: Files Table */}
          <Panel defaultSize={45} minSize={25}>
            <div className="h-full flex flex-col">
              <div className="px-4 py-2.5 border-b border-border bg-muted/40 shrink-0">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Files · {filteredDocs.length}
                </p>
              </div>
              <div className="flex-1 min-h-0">
                <FilesTable
                  documents={filteredDocs}
                  loading={loading}
                  selectedId={selectedId}
                  onSelectId={setSelectedId}
                  onReview={setReviewDocId}
                  onRefresh={refresh}
                  scrollContainerRef={leftScrollRef}
                  onTableScroll={handleLeftScroll}
                />
              </div>
            </div>
          </Panel>

          {/* Drag handle */}
          <div className="w-1 bg-border hover:bg-primary/40 transition-colors cursor-col-resize shrink-0" />

          {/* Right: Extracted Table */}
          <Panel defaultSize={55} minSize={25}>
            <div className="h-full flex flex-col">
              <div className="px-4 py-2.5 border-b border-border bg-muted/40 shrink-0">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  {session?.mode === "TABLE_EXTRACT"
                    ? `Extracted Fields · ${session.columns.length} columns`
                    : "OCR Output"}
                </p>
              </div>
              <div className="flex-1 min-h-0">
                <ExtractedTable
                  documents={filteredDocs}
                  session={session}
                  selectedId={selectedId}
                  onSelectId={setSelectedId}
                  onRefresh={refresh}
                  scrollContainerRef={rightScrollRef}
                  onTableScroll={handleRightScroll}
                />
              </div>
            </div>
          </Panel>
        </PanelGroup>
      </div>

      {/* Review Dialog */}
      {reviewDocId && (
        <ReviewDialog
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
