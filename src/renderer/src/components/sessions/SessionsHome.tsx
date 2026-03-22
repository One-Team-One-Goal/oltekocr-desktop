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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  LayoutGrid,
  LayoutList,
  Pencil,
  MoreVertical,
  Star,
} from "lucide-react";
import type { SessionListItem, SessionMode } from "@shared/types";
import { WindowControls } from "@/components/layout/SidebarContext";
import { markUnsaved, nextUnnamedName } from "@/lib/unsaved-sessions";
import {
  SchemaBuilderDialog,
  type SchemaPresetDraft,
} from "./SchemaBuilderDialog";
import { AutoSchemaBuilderDialog } from "./AutoSchemaBuilderDialog";

// Load all file-type icons via glob (handles special chars in filenames)
const _svgModules = import.meta.glob("../../assets/icons/*.svg", {
  eager: true,
  import: "default",
}) as Record<string, string>;

// Map lowercase extension -> resolved URL
const FILE_ICON_MAP: Record<string, string> = {};
for (const [path, url] of Object.entries(_svgModules)) {
  const m = path.match(/File Type=([A-Z]+)\.svg$/i);
  if (m) FILE_ICON_MAP[m[1].toLowerCase()] = url;
}

function getFileIcon(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "pdf";
  return FILE_ICON_MAP[ext] ?? FILE_ICON_MAP["pdf"] ?? "";
}

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
    placeholder: false,
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
  const [pdfViewMode, setPdfViewMode] = useState<"list" | "cards">("list");
  const [pdfRenamingId, setPdfRenamingId] = useState<string | null>(null);
  const [pdfRenameValue, setPdfRenameValue] = useState("");
  const [starredIds, setStarredIds] = useState<Set<string>>(new Set());
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [schemaModeDialogOpen, setSchemaModeDialogOpen] = useState(false);
  const [manualSchemaBuilderOpen, setManualSchemaBuilderOpen] =
    useState(false);
  const [autoSchemaBuilderOpen, setAutoSchemaBuilderOpen] = useState(false);
  const [schemaBuilderSubmitting, setSchemaBuilderSubmitting] = useState(false);

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

  const createPdfSession = async (docType: string, schemaPresetId?: string) => {
    try {
      const result = await window.api.openFileDialog();
      if (result.canceled || result.filePaths.length === 0) return;
      setCreating(docType);
      const selectedFiles = result.filePaths;
      const allSessions = await sessionsApi.list();
      const inferredName =
        selectedFiles.length === 1
          ? getFileName(selectedFiles[0])
          : `${getFileName(selectedFiles[0])} (+${selectedFiles.length - 1})`;
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
      if (schemaPresetId) {
        await sessionsApi.assignSessionSchemaPreset(session.id, schemaPresetId);
      }

      const docs = await sessionsApi.ingestFiles(session.id, selectedFiles);
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

  const handleNewPdfSession = async (docType: string) => {
    if (docType === "OTHER") {
      setSchemaModeDialogOpen(true);
      return;
    }
    await createPdfSession(docType);
  };

  const saveSchemaPreset = async (preset: SchemaPresetDraft) => {
    const trimmedName = preset.name.trim();
    if (!trimmedName) {
      throw new Error("Schema name is required.");
    }

    return sessionsApi.createSchemaPreset({
      name: trimmedName,
      extractionMode: preset.extractionMode,
      recordStartRegex: preset.recordStartRegex,
      tabs: preset.tabs.map((tab) => ({
        name: tab.name,
        fields: tab.fields.map((field) => ({
          label: field.label,
          fieldKey: field.fieldKey,
          regexRule: field.regexRule,
          extractionStrategy: field.extractionStrategy,
          dataType: field.dataType,
          pageRange: field.pageRange,
          postProcessing: field.postProcessing,
          altRegexRules: field.altRegexRules,
          sectionHint: field.sectionHint,
          sectionIndicatorKey: field.sectionIndicatorKey,
          contextHint: field.contextHint,
          contextLabel: field.contextLabel,
          mandatory: field.mandatory,
          expectedFormat: field.expectedFormat,
          minLength: field.minLength,
          maxLength: field.maxLength,
          allowedValues: field.allowedValues,
        })),
      })),
    });
  };

  const handleSchemaBuilderSubmit = async (preset: SchemaPresetDraft, modeType: "manual" | "auto") => {
    setSchemaBuilderSubmitting(true);
    try {
      const created = await saveSchemaPreset(preset);
      if (modeType === "manual") {
        setManualSchemaBuilderOpen(false);
      } else {
        setAutoSchemaBuilderOpen(false);
      }
      await createPdfSession("OTHER", created.id);
    } catch (err) {
      console.error("Failed to create schema for OTHER document type:", err);
    } finally {
      setSchemaBuilderSubmitting(false);
    }
  };

  const handleDeleteSession = async (id: string) => {
    setSessions((prev) => prev.filter((s) => s.id !== id));
    setStarredIds((prev) => {
      const n = new Set(prev);
      n.delete(id);
      return n;
    });
    await sessionsApi.remove(id);
  };

  const toggleStar = (id: string) => {
    setStarredIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
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
    // Starred sessions float to the top
    return [...result].sort((a, b) => {
      const aS = starredIds.has(a.id) ? 0 : 1;
      const bS = starredIds.has(b.id) ? 0 : 1;
      return aS - bS;
    });
  }, [sessions, searchQuery, statusFilter, starredIds]);

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
      <>
        <div className="flex flex-col h-full bg-background">
          {/* Header */}
          <header
            className="flex items-stretch h-14 pl-6 border-b shrink-0 pt-0.5"
            style={drag}
          >
            <div className="flex items-center gap-2 flex-1">
              <h1 className="text-lg font-semibold">{MODE_TITLES[mode]}</h1>
            </div>
            <WindowControls />
          </header>

          <div className="flex-1 overflow-auto">
            {/* ── New section ───────────────────────────────────────────── */}
            <section className="px-8 pt-8">
              <h2 className="text-xs font-semibold uppercase tracking-widest mb-4">
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
                          !creating &&
                          !placeholder &&
                          handleNewPdfSession(value)
                        }
                        disabled={creating !== null || placeholder}
                        className="relative flex flex-col w-28 h-32 border bg-card hover:border-primary transition-colors text-left disabled:opacity-50 focus-visible:outline-none disabled:cursor-not-allowed rounded-xl"
                        style={{
                          clipPath:
                            "polygon(0 0, calc(100% - 24px) 0, 100% 24px, 100% 100%, 0 100%)",
                        }}
                      >
                        {/* Folded corner — auto-clipped to a triangle by parent clip-path */}
                        <span className="absolute top-0 right-0 w-6 h-6 bg-muted" />
                        {/* Loading spinner overlay */}
                        {isCreating && (
                          <span className="absolute inset-0 flex items-center justify-center bg-card/70">
                            <Loader2 className="h-5 w-5 text-primary animate-spin" />
                          </span>
                        )}
                        {placeholder && (
                          <span className="absolute top-1.5 left-2.5 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
                            Soon
                          </span>
                        )}
                        <div className="flex flex-col justify-end flex-1 px-3 pb-3 pt-6">
                          <p className="text-xs font-semibold leading-tight">
                            {label}
                          </p>
                          <p className="text-[10px] text-muted-foreground leading-snug mt-1">
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
                <div className="flex items-center gap-6 mb-3 justify-between">
                  <div className="flex items-center gap-6">
                    <h2 className="text-xs font-semibold uppercase tracking-widest shrink-0">
                      Recent
                    </h2>
                    <div className="relative max-w-xs flex-1" style={noDrag}>
                      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                      <Input
                        placeholder="Search sessions…"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="pl-8 h-7 text-xs bg-card"
                      />
                    </div>
                  </div>
                  <div
                    className="flex items-center gap-0.5 shrink-0"
                    style={noDrag}
                  >
                    <Button
                      variant={pdfViewMode === "list" ? "secondary" : "ghost"}
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => setPdfViewMode("list")}
                      title="List view"
                    >
                      <LayoutList className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant={pdfViewMode === "cards" ? "secondary" : "ghost"}
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => setPdfViewMode("cards")}
                      title="Cards view"
                    >
                      <LayoutGrid className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>

                {pdfViewMode === "list" ? (
                  <>
                    {/* Column headers */}
                    <div className="grid grid-cols-[1fr_140px_60px] px-4 py-1.5 text-[11px] font-medium text-muted-foreground border-b">
                      <span>Name</span>
                      <span>Date</span>
                      <span className="text-right">Actions</span>
                    </div>

                    <div className="divide-y">
                      {filteredSessions.map((session) => {
                        const isStarred = starredIds.has(session.id);
                        return (
                          <div
                            key={session.id}
                            className="group grid grid-cols-[1fr_140px_60px] items-center px-4 py-2.5 hover:bg-muted/50 cursor-pointer"
                            onClick={() => {
                              if (pdfRenamingId === session.id) return;
                              navigate(`/pdf-sessions/${session.id}`);
                            }}
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              <img
                                src={getFileIcon(session.name)}
                                className="h-5 w-5 shrink-0 opacity-50"
                                alt=""
                              />
                              <div className="min-w-0">
                                {pdfRenamingId === session.id ? (
                                  <Input
                                    autoFocus
                                    className="h-7 text-sm font-medium"
                                    value={pdfRenameValue}
                                    onChange={(e) =>
                                      setPdfRenameValue(e.target.value)
                                    }
                                    onBlur={() => {
                                      const trimmed = pdfRenameValue.trim();
                                      if (trimmed && trimmed !== session.name)
                                        handleRename(session.id, trimmed);
                                      setPdfRenamingId(null);
                                    }}
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter") {
                                        const trimmed = pdfRenameValue.trim();
                                        if (trimmed && trimmed !== session.name)
                                          handleRename(session.id, trimmed);
                                        setPdfRenamingId(null);
                                      }
                                      if (e.key === "Escape")
                                        setPdfRenamingId(null);
                                    }}
                                    onClick={(e) => e.stopPropagation()}
                                  />
                                ) : (
                                  <p className="text-sm font-medium truncate flex items-center gap-1.5">
                                    {session.name}
                                    {isStarred && (
                                      <Star className="h-2.5 w-2.5 fill-amber-400 text-amber-400 shrink-0" />
                                    )}
                                  </p>
                                )}
                              </div>
                            </div>

                            <span className="text-xs text-muted-foreground">
                              {formatRelativeDate(session.createdAt)}
                            </span>

                            {/* Actions: star + ellipsis menu */}
                            <div
                              className="flex justify-end items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {/* Star */}
                              <button
                                className={`shrink-0 transition-colors ${
                                  isStarred
                                    ? "text-amber-400"
                                    : "text-muted-foreground hover:text-amber-400"
                                }`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggleStar(session.id);
                                }}
                                title={isStarred ? "Unstar" : "Star"}
                              >
                                <Star
                                  className={`h-3.5 w-3.5 ${isStarred ? "fill-amber-400" : ""}`}
                                />
                              </button>
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-6 w-6"
                                    title="More actions"
                                  >
                                    <MoreVertical className="h-3.5 w-3.5" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent
                                  align="end"
                                  className="w-40"
                                >
                                  <DropdownMenuItem
                                    onSelect={() => {
                                      setPdfRenamingId(session.id);
                                      setPdfRenameValue(session.name);
                                    }}
                                  >
                                    <Pencil className="h-3.5 w-3.5 mr-2" />
                                    Rename
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onSelect={() => {
                                      setSelectedIds(new Set([session.id]));
                                      setDuplicateOpen(true);
                                    }}
                                  >
                                    <Copy className="h-3.5 w-3.5 mr-2" />
                                    Duplicate
                                  </DropdownMenuItem>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem
                                    className="text-destructive focus:text-destructive"
                                    onSelect={() =>
                                      setDeleteConfirmId(session.id)
                                    }
                                  >
                                    <Trash2 className="h-3.5 w-3.5 mr-2" />
                                    Delete
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </div>
                          </div>
                        );
                      })}
                      {filteredSessions.length === 0 && (
                        <div className="py-8 text-center text-sm text-muted-foreground">
                          No sessions match your search.
                        </div>
                      )}
                    </div>
                  </>
                ) : (
                  <>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 pt-2">
                      {filteredSessions.map((session) => (
                        <SessionCard
                          key={session.id}
                          session={session}
                          onOpen={() => navigate(`/pdf-sessions/${session.id}`)}
                          onRename={handleRename}
                        />
                      ))}
                      {filteredSessions.length === 0 && (
                        <div className="col-span-full text-center py-12 text-muted-foreground text-sm">
                          No sessions match your search.
                        </div>
                      )}
                    </div>
                  </>
                )}
              </section>
            ) : null}
          </div>
        </div>

        {/* ── Shadcn delete-confirm dialog for PDF list ─────────── */}
        <AlertDialog
          open={deleteConfirmId !== null}
          onOpenChange={(open) => {
            if (!open) setDeleteConfirmId(null);
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete session?</AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently delete the session and all its documents.
                This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={() => {
                  if (deleteConfirmId) handleDeleteSession(deleteConfirmId);
                  setDeleteConfirmId(null);
                }}
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <Dialog
          open={schemaModeDialogOpen}
          onOpenChange={(isOpen) => setSchemaModeDialogOpen(isOpen)}
        >
          <DialogContent className="sm:max-w-[440px]">
            <DialogHeader>
              <DialogTitle>Choose Schema Builder</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              For Other document types, choose how you want to create the schema.
            </p>
            <div className="grid grid-cols-1 gap-2 pt-1">
              <Button
                type="button"
                variant="outline"
                className="justify-start"
                onClick={() => {
                  setSchemaModeDialogOpen(false);
                  setManualSchemaBuilderOpen(true);
                }}
              >
                Manual Schema Builder
              </Button>
              <Button
                type="button"
                className="justify-start"
                onClick={() => {
                  setSchemaModeDialogOpen(false);
                  setAutoSchemaBuilderOpen(true);
                }}
              >
                Auto Schema Builder
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        <SchemaBuilderDialog
          open={manualSchemaBuilderOpen}
          onClose={() => setManualSchemaBuilderOpen(false)}
          initialPreset={{
            name: "Other Document Schema",
            extractionMode: "GENERIC",
            tabs: [],
          }}
          submitting={schemaBuilderSubmitting}
          onSubmit={(preset) => handleSchemaBuilderSubmit(preset, "manual")}
        />

        <AutoSchemaBuilderDialog
          open={autoSchemaBuilderOpen}
          onClose={() => setAutoSchemaBuilderOpen(false)}
          submitting={schemaBuilderSubmitting}
          onSubmit={(preset) => handleSchemaBuilderSubmit(preset, "auto")}
        />
      </>
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
        <div className="flex items-center gap-2 flex-1">
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
