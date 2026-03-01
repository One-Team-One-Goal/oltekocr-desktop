import { useState, useCallback, useEffect } from "react";
import { queueApi } from "@/api/client";

export function useQueue() {
  const [queueSize, setQueueSize] = useState(0);
  const [processing, setProcessing] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      const status = await queueApi.status();
      setQueueSize(status.size);
      setProcessing(status.processing);
      setPaused(status.paused);
    } catch {
      // Ignore — server might not be ready yet
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 5000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  return {
    queueSize,
    processing,
    paused,
    refresh: fetchStatus,
    setQueueSize,
    setProcessing,
  };
}
