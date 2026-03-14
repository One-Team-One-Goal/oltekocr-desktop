import { useState, useCallback, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { sessionsApi, exportApi, documentsApi, ocrApi } from "@/api/client";
import { useWebSocket } from "@/hooks/useWebSocket";
import { WindowControls } from "@/components/layout/SidebarContext";
import { ExtractionView } from "./ExtractionPanel";
import { checkUnsaved, markSaved } from "@/lib/unsaved-sessions";
import { toast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ArrowLeft,
  RefreshCw,
  FileOutput,
  FileText,
  SaveOff,
  Pencil,
  X,
} from "lucide-react";
import type { SessionRecord, DocumentListItem, WsEvent } from "@shared/types";

const drag = { WebkitAppRegion: "drag" } as React.CSSProperties;
const noDrag = { WebkitAppRegion: "no-drag" } as React.CSSProperties;

export function PdfSessionDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [session, setSession] = useState<SessionRecord | null>(null);
  const [documents, setDocuments] = useState<DocumentListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [isUnsaved, setIsUnsaved] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [isReprocessing, setIsReprocessing] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [rawOpen, setRawOpen] = useState(false);
  const [tablesOpen, setTablesOpen] = useState(false);

  const refresh = useCallback(async () => {
    if (!id) return;
    try {
      const [sessionData, docsData] = await Promise.all([
        sessionsApi.get(id),
        sessionsApi.getDocuments(id),
      ]);

      // Non-PDF sessions should use the legacy detail page.
      if (sessionData.mode !== "PDF_EXTRACT") {
        navigate(`/sessions/${id}`, { replace: true });
        return;
      }

      setSession(sessionData);
      setDocuments(docsData);

      if (docsData.length > 0) {
        setSelectedDocId((prev) => prev ?? docsData[0].id);
      } else {
        setSelectedDocId(null);
      }

      const unsaved = checkUnsaved(id);
      setIsUnsaved(unsaved);
      if (unsaved) setSaveName(sessionData.name);
    } catch (err) {
      console.error("Failed to fetch PDF session:", err);
    } finally {
      setLoading(false);
    }
  }, [id, navigate]);

  useEffect(() => {
    setLoading(true);
    refresh();
  }, [refresh]);

  const handleWsEvent = useCallback(
    (event: WsEvent) => {
      if (event.event === "document:status" || event.event === "queue:update") {
        refresh();
      }
    },
    [refresh],
  );
  useWebSocket(handleWsEvent);

  const handleSave = async () => {
    if (!id || !saveName.trim()) return;
    await sessionsApi.rename(id, saveName.trim());
    if (isUnsaved) {
      markSaved(id);
      setIsUnsaved(false);
    }
    setIsRenaming(false);
    setSession((prev) => (prev ? { ...prev, name: saveName.trim() } : prev));
  };

  const handleBack = () => {
    if (id && isUnsaved) {
      markSaved(id);
    }
    navigate("/");
  };

  const handleExport = async () => {
    const ids = documents.map((d) => d.id);
    if (ids.length === 0) return;
    setIsExporting(true);
    try {
      const result = await exportApi.exportDocuments(ids, "excel");
      const exportPath = result?.exportPath;
      if (!exportPath) throw new Error("No export path returned by server");

      const defaultName = exportPath.split(/[\\/]/).pop() || "contract_export.xlsx";
      const picked = await window.api.saveFileDialog({
        title: "Save Exported Excel",
        defaultPath: defaultName,
        filters: [{ name: "Excel Workbook", extensions: ["xlsx"] }],
      });

      if (picked?.canceled || !picked?.filePath) {
        toast({
          title: "Export created",
          description: "Saved in app exports folder.",
          actionLabel: "Show in folder",
          onAction: () => window.api.showItemInFolder(exportPath),
        });
        return;
      }

      await window.api.copyFile(exportPath, picked.filePath);
      toast({
        title: "Export successful",
        description: `Saved to: ${picked.filePath.split(/[\\/]/).pop()}`,
        actionLabel: "Show in folder",
        onAction: () => {
          window.api.showItemInFolder(picked.filePath);
        },
      });
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

  const handleReprocess = async () => {
    if (!selectedDocId || isReprocessing) return;
    setIsReprocessing(true);
    try {
      await documentsApi.reprocess(selectedDocId);
      await ocrApi.process(selectedDocId);
      refresh();
    } finally {
      setIsReprocessing(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        Loading session...
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-background">
      <header
        className="flex items-stretch h-14 pl-4 border-b shrink-0"
        style={drag}
      >
        <div className="flex items-center gap-2 min-w-0 flex-1" style={noDrag}>
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0"
            onClick={handleBack}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>

          {isUnsaved || isRenaming ? (
            <div className="flex items-center gap-2 min-w-0">
              {isUnsaved && (
                <SaveOff className="h-4 w-4 text-amber-500 shrink-0" />
              )}
              <Input
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSave();
                  if (e.key === "Escape" && !isUnsaved) setIsRenaming(false);
                }}
                placeholder="Session name..."
                className="h-7 max-w-[180px] text-xs"
                autoFocus
              />
              <Button
                size="sm"
                className="h-7 text-xs shrink-0"
                onClick={handleSave}
                disabled={!saveName.trim()}
              >
                Save
              </Button>
              {isRenaming && !isUnsaved && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0"
                  onClick={() => setIsRenaming(false)}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2 min-w-0">
              <h1 className="text-base font-semibold truncate">
                {session?.name ?? "PDF Session"}
              </h1>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 shrink-0"
                title="Rename session"
                onClick={() => {
                  setSaveName(session?.name ?? "");
                  setIsRenaming(true);
                }}
              >
                <Pencil className="h-3 w-3" />
              </Button>
            </div>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0" style={noDrag}>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 text-xs"
            onClick={handleExport}
            disabled={isExporting}
          >
            <FileOutput className="h-3.5 w-3.5" />
            {isExporting ? "Exporting…" : "Export"}
          </Button>
          <Button variant="ghost" size="icon" onClick={refresh}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
        <WindowControls />
      </header>

      <div className="flex flex-1 min-h-0 overflow-hidden pl-4 pb-4">
        {selectedDocId ? (
          <div className="w-full h-full min-h-0">
            <ExtractionView
              documentId={selectedDocId}
              onClose={handleBack}
              onRefresh={refresh}
              hideTopBar
              onReprocess={handleReprocess}
              rawOpen={rawOpen}
              onRawOpenChange={setRawOpen}
              tablesOpen={tablesOpen}
              onTablesOpenChange={setTablesOpen}
            />
          </div>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground border rounded-md">
            No document found in this session.
          </div>
        )}
      </div>
    </div>
  );
}
