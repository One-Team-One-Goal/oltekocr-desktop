import { useState, useEffect, useCallback } from "react";
import { settingsApi } from "@/api/client";
import type { AppSettings } from "@shared/types";

export function useSettings() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchSettings = useCallback(async () => {
    try {
      setLoading(true);
      const data = await settingsApi.get();
      setSettings(data);
    } catch (err) {
      console.error("Failed to fetch settings:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  const updateSettings = useCallback(async (partial: Partial<AppSettings>) => {
    try {
      const updated = await settingsApi.update(partial);
      setSettings(updated);
      return updated;
    } catch (err) {
      console.error("Failed to update settings:", err);
      throw err;
    }
  }, []);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  return { settings, loading, updateSettings, refresh: fetchSettings };
}
