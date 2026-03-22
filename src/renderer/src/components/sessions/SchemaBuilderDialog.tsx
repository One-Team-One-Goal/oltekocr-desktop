import { useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { contractSchemasApi } from "@/api/client";
import { toast } from "@/hooks/use-toast";
import { Plus, Search } from "lucide-react";

interface RawPage {
  page: number;
  text: string;
}

interface SchemaBuilderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessionName: string;
  documentType: string;
  rawPages: RawPage[];
}

type FieldStrategy = "AFTER_LABEL";

interface FieldRuleDraft {
  id: string;
  name: string;
  strategy: FieldStrategy;
  labelText: string;
  regex: string;
}

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function suggestRegexFromLabel(labelText: string): string {
  const clean = labelText.trim();
  if (!clean) return "";
  return `${escapeRegex(clean)}\\s*[:\\-]?\\s*(.+)`;
}

function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

function findMatch(
  pages: RawPage[],
  regexText: string,
): { pageIndex: number; start: number; end: number; value: string } | null {
  if (!regexText.trim()) return null;

  let expr: RegExp;
  try {
    expr = new RegExp(regexText, "im");
  } catch {
    return null;
  }

  for (let i = 0; i < pages.length; i += 1) {
    const text = pages[i]?.text || "";
    const result = expr.exec(text);
    if (!result) continue;

    const start = result.index ?? 0;
    const fullMatch = result[0] ?? "";
    const capture = result[1] ?? fullMatch;

    let captureStart = start;
    if (capture && fullMatch) {
      const rel = fullMatch.indexOf(capture);
      if (rel >= 0) captureStart = start + rel;
    }

    return {
      pageIndex: i,
      start: captureStart,
      end: captureStart + capture.length,
      value: capture,
    };
  }

  return null;
}

