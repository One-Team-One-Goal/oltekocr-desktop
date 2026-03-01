import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { settingsApi } from "@/api/client";
import {
  Save,
  RotateCcw,
  ScanLine,
  FileText,
  Database,
  FileOutput,
} from "lucide-react";
import type { AppSettings } from "@shared/types";

interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
}

export function SettingsDialog({ open, onClose }: SettingsDialogProps) {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [defaults, setDefaults] = useState<AppSettings | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (open) {
      setLoading(true);
      Promise.all([settingsApi.get(), settingsApi.getDefaults()])
        .then(([s, d]) => {
          setSettings(s);
          setDefaults(d);
          setDirty(false);
        })
        .catch(console.error)
        .finally(() => setLoading(false));
    }
  }, [open]);

  const update = <K extends keyof AppSettings>(
    section: K,
    key: string,
    value: any,
  ) => {
    if (!settings) return;
    setSettings({
      ...settings,
      [section]: {
        ...(settings[section] as any),
        [key]: value,
      },
    });
    setDirty(true);
  };

  const handleSave = async () => {
    if (!settings) return;
    setSaving(true);
    try {
      await settingsApi.update(settings);
      setDirty(false);
    } catch (err) {
      console.error("Failed to save settings:", err);
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    if (defaults) {
      setSettings({ ...defaults });
      setDirty(true);
    }
  };

  if (!settings) return null;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col p-0 gap-0">
        <DialogHeader className="p-4 pb-2">
          <DialogTitle>Settings</DialogTitle>
        </DialogHeader>

        <Separator />

        {loading ? (
          <div className="flex-1 flex items-center justify-center p-8 text-muted-foreground">
            Loading settings...
          </div>
        ) : (
          <Tabs
            defaultValue="scanner"
            className="flex-1 flex flex-col overflow-hidden"
          >
            <TabsList className="mx-4 mt-2 justify-start">
              <TabsTrigger value="scanner" className="text-xs gap-1">
                <ScanLine className="h-3 w-3" /> Scanner
              </TabsTrigger>
              <TabsTrigger value="ocr" className="text-xs gap-1">
                <FileText className="h-3 w-3" /> OCR
              </TabsTrigger>
              <TabsTrigger value="storage" className="text-xs gap-1">
                <Database className="h-3 w-3" /> Storage
              </TabsTrigger>
              <TabsTrigger value="export" className="text-xs gap-1">
                <FileOutput className="h-3 w-3" /> Export
              </TabsTrigger>
            </TabsList>

            {/* Scanner Settings */}
            <TabsContent
              value="scanner"
              className="flex-1 mt-0 overflow-hidden"
            >
              <ScrollArea className="h-full">
                <div className="p-4 space-y-4">
                  <SettingGroup label="Scanner Mode">
                    <Select
                      value={settings.scanner.mode}
                      onValueChange={(v) => update("scanner", "mode", v)}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="wia">
                          WIA (Windows Image Acquisition)
                        </SelectItem>
                        <SelectItem value="folder">Folder Watch</SelectItem>
                      </SelectContent>
                    </Select>
                  </SettingGroup>

                  <SettingGroup label="DPI">
                    <Select
                      value={String(settings.scanner.dpi)}
                      onValueChange={(v) => update("scanner", "dpi", Number(v))}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="150">150 DPI</SelectItem>
                        <SelectItem value="200">200 DPI</SelectItem>
                        <SelectItem value="300">
                          300 DPI (Recommended)
                        </SelectItem>
                        <SelectItem value="600">600 DPI</SelectItem>
                      </SelectContent>
                    </Select>
                  </SettingGroup>

                  <SettingGroup label="Color Mode">
                    <Select
                      value={settings.scanner.colorMode}
                      onValueChange={(v) => update("scanner", "colorMode", v)}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="color">Color</SelectItem>
                        <SelectItem value="grayscale">Grayscale</SelectItem>
                        <SelectItem value="bw">Black & White</SelectItem>
                      </SelectContent>
                    </Select>
                  </SettingGroup>

                  <SettingGroup label="Auto Crop">
                    <ToggleInput
                      checked={settings.scanner.autoCrop}
                      onChange={(v) => update("scanner", "autoCrop", v)}
                    />
                  </SettingGroup>

                  <SettingGroup label="Watch Folder">
                    <Input
                      value={settings.scanner.watchFolder}
                      onChange={(e) =>
                        update("scanner", "watchFolder", e.target.value)
                      }
                      placeholder="Path to watch for incoming files..."
                    />
                  </SettingGroup>
                </div>
              </ScrollArea>
            </TabsContent>

            {/* OCR Settings */}
            <TabsContent value="ocr" className="flex-1 mt-0 overflow-hidden">
              <ScrollArea className="h-full">
                <div className="p-4 space-y-4">
                  <SettingGroup label="Language">
                    <Select
                      value={settings.ocr.language}
                      onValueChange={(v) => update("ocr", "language", v)}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="en">English</SelectItem>
                        <SelectItem value="ja">Japanese</SelectItem>
                        <SelectItem value="zh">Chinese</SelectItem>
                        <SelectItem value="ko">Korean</SelectItem>
                        <SelectItem value="auto">Auto-detect</SelectItem>
                      </SelectContent>
                    </Select>
                  </SettingGroup>

                  <SettingGroup label="Confidence Threshold">
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        min={0}
                        max={1}
                        step={0.05}
                        value={settings.ocr.confidenceThreshold}
                        onChange={(e) =>
                          update(
                            "ocr",
                            "confidenceThreshold",
                            Number(e.target.value),
                          )
                        }
                        className="w-24"
                      />
                      <span className="text-xs text-muted-foreground">
                        ({Math.round(settings.ocr.confidenceThreshold * 100)}%)
                      </span>
                    </div>
                  </SettingGroup>

                  <SettingGroup label="Table Detection">
                    <ToggleInput
                      checked={settings.ocr.extractTables}
                      onChange={(v) => update("ocr", "extractTables", v)}
                    />
                  </SettingGroup>

                  <SettingGroup label="Timeout (seconds)">
                    <Input
                      type="number"
                      min={5}
                      max={300}
                      value={settings.ocr.timeout}
                      onChange={(e) =>
                        update("ocr", "timeout", Number(e.target.value))
                      }
                      className="w-24"
                    />
                  </SettingGroup>

                  <SettingGroup label="Enhance Images">
                    <ToggleInput
                      checked={settings.ocr.autoEnhance}
                      onChange={(v) => update("ocr", "autoEnhance", v)}
                    />
                  </SettingGroup>

                  <SettingGroup label="Deskew">
                    <ToggleInput
                      checked={settings.ocr.autoDeskew}
                      onChange={(v) => update("ocr", "autoDeskew", v)}
                    />
                  </SettingGroup>

                  <SettingGroup label="Python Path (for OCR)">
                    <Input
                      value={settings.ocr.pythonPath}
                      onChange={(e) =>
                        update("ocr", "pythonPath", e.target.value)
                      }
                      placeholder="python or full path to python.exe"
                    />
                  </SettingGroup>
                </div>
              </ScrollArea>
            </TabsContent>

            {/* Storage Settings */}
            <TabsContent
              value="storage"
              className="flex-1 mt-0 overflow-hidden"
            >
              <ScrollArea className="h-full">
                <div className="p-4 space-y-4">
                  <SettingGroup label="Database Path">
                    <Input
                      value={settings.storage.databasePath}
                      onChange={(e) =>
                        update("storage", "databasePath", e.target.value)
                      }
                    />
                  </SettingGroup>

                  <SettingGroup label="Scans Folder">
                    <Input
                      value={settings.storage.scansFolder}
                      onChange={(e) =>
                        update("storage", "scansFolder", e.target.value)
                      }
                    />
                  </SettingGroup>

                  <SettingGroup label="Exports Folder">
                    <Input
                      value={settings.storage.exportsFolder}
                      onChange={(e) =>
                        update("storage", "exportsFolder", e.target.value)
                      }
                    />
                  </SettingGroup>

                  <SettingGroup label="Max Storage (GB)">
                    <Input
                      type="number"
                      min={1}
                      value={settings.storage.maxStorageGb}
                      onChange={(e) =>
                        update(
                          "storage",
                          "maxStorageGb",
                          Number(e.target.value),
                        )
                      }
                      className="w-32"
                    />
                  </SettingGroup>
                </div>
              </ScrollArea>
            </TabsContent>

            {/* Export Settings */}
            <TabsContent value="export" className="flex-1 mt-0 overflow-hidden">
              <ScrollArea className="h-full">
                <div className="p-4 space-y-4">
                  <SettingGroup label="Default Format">
                    <Select
                      value={settings.export.defaultFormat}
                      onValueChange={(v) =>
                        update("export", "defaultFormat", v)
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="excel">Excel (.xlsx)</SelectItem>
                        <SelectItem value="csv">CSV</SelectItem>
                        <SelectItem value="json">JSON</SelectItem>
                      </SelectContent>
                    </Select>
                  </SettingGroup>

                  <SettingGroup label="Include Images">
                    <ToggleInput
                      checked={settings.export.includeImages}
                      onChange={(v) => update("export", "includeImages", v)}
                    />
                  </SettingGroup>

                  <SettingGroup label="Date Format">
                    <Select
                      value={settings.export.dateFormat}
                      onValueChange={(v) => update("export", "dateFormat", v)}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="YYYY-MM-DD">YYYY-MM-DD</SelectItem>
                        <SelectItem value="MM/DD/YYYY">MM/DD/YYYY</SelectItem>
                        <SelectItem value="DD/MM/YYYY">DD/MM/YYYY</SelectItem>
                      </SelectContent>
                    </Select>
                  </SettingGroup>
                </div>
              </ScrollArea>
            </TabsContent>
          </Tabs>
        )}

        <Separator />

        <div className="flex items-center justify-between p-4">
          <Button variant="ghost" className="text-xs" onClick={handleReset}>
            <RotateCcw className="h-3 w-3 mr-1" />
            Reset to Defaults
          </Button>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={!dirty || saving}>
              <Save className="h-4 w-4 mr-1" />
              {saving ? "Saving..." : "Save"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// -- Helpers --

function SettingGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium">{label}</label>
      {children}
    </div>
  );
}

function ToggleInput({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`
        relative inline-flex h-6 w-11 items-center rounded-full transition-colors
        ${checked ? "bg-primary" : "bg-muted"}
      `}
    >
      <span
        className={`
          inline-block h-4 w-4 transform rounded-full bg-white transition-transform
          ${checked ? "translate-x-6" : "translate-x-1"}
        `}
      />
    </button>
  );
}
