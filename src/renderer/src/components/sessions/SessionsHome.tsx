import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { sessionsApi, queueApi } from "@/api/client";
import { SessionCard } from "./SessionCard";
import { NewSessionDialog } from "./NewSessionDialog";
import { Button } from "@/components/ui/button";
import { Plus, RefreshCw } from "lucide-react";
import type { SessionListItem } from "@shared/types";

export function SessionsHome() {
  const navigate = useNavigate();
  const [sessions, setSessions] = useState<SessionListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);

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

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <header className="flex items-center justify-between h-14 px-6 border-b bg-card shrink-0">
        <h1 className="text-lg font-semibold">Sessions</h1>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={fetchSessions}>
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Button onClick={() => setDialogOpen(true)} className="gap-2">
            <Plus className="h-4 w-4" />
            New Session
          </Button>
        </div>
      </header>

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
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {sessions.map((session) => (
              <SessionCard
                key={session.id}
                session={session}
                onOpen={() => navigate(`/sessions/${session.id}`)}
                onDeleted={fetchSessions}
              />
            ))}
          </div>
        )}
      </div>

      <NewSessionDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onCreated={handleSessionCreated}
      />
    </div>
  );
}
