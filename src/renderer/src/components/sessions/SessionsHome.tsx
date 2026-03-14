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
import {
  CirclePlus,
  Copy,
  Plus,
  RefreshCw,
  Trash2,
  Search,
  ScrollText,
  Loader2,
  FileText,
  Receipt,
  BarChart3,
  ClipboardList,
  Scale,
  BadgeCheck,
  HelpCircle,
} from "lucide-react";
import type { SessionListItem, SessionMode } from "@shared/types";
import { WindowControls } from "@/components/layout/SidebarContext";
import { markUnsaved, nextUnnamedName } from "@/lib/unsaved-sessions";

const drag = { WebkitAppRegion: "drag" } as React.CSSProperties;
const noDrag = { WebkitAppRegion: "no-drag" } as React.CSSProperties;

const MODE_TITLES: Record<SessionMode, string> = {
  PDF_EXTRACT: "Documents to Table Extract",
  OCR_EXTRACT: "OCR Extract",
  TABLE_EXTRACT: "Keyword to Column Extract",
  JSON_EXTRACT: "JSON Extract",
};

function formatRelativeDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) {
    const day = date.toLocaleDateString("en-US", { weekday: "short" });
    const time = date.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    });
    return `${day} at ${time}`;
  }
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function getFileName(filePath: string): string {
  const parts = filePath.split(/[/\\]/);
  return parts[parts.length - 1] || filePath;
}

function uniqueSessionName(baseName: string, existingNames: string[]): string {
  const trimmed = baseName.trim();
  if (!trimmed) return nextUnnamedName(existingNames);

  const nameSet = new Set(existingNames);
  if (!nameSet.has(trimmed)) return trimmed;

  let n = 1;
  while (nameSet.has(`${trimmed} (${n})`)) n++;
  return `${trimmed} (${n})`;
}

const PDF_NEW_CARDS = [
  {
    value: "CONTRACT",
    Icon: ScrollText,
    label: "Contract",
    desc: "Freight rate contracts & agreements",
    placeholder: false,
  },
  {
    value: "INVOICE",
    Icon: Receipt,
    label: "Invoice / Bill",
    desc: "Billing documents & purchase orders",
    placeholder: true,
  },
  {
    value: "REPORT",
    Icon: BarChart3,
    label: "Report / Letter",
    desc: "Business or technical reports",
    placeholder: true,
  },
  {
    value: "FORM",
    Icon: ClipboardList,
    label: "Form / Application",
    desc: "Filled-in forms & registrations",
    placeholder: true,
  },
  {
    value: "ID",
    Icon: BadgeCheck,
    label: "ID / Certificate",
    desc: "Identity documents & licences",
    placeholder: true,
  },
  {
    value: "OTHER",
    Icon: HelpCircle,
    label: "Other",
    desc: "Any other document type",
    placeholder: true,
  },
];

interface SessionsHomeProps {
  mode: SessionMode;
}

