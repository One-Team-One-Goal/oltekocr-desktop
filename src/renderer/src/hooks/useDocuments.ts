import { useState, useEffect, useCallback } from "react";
import { documentsApi } from "@/api/client";
import type { DocumentListItem, DashboardStats } from "@shared/types";

export function useDocuments() {
  const [documents, setDocuments] = useState<DocumentListItem[]>([]);
  const [stats, setStats] = useState<DashboardStats>({
    total: 0,
    queued: 0,
    processing: 0,
    review: 0,
    approved: 0,
    rejected: 0,
    exported: 0,
    error: 0,
    avgConfidence: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDocuments = useCallback(
    async (params?: Record<string, string>) => {
      try {
        setLoading(true);
        setError(null);
        const [docs, statsData] = await Promise.all([
          documentsApi.list(params),
          documentsApi.stats(),
        ]);
        setDocuments(docs);
        setStats(statsData);
      } catch (err: any) {
        setError(err.message || "Failed to fetch documents");
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const refresh = useCallback(() => fetchDocuments(), [fetchDocuments]);

  useEffect(() => {
    fetchDocuments();
  }, [fetchDocuments]);

  return {
    documents,
    stats,
    loading,
    error,
    refresh,
    fetchDocuments,
  };
}
