import { useState, useCallback } from "react";
import { useDocuments } from "@/hooks/useDocuments";
import { useQueue } from "@/hooks/useQueue";
import { useWebSocket } from "@/hooks/useWebSocket";
import { StatsCards } from "./StatsCards";
import { FilterBar } from "./FilterBar";
import { DocumentTable } from "./DocumentTable";
import { QueueProgress } from "./QueueProgress";
import { ReviewDialog } from "@/components/ReviewDialog";
import { SettingsDialog } from "@/components/SettingsDialog";
import { Button } from "@/components/ui/button";
import { documentsApi, exportApi } from "@/api/client";
import { FolderOpen, FilePlus, Settings, RefreshCw } from "lucide-react";
import type { WsEvent } from "@shared/types";

export function Dashboard() {
  const { documents, stats, loading, refresh, fetchDocuments } = useDocuments();
  const {
    queueSize,
    processing,
    paused,
    refresh: refreshQueue,
    setQueueSize,
    setProcessing,
  } = useQueue();
  const [reviewDocId, setReviewDocId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState<string>("");

  // WebSocket handler for real-time updates
  const handleWsEvent = useCallback(
    (event: WsEvent) => {
      switch (event.event) {
        case "queue:update":
          setQueueSize(event.data.size);
          setProcessing(event.data.processing);
          break;
        case "document:status":
          refresh();
          break;
        case "processing:progress":
          // Could update a progress indicator per-document
          break;
      }
    },
    [refresh, setQueueSize, setProcessing],
  );

  useWebSocket(handleWsEvent);

  // ─── Actions ────────────────────────────────────────────
  const handleLoadFiles = async () => {
    try {
      const result = await window.api.openFileDialog();
      if (!result.canceled && result.filePaths.length > 0) {
        await documentsApi.loadFiles(result.filePaths);
        refresh();
      }
    } catch (err) {
      console.error("Failed to load files:", err);
    }
  };

  const handleLoadFolder = async () => {
    try {
      const result = await window.api.openFolderDialog();
      if (!result.canceled && result.filePaths.length > 0) {
        await documentsApi.loadFolder(result.filePaths[0]);
        refresh();
      }
    } catch (err) {
      console.error("Failed to load folder:", err);
    }
  };

  const handleExportAll = async () => {
    try {
      const ids = documents.map((d) => d.id);
      if (ids.length === 0) return;
      await exportApi.exportDocuments(ids, "excel");
    } catch (err) {
      console.error("Export all failed:", err);
    }
  };

  const handleFilter = (status: string, search: string) => {
    setStatusFilter(status);
    setSearchQuery(search);
    const params: Record<string, string> = {};
    if (status) params.status = status;
    if (search) params.search = search;
    fetchDocuments(params);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <header className="flex items-center justify-between h-14 px-6 border-b bg-card shrink-0">
        <h1 className="text-lg font-semibold">Dashboard</h1>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleLoadFiles}>
            <FilePlus className="h-4 w-4 mr-2" />
            Load Files
          </Button>
          <Button variant="outline" size="sm" onClick={handleLoadFolder}>
            <FolderOpen className="h-4 w-4 mr-2" />
            Load Folder
          </Button>
          <Button variant="ghost" size="icon" onClick={refresh}>
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setSettingsOpen(true)}
          >
            <Settings className="h-4 w-4" />
          </Button>
        </div>
      </header>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6 space-y-6">
        <StatsCards stats={stats} />

        <FilterBar
          onFilter={handleFilter}
          statusFilter={statusFilter}
          searchQuery={searchQuery}
          onExport={handleExportAll}
        />

        <DocumentTable
          documents={documents}
          loading={loading}
          onReview={(id: string) => setReviewDocId(id)}
          onRefresh={refresh}
        />
      </div>

      {/* Queue Progress */}
      <QueueProgress
        status={{
          length: queueSize,
          processing: !!processing,
          currentDocumentId: processing,
          progress: 0,
        }}
        onRefresh={() => {
          refreshQueue();
          refresh();
        }}
      />

      {/* Review Dialog */}
      {reviewDocId && (
        <ReviewDialog
          documentId={reviewDocId}
          open={!!reviewDocId}
          onClose={() => {
            setReviewDocId(null);
          }}
          onRefresh={refresh}
        />
      )}

      {/* Settings Dialog */}
      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />
    </div>
  );
}
