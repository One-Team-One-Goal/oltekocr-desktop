import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { sessionsApi, queueApi } from "@/api/client";
import { SessionCard } from "./SessionCard";
import { NewSessionDialog } from "./NewSessionDialog";
import { DuplicateSessionDialog } from "./DuplicateSessionDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CirclePlus, Copy, Plus, RefreshCw, Trash2, Search } from "lucide-react";
import type { SessionListItem } from "@shared/types";

export function SessionsHome() {
  const navigate = useNavigate();
  const [sessions, setSessions] = useState<SessionListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [duplicateOpen, setDuplicateOpen] = useState(false);
  const [actionMode, setActionMode] = useState<"none" | "delete" | "duplicate">("none");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState("");
  const [modeFilter, setModeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  const toggleActionMode = (nextMode: "delete" | "duplicate") => {
    setActionMode((prev) => (prev === nextMode ? "none" : nextMode));
    setSelectedIds(new Set());
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleDeleteSelected = async () => {
    const ids = [...selectedIds];
    if (
      !confirm(
        `Delete ${ids.length} session${ids.length > 1 ? "s" : ""} and all their documents?`,
      )
    )
      return;
    setSessions((prev) => prev.filter((s) => !selectedIds.has(s.id)));
    setSelectedIds(new Set());
    setActionMode("none");
    await Promise.all(ids.map((id) => sessionsApi.remove(id)));
  };

  const handleDuplicateSelected = () => {
    if (selectedIds.size === 0) return;
    setDuplicateOpen(true);
  };

  const fetchSessions = async () => {
    try {
      setLoading(true);
      const data = await sessionsApi.list();
      setSessions(data);
    } catch (err) {
      console.error("Failed to fetch sessions:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSessions();
  }, []);

  const handleRename = async (id: string, name: string) => {
    try {
      await sessionsApi.rename(id, name);
      setSessions((prev) =>
        prev.map((s) => (s.id === id ? { ...s, name } : s)),
      );
    } catch (err) {
      console.error("Failed to rename session:", err);
    }
  };

  const filteredSessions = useMemo(() => {
    let result = sessions;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter((s) => s.name.toLowerCase().includes(q));
    }
    if (modeFilter !== "all") {
      result = result.filter((s) => s.mode === modeFilter);
    }
    if (statusFilter !== "all") {
      result = result.filter((s) => s.status === statusFilter);
    }
    return result;
  }, [sessions, searchQuery, modeFilter, statusFilter]);

  const handleSessionCreated = async (sessionId: string, docIds: string[]) => {
    setDialogOpen(false);
    // Queue all ingested documents
    if (docIds.length > 0) {
      try {
        await queueApi.add(docIds);
      } catch (err) {
        console.error("Failed to queue documents:", err);
      }
    }
    navigate(`/sessions/${sessionId}`);
  };

  const selectedSessions = sessions.filter((session) => selectedIds.has(session.id));

  const handleDuplicatesCompleted = async (createdSessionIds: string[]) => {
    setDuplicateOpen(false);
    setSelectedIds(new Set());
    setActionMode("none");
    await fetchSessions();
    if (createdSessionIds.length === 1) {
      navigate(`/sessions/${createdSessionIds[0]}`);
    }
  };

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <header className="flex items-center justify-between h-14 px-6 border-b shrink-0">
        <h1 className="text-lg font-semibold">Sessions</h1>
        <div className="flex items-center gap-2">
          {actionMode === "delete" ? (
            <>
              {selectedIds.size > 0 && (
                <Button
                  variant="destructive"
                  size="xs"
                  onClick={handleDeleteSelected}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete ({selectedIds.size})
                </Button>
              )}
              <Button
                variant="secondary"
                size="xs"
                onClick={() => toggleActionMode("delete")}
              >
                Cancel
              </Button>
            </>
          ) : actionMode === "duplicate" ? (
            <>
              {selectedIds.size > 0 && (
                <Button variant="default" size="xs" onClick={handleDuplicateSelected}>
                  <Copy className="h-3.5 w-3.5" />
                  Duplicate ({selectedIds.size})
                </Button>
              )}
              <Button
                variant="secondary"
                size="xs"
                onClick={() => toggleActionMode("duplicate")}
              >
                Cancel
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" size="icon" onClick={fetchSessions}>
                <RefreshCw className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => toggleActionMode("duplicate")}
                title="Select sessions to duplicate"
              >
                <Copy className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => toggleActionMode("delete")}
                title="Select sessions to delete"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </>
          )}
          <Button
            onClick={() => setDialogOpen(true)}
            variant="default"
            size="xs"
          >
            <CirclePlus className="h-4 w-4" />
            New Session
          </Button>
        </div>
      </header>

      {/* Search and filters */}
      {sessions.length > 0 && (
        <div className="flex items-center gap-2 px-6 pt-4">
          <div className="relative max-w-xs flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Search sessions..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 h-8 text-xs bg-card"
            />
          </div>
          <Select value={modeFilter} onValueChange={setModeFilter}>
            <SelectTrigger className="w-32 h-8 text-xs bg-card">
              <SelectValue placeholder="All Modes" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Modes</SelectItem>
              <SelectItem value="OCR_EXTRACT">OCR Extract</SelectItem>
              <SelectItem value="TABLE_EXTRACT">Table Extract</SelectItem>
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-32 h-8 text-xs bg-card">
              <SelectValue placeholder="All Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="PENDING">Pending</SelectItem>
              <SelectItem value="PROCESSING">Processing</SelectItem>
              <SelectItem value="DONE">Done</SelectItem>
              <SelectItem value="ERROR">Error</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        {loading ? (
          <div className="flex items-center justify-center h-48 text-muted-foreground">
            Loading sessions...
          </div>
        ) : sessions.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 gap-4">
            <div className="rounded-full bg-muted p-6">
              <Plus className="h-8 w-8 text-muted-foreground" />
            </div>
            <div className="text-center">
              <p className="text-base font-medium">No sessions yet</p>
              <p className="text-sm text-muted-foreground mt-1">
                Create a session to start scanning and extracting documents.
              </p>
            </div>
            <Button onClick={() => setDialogOpen(true)} className="gap-2">
              <Plus className="h-4 w-4" />
              New Session
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filteredSessions.map((session) => (
              <SessionCard
                key={session.id}
                session={session}
                selectMode={actionMode !== "none"}
                selectionIntent={actionMode === "duplicate" ? "duplicate" : "delete"}
                selected={selectedIds.has(session.id)}
                onSelect={() => toggleSelect(session.id)}
                onOpen={() => navigate(`/sessions/${session.id}`)}
                onRename={handleRename}
              />
            ))}
            {filteredSessions.length === 0 && (
              <div className="col-span-full text-center py-12 text-muted-foreground text-sm">
                No sessions match your filters.
              </div>
            )}
          </div>
        )}
      </div>

      <NewSessionDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onCreated={handleSessionCreated}
      />

      <DuplicateSessionDialog
        open={duplicateOpen}
        sessions={selectedSessions}
        onClose={() => {
          setDuplicateOpen(false);
        }}
        onCompleted={handleDuplicatesCompleted}
      />
    </div>
  );
}