export function SchemaBuilderDialog({
  open,
  onOpenChange,
  sessionName,
  documentType,
  rawPages,
}: SchemaBuilderDialogProps) {
  const [schemaName, setSchemaName] = useState(`${sessionName} Schema`);
  const [fields, setFields] = useState<FieldRuleDraft[]>([
    {
      id: crypto.randomUUID(),
      name: "",
      strategy: "AFTER_LABEL",
      labelText: "",
      regex: "",
    },
  ]);
  const [fingerprintText, setFingerprintText] = useState("");
  const [activePageIndex, setActivePageIndex] = useState(0);
  const [activeFieldId, setActiveFieldId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const activeField = fields.find((f) => f.id === activeFieldId) ?? null;
  const highlighted = useMemo(() => {
    if (!activeField) return null;
    return findMatch(rawPages, activeField.regex);
  }, [activeField, rawPages]);

  const displayedPageIndex = highlighted?.pageIndex ?? activePageIndex;
  const displayedPage = rawPages[displayedPageIndex] ?? { page: 1, text: "" };

  const renderedText = useMemo(() => {
    const text = displayedPage.text || "";
    if (!highlighted || highlighted.pageIndex !== displayedPageIndex) {
      return { before: text, match: "", after: "" };
    }

    const start = Math.max(0, Math.min(text.length, highlighted.start));
    const end = Math.max(start, Math.min(text.length, highlighted.end));
    return {
      before: text.slice(0, start),
      match: text.slice(start, end),
      after: text.slice(end),
    };
  }, [displayedPage.text, displayedPageIndex, highlighted]);

  const addField = () => {
    const id = crypto.randomUUID();
    setFields((prev) => [
      ...prev,
      { id, name: "", strategy: "AFTER_LABEL", labelText: "", regex: "" },
    ]);
    setActiveFieldId(id);
  };

  const updateField = (id: string, patch: Partial<FieldRuleDraft>) => {
    setFields((prev) => prev.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  };

  const handleAutoSuggest = (id: string) => {
    const current = fields.find((f) => f.id === id);
    if (!current) return;
    updateField(id, { regex: suggestRegexFromLabel(current.labelText) });
  };

  const canSave =
    schemaName.trim().length > 0 &&
    fields.every(
      (f) =>
        f.name.trim().length > 0 &&
        f.labelText.trim().length > 0 &&
        f.regex.trim().length > 0,
    );

  const saveSchema = async () => {
    if (!canSave) return;

    const fieldDefinitions: Record<string, unknown> = {};
    for (const field of fields) {
      const key = slugify(field.name) || `field_${field.id.slice(0, 6)}`;
      fieldDefinitions[key] = {
        label: field.name.trim(),
        strategy: field.strategy,
        labelText: field.labelText.trim(),
        regex: field.regex,
      };
    }

    const definitions: Record<string, unknown> = {
      fieldDefinitions,
      fingerprints: fingerprintText.trim()
        ? [{ page: 1, contains: fingerprintText.trim() }]
        : [],
    };

    setSaving(true);
    try {
      await contractSchemasApi.create({
        name: schemaName.trim(),
        documentType,
        isActive: true,
        definitions,
      });

      toast({
        title: "Schema saved",
        description: "Your extraction schema is now active.",
      });
      onOpenChange(false);
    } catch (err: any) {
      toast({
        title: "Save failed",
        description: err?.message ?? "Could not save schema.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl w-[92vw] h-[84vh] p-0 overflow-hidden">
        <div className="h-full grid grid-cols-[1.25fr_1fr]">
          <div className="border-r min-h-0 flex flex-col">
            <DialogHeader className="px-4 py-3 border-b">
              <DialogTitle className="text-sm">Extracted Contents</DialogTitle>
            </DialogHeader>
            <div className="px-4 py-2 border-b flex items-center gap-2 flex-wrap">
              {rawPages.map((page, idx) => (
                <Button
                  key={page.page}
                  size="sm"
                  variant={idx === displayedPageIndex ? "default" : "outline"}
                  className="h-7 text-xs"
                  onClick={() => setActivePageIndex(idx)}
                >
                  Page {page.page}
                </Button>
              ))}
            </div>
            <ScrollArea className="flex-1 px-4 py-3">
              <pre className="whitespace-pre-wrap text-xs leading-5 font-mono text-foreground/90">
                {renderedText.before}
                {renderedText.match ? (
                  <mark className="bg-yellow-200 text-black px-0.5 rounded-sm">
                    {renderedText.match}
                  </mark>
                ) : null}
                {renderedText.after}
              </pre>
            </ScrollArea>
          </div>

          <div className="min-h-0 flex flex-col">
            <DialogHeader className="px-4 py-3 border-b">
              <DialogTitle className="text-sm">Schema Builder</DialogTitle>
            </DialogHeader>

            <ScrollArea className="flex-1 px-4 py-3 space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-medium">Schema Name</label>
                <Input
                  value={schemaName}
                  onChange={(e) => setSchemaName(e.target.value)}
                  className="h-8 text-xs"
                />
              </div>

              <div className="space-y-2 mt-4">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Fields
                  </p>
                  <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={addField}>
                    <Plus className="h-3.5 w-3.5" />
                    Add Field
                  </Button>
                </div>

                {fields.map((field) => {
                  const tested = findMatch(rawPages, field.regex);
                  return (
                    <div key={field.id} className="border rounded-md p-2.5 space-y-2">
                      <Input
                        className="h-7 text-xs"
                        placeholder="Field name (e.g. Origin Port)"
                        value={field.name}
                        onChange={(e) => updateField(field.id, { name: e.target.value })}
                      />

                      <div className="grid grid-cols-[1fr_auto] gap-2">
                        <Input
                          className="h-7 text-xs"
                          placeholder="Label text in document (e.g. Port of Loading)"
                          value={field.labelText}
                          onChange={(e) => updateField(field.id, { labelText: e.target.value })}
                        />
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs"
                          onClick={() => handleAutoSuggest(field.id)}
                        >
                          Suggest
                        </Button>
                      </div>

                      <Input
                        className="h-7 text-xs font-mono"
                        placeholder="Regex"
                        value={field.regex}
                        onChange={(e) => updateField(field.id, { regex: e.target.value })}
                      />

                      <div className="flex items-center justify-between">
                        <Button
                          size="sm"
                          variant="secondary"
                          className="h-7 text-xs gap-1"
                          onClick={() => {
                            setActiveFieldId(field.id);
                            if (tested) setActivePageIndex(tested.pageIndex);
                          }}
                        >
                          <Search className="h-3.5 w-3.5" />
                          Test
                        </Button>
                        <span className="text-[11px] text-muted-foreground">
                          {tested ? `Match on page ${rawPages[tested.pageIndex].page}` : "No match"}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="space-y-1.5 mt-4">
                <label className="text-xs font-medium">
                  Fingerprint: Page 1 must contain
                </label>
                <Input
                  className="h-8 text-xs"
                  placeholder="EVERGREEN LINE"
                  value={fingerprintText}
                  onChange={(e) => setFingerprintText(e.target.value)}
                />
              </div>
            </ScrollArea>

            <div className="border-t px-4 py-3 flex items-center justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button size="sm" onClick={saveSchema} disabled={!canSave || saving}>
                {saving ? "Saving..." : "Save Schema"}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