export function SessionsHome({ mode }: SessionsHomeProps) {
  const navigate = useNavigate();
  const [sessions, setSessions] = useState<SessionListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [duplicateOpen, setDuplicateOpen] = useState(false);
  const [actionMode, setActionMode] = useState<"none" | "delete" | "duplicate">(
    "none",
  );
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [creating, setCreating] = useState<string | null>(null);

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
      setSessions(data.filter((s) => s.mode === mode));
    } catch (err) {
      console.error("Failed to fetch sessions:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSessions();
  }, [mode]);

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

  const handleNewPdfSession = async (docType: string) => {
    try {
      const result = await window.api.openFileDialog();
      if (result.canceled || result.filePaths.length === 0) return;
      setCreating(docType);
      const selectedFile = result.filePaths[0];
      const allSessions = await sessionsApi.list();
      const inferredName = getFileName(selectedFile);
      const name = uniqueSessionName(
        inferredName,
        allSessions.map((s: SessionListItem) => s.name),
      );
      const session = await sessionsApi.create({
        name,
        mode: "PDF_EXTRACT",
        sourceType: "FILES",
        documentType: docType,
        columns: [],
      });
      // PDF mode is single-document per session.
      const docs = await sessionsApi.ingestFiles(session.id, [selectedFile]);
      const docIds = docs.map((d: { id: string }) => d.id);
      if (docIds.length > 0) {
        await queueApi.add(docIds);
        await queueApi.resume();
      }
      markUnsaved(session.id);
      navigate(`/pdf-sessions/${session.id}`);
    } catch (err) {
      console.error("Failed to create PDF session:", err);
    } finally {
      setCreating(null);
    }
  };

  const handleDeleteSession = async (id: string) => {
    if (!confirm("Delete this session and all its documents?")) return;
    setSessions((prev) => prev.filter((s) => s.id !== id));
    await sessionsApi.remove(id);
  };

  const filteredSessions = useMemo(() => {
    let result = sessions;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter((s) => s.name.toLowerCase().includes(q));
    }
    if (statusFilter !== "all") {
      result = result.filter((s) => s.status === statusFilter);
    }
    return result;
  }, [sessions, searchQuery, statusFilter]);

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

  const selectedSessions = sessions.filter((session) =>
    selectedIds.has(session.id),
  );

  const handleDuplicatesCompleted = async (createdSessionIds: string[]) => {
    setDuplicateOpen(false);
    setSelectedIds(new Set());
    setActionMode("none");
    await fetchSessions();
    if (createdSessionIds.length === 1) {
      navigate(`/sessions/${createdSessionIds[0]}`);
    }
  };

  // ── PDF_EXTRACT: Excel-style home layout ─────────────────────────────────
  if (mode === "PDF_EXTRACT") {
    return (
      <div className="flex flex-col h-full bg-background">
        {/* Header */}
        <header
          className="flex items-stretch h-14 pl-6 border-b shrink-0 pt-0.5"
          style={drag}
        >
          <div className="flex items-center gap-2 flex-1" style={noDrag}>
            <h1 className="text-lg font-semibold">{MODE_TITLES[mode]}</h1>
          </div>
          <WindowControls />
        </header>

        <div className="flex-1 overflow-auto">
          {/* ── New section ───────────────────────────────────────────── */}
          <section className="px-8 pt-8">
            <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-4">
              New
            </h2>
            <div className="flex flex-wrap gap-3">
              {PDF_NEW_CARDS.map(
                ({ value, Icon, label, desc, placeholder }) => {
                  const isCreating = creating === value;
                  return (
                    <button
                      key={value}
                      onClick={() =>
                        !creating && !placeholder && handleNewPdfSession(value)
                      }
                      disabled={creating !== null || placeholder}
                      className="flex flex-col w-36 rounded-lg border bg-card hover:border-primary hover:shadow-md transition-all overflow-hidden text-left disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:hover:border-border disabled:hover:shadow-none"
                    >
                      <div className="relative flex items-center justify-center h-24 w-full bg-primary/10">
                        {isCreating ? (
                          <Loader2 className="h-8 w-8 text-primary animate-spin" />
                        ) : (
                          <Icon className="h-10 w-10 text-primary" />
                        )}
                        {placeholder && (
                          <span className="absolute top-1.5 right-1.5 text-[9px] font-semibold uppercase tracking-wide bg-muted text-muted-foreground px-1.5 py-0.5 rounded-sm">
                            Soon
                          </span>
                        )}
                      </div>
                      <div className="px-3 py-2 border-t">
                        <p className="text-xs font-semibold">{label}</p>
                        <p className="text-[10px] text-muted-foreground leading-snug mt-0.5">
                          {desc}
                        </p>
                      </div>
                    </button>
                  );
                },
              )}
            </div>
          </section>

          {/* ── Recent section ────────────────────────────────────────── */}
          {loading ? (
            <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
              Loading sessions…
            </div>
          ) : sessions.length > 0 ? (
            <section className="px-8 pt-8 pb-8">
              <div className="flex items-center gap-6 mb-3">
                <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground shrink-0">
                  Recent
                </h2>
                <div className="relative max-w-xs flex-1">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    placeholder="Search sessions…"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-8 h-7 text-xs bg-card"
                  />
                </div>
              </div>

              {/* Column headers */}
              <div className="grid grid-cols-[1fr_140px_36px] px-4 py-1.5 text-[11px] font-medium text-muted-foreground border-b">
                <span>Name</span>
                <span>Date</span>
                <span />
              </div>

              <div className="divide-y">
                {filteredSessions.map((session) => (
                  <div
                    key={session.id}
                    className="group grid grid-cols-[1fr_140px_36px] items-center px-4 py-2.5 hover:bg-muted/50 cursor-pointer"
                    onClick={() => navigate(`/pdf-sessions/${session.id}`)}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <FileText className="h-4 w-4 text-primary shrink-0" />
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">
                          {session.name}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {session.documentCount} document
                          {session.documentCount !== 1 ? "s" : ""}
                        </p>
                      </div>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {formatRelativeDate(session.createdAt)}
                    </span>
                    <div className="flex justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteSession(session.id);
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
                {filteredSessions.length === 0 && (
                  <div className="py-8 text-center text-sm text-muted-foreground">
                    No sessions match your search.
                  </div>
                )}
              </div>
            </section>
          ) : null}
        </div>
      </div>
    );
  }

  // ── Other modes: original grid layout ─────────────────────────────────────
  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <header
        className="flex items-stretch h-14 pl-6 border-b shrink-0 pt-0.5"
        style={drag}
      >
        <div className="flex items-center gap-2 flex-1" style={noDrag}>
          <h1 className="text-lg font-semibold">{MODE_TITLES[mode]}</h1>
        </div>
        <WindowControls />
      </header>

      {/* Search, filters, and actions */}
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
        <div className="flex items-center gap-2 ml-auto">
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
                <Button
                  variant="default"
                  size="xs"
                  onClick={handleDuplicateSelected}
                >
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
            size="sm"
          >
            <CirclePlus className="h-4 w-4" />
            New Session
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        {loading ? (
          <div className="flex items-center justify-center h-48 text-muted-foreground">
            Loading sessions...
          </div>
        ) : sessions.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 gap-4 mt-52">
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
                selectionIntent={
                  actionMode === "duplicate" ? "duplicate" : "delete"
                }
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
        defaultMode={mode}
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
