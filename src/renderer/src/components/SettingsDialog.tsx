import { useState, useEffect, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { settingsApi, modelsApi } from "@/api/client";
import type { LlmModelStatus, ModelStatus } from "@/api/client";
import {
  Save,
  RotateCcw,
  ScanLine,
  FileText,
  Database,
  FileOutput,
  Package,
  Download,
  Trash2,
  CheckCircle2,
  Loader2,
} from "lucide-react";
import type { AppSettings } from "@shared/types";

interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
}

type SettingsTab = "scanner" | "ocr" | "storage" | "export" | "models";

export function SettingsDialog({ open, onClose }: SettingsDialogProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>("scanner");
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [defaults, setDefaults] = useState<AppSettings | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  // Models tab state
  const [models, setModels] = useState<ModelStatus[]>([]);
  const [llmModels, setLlmModels] = useState<LlmModelStatus[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [installing, setInstalling] = useState<
    Record<string, "installing" | "uninstalling">
  >({});
  const [modelLogs, setModelLogs] = useState<Record<string, string>>({});

  const refreshModels = useCallback(() => {
    setModelsLoading(true);
    Promise.all([modelsApi.list(), modelsApi.listLlm()])
      .then(([extractionModels, llmModelList]) => {
        setModels(extractionModels);
        setLlmModels(llmModelList);
      })
      .catch(console.error)
      .finally(() => setModelsLoading(false));
  }, []);

  useEffect(() => {
    if (open) {
      setActiveTab("scanner");
      setLoading(true);
      Promise.all([settingsApi.get(), settingsApi.getDefaults()])
        .then(([s, d]) => {
          setSettings(s);
          setDefaults(d);
          setDirty(false);
        })
        .catch(console.error)
        .finally(() => setLoading(false));
      refreshModels();
    }
  }, [open, refreshModels]);

  const handleInstall = async (id: string) => {
    setInstalling((p) => ({ ...p, [id]: "installing" }));
    setModelLogs((p) => ({ ...p, [id]: "" }));
    try {
      const result = await modelsApi.install(id);
      setModelLogs((p) => ({ ...p, [id]: result.log }));
    } catch (err: any) {
      setModelLogs((p) => ({ ...p, [id]: err.message ?? String(err) }));
    } finally {
      setInstalling((p) => {
        const n = { ...p };
        delete n[id];
        return n;
      });
      refreshModels();
    }
  };

  const handleUninstall = async (id: string) => {
    setInstalling((p) => ({ ...p, [id]: "uninstalling" }));
    setModelLogs((p) => ({ ...p, [id]: "" }));
    try {
      const result = await modelsApi.uninstall(id);
      setModelLogs((p) => ({ ...p, [id]: result.log }));
    } catch (err: any) {
      setModelLogs((p) => ({ ...p, [id]: err.message ?? String(err) }));
    } finally {
      setInstalling((p) => {
        const n = { ...p };
        delete n[id];
        return n;
      });
      refreshModels();
    }
  };

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

  const pdfDownloadedOptions = Array.from(
    new Set([
      settings.ocr.pdfModel || "pdfplumber",
      ...models.filter((m) => m.downloaded).map((m) => m.id),
      "pdfplumber",
    ]),
  );

  const llmDownloadedOptions = Array.from(
    new Set([
      settings.llm.defaultModel || "qwen3:30b",
      ...llmModels.filter((m) => m.downloaded).map((m) => m.id),
      "qwen3:30b",
    ]),
  );

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl h-[760px] max-h-[90vh] flex flex-col p-0 gap-0 overflow-hidden">
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
            value={activeTab}
            onValueChange={(value) => setActiveTab(value as SettingsTab)}
            className="flex-1 flex flex-col overflow-hidden"
          >
            <div className="flex gap-0 border-b mt-3 px-4 shrink-0">
              {[
                {
                  value: "scanner",
                  label: "Scanner",
                  icon: <ScanLine className="h-3 w-3" />,
                },
                {
                  value: "ocr",
                  label: "OCR",
                  icon: <FileText className="h-3 w-3" />,
                },
                {
                  value: "storage",
                  label: "Storage",
                  icon: <Database className="h-3 w-3" />,
                },
                {
                  value: "export",
                  label: "Export",
                  icon: <FileOutput className="h-3 w-3" />,
                },
                {
                  value: "models",
                  label: "Models",
                  icon: <Package className="h-3 w-3" />,
                },
              ].map((tab) => (
                <button
                  key={tab.value}
                  type="button"
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border-b-2 -mb-px transition-colors whitespace-nowrap ${
                    activeTab === tab.value
                      ? "border-primary text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
                  onClick={() => setActiveTab(tab.value as SettingsTab)}
                >
                  {tab.icon}
                  {tab.label}
                </button>
              ))}
            </div>

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
            {/* Models Tab */}
            <TabsContent value="models" className="flex-1 mt-0 overflow-hidden">
              <ScrollArea className="h-full">
                <div className="p-4 space-y-3">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <SettingGroup label="OCR Engine (Downloaded)">
                      <div className="rounded-md border bg-background p-2 space-y-1.5">
                        <button
                          type="button"
                          className="w-full text-left px-2 py-1.5 rounded text-xs border border-primary text-foreground"
                          onClick={() => update("ocr", "engine", "rapidocr")}
                        >
                          RapidOCR
                        </button>
                        <p className="text-[11px] text-muted-foreground px-1">
                          Version history for OCR engines will appear here as
                          downloadable versions are added.
                        </p>
                      </div>
                    </SettingGroup>

                    <SettingGroup label="PDF Model Versions (Downloaded)">
                      <div className="rounded-md border bg-background p-2 space-y-1.5">
                        {pdfDownloadedOptions.map((modelId) => {
                          const active =
                            (settings.ocr.pdfModel || "pdfplumber") === modelId;
                          return (
                            <button
                              key={modelId}
                              type="button"
                              className={`w-full text-left px-2 py-1.5 rounded text-xs border transition-colors ${
                                active
                                  ? "border-primary text-foreground"
                                  : "border-transparent text-muted-foreground hover:text-foreground"
                              }`}
                              onClick={() => update("ocr", "pdfModel", modelId)}
                            >
                              {modelId}
                            </button>
                          );
                        })}
                      </div>
                    </SettingGroup>

                    <SettingGroup label="LLM Versions (Downloaded)">
                      <div className="rounded-md border bg-background p-2 space-y-1.5">
                        {llmDownloadedOptions.map((modelId) => {
                          const active =
                            (settings.llm.defaultModel || "qwen2.5:1.5b") ===
                            modelId;
                          return (
                            <button
                              key={modelId}
                              type="button"
                              className={`w-full text-left px-2 py-1.5 rounded text-xs border transition-colors ${
                                active
                                  ? "border-primary text-foreground"
                                  : "border-transparent text-muted-foreground hover:text-foreground"
                              }`}
                              onClick={() =>
                                update("llm", "defaultModel", modelId)
                              }
                            >
                              {modelId}
                            </button>
                          );
                        })}
                      </div>
                    </SettingGroup>
                  </div>

                  <div className="flex items-center justify-between">
                    <p className="text-xs text-muted-foreground">
                      Install or remove extraction model packages. Large models
                      may take several minutes to download.
                    </p>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-xs shrink-0"
                      onClick={refreshModels}
                      disabled={modelsLoading}
                    >
                      {modelsLoading ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <RotateCcw className="h-3 w-3" />
                      )}
                    </Button>
                  </div>

                  {modelsLoading && models.length === 0 ? (
                    <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">
                      <Loader2 className="h-4 w-4 animate-spin mr-2" /> Checking
                      installed packages...
                    </div>
                  ) : (
                    models.map((model) => {
                      const state = installing[model.id];
                      const log = modelLogs[model.id];
                      return (
                        <div
                          key={model.id}
                          className="border rounded-lg p-3 space-y-2"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-sm font-medium">
                                  {model.name}
                                </span>
                                {model.recommended && (
                                  <Badge
                                    variant="secondary"
                                    className="text-xs px-1.5 py-0"
                                  >
                                    Recommended
                                  </Badge>
                                )}
                                {model.downloaded ? (
                                  <Badge className="text-xs px-1.5 py-0 bg-green-500/15 text-green-600 border-green-200 hover:bg-green-500/15">
                                    <CheckCircle2 className="h-3 w-3 mr-1" />{" "}
                                    Installed
                                  </Badge>
                                ) : (
                                  <Badge
                                    variant="outline"
                                    className="text-xs px-1.5 py-0 text-muted-foreground"
                                  >
                                    Not installed
                                  </Badge>
                                )}
                                <span className="text-xs text-muted-foreground">
                                  {model.size}
                                </span>
                              </div>
                              <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                                {model.description}
                              </p>
                            </div>
                            <div className="shrink-0">
                              {state ? (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="text-xs"
                                  disabled
                                >
                                  <Loader2 className="h-3 w-3 animate-spin mr-1" />
                                  {state === "installing"
                                    ? "Installing..."
                                    : "Removing..."}
                                </Button>
                              ) : model.downloaded ? (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="text-xs text-destructive hover:text-destructive"
                                  onClick={() => handleUninstall(model.id)}
                                >
                                  <Trash2 className="h-3 w-3 mr-1" /> Remove
                                </Button>
                              ) : (
                                <Button
                                  size="sm"
                                  className="text-xs"
                                  onClick={() => handleInstall(model.id)}
                                >
                                  <Download className="h-3 w-3 mr-1" /> Install
                                </Button>
                              )}
                            </div>
                          </div>
                          {log && (
                            <pre className="text-xs bg-muted rounded p-2 max-h-32 overflow-auto whitespace-pre-wrap break-all font-mono">
                              {log}
                            </pre>
                          )}
                        </div>
                      );
                    })
                  )}
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
