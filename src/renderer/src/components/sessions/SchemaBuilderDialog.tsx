import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { ChevronDown, ChevronRight, Check, Code2, Info, Layers, Pencil, Plus, Trash2, X, Zap } from "lucide-react";

export interface SchemaPresetField {
  label: string;
  fieldKey: string;
  regexRule: string;

  extractionStrategy?:
    | "regex"
    | "table_column"
    | "header_field"
    | "page_region";
  dataType?: "string" | "currency" | "number" | "date" | "percentage";
  pageRange?: string;
  postProcessing?: string[];
  altRegexRules?: string[];
  sectionHint?: string;
  sectionIndicatorKey?: string;
  contextHint?:
    | "same_line_after_label"
    | "next_line_after_label"
    | "table_cell";
  contextLabel?: string;
  mandatory?: boolean;
  expectedFormat?: string;
  minLength?: number;
  maxLength?: number;
  allowedValues?: string[];
}

export interface SchemaPresetTab {
  name: string;
  fields: SchemaPresetField[];
}

export interface SchemaPresetDraft {
  id?: string;
  name: string;
  description?: string;
  extractionMode?: "AUTO" | "CONTRACT_BIASED" | "GENERIC";
  recordStartRegex?: string;
  tabs: SchemaPresetTab[];
  conditions?: Array<Record<string, unknown>>;
}

interface SchemaBuilderDialogProps {
  open: boolean;
  onClose: () => void;
  initialPreset?: SchemaPresetDraft | null;
  submitting?: boolean;
  onSubmit: (preset: SchemaPresetDraft) => Promise<void> | void;
}

type NumberTransformOp = "" | "add" | "sub" | "mul" | "div";
type NumberCalcMode = "" | "value" | "field" | "formula";
type SchemaExtractionMode = "AUTO" | "CONTRACT_BIASED" | "GENERIC";
type ConditionOperator = "equals" | "not_equals" | "contains" | "greater_than" | "less_than" | "matches_regex";
type ConditionAction = "multiply_by" | "set_to" | "append" | "clear";
type Section = "info" | "fields" | "conditions" | "json";
interface ConditionRule {
  id: string;
  ifField: string;
  ifOperator: ConditionOperator;
  ifValue: string;
  thenField: string;
  thenAction: ConditionAction;
  thenValue: string;
}
type FieldDraftState = Partial<SchemaPresetField> & {
  sampleValue?: string;
  dateOffsetDays?: string;
  numberCalcMode?: NumberCalcMode;
  numberTransformOp?: NumberTransformOp;
  numberTransformValue?: string;
  numberTransformField?: string;
  numberFormula?: string;
};

const DATA_TYPE_LABELS: Record<string, string> = {
  string: "Text",
  currency: "Currency",
  number: "Number",
  date: "Date",
  percentage: "%",
};
const DATA_TYPE_COLORS: Record<string, string> = {
  string: "secondary",
  currency: "default",
  number: "outline",
  date: "secondary",
  percentage: "outline",
};
const OPERATOR_LABELS: Record<ConditionOperator, string> = {
  equals: "equals",
  not_equals: "does not equal",
  contains: "contains",
  greater_than: "is greater than",
  less_than: "is less than",
  matches_regex: "matches regex",
};
const ACTION_LABELS: Record<ConditionAction, string> = {
  multiply_by: "multiply",
  set_to: "set",
  append: "append to",
  clear: "clear",
};

const CONTRACT_TEMPLATE_TABS: SchemaPresetTab[] = [
  {
    name: "Rates",
    fields: [
      { label: "Carrier", fieldKey: "Carrier", regexRule: "", extractionStrategy: "table_column", sectionHint: "RATES", contextHint: "table_cell", dataType: "string" },
      { label: "Contract ID", fieldKey: "Contract ID", regexRule: "", extractionStrategy: "table_column", sectionHint: "RATES", contextHint: "table_cell", dataType: "string" },
      { label: "effective_date", fieldKey: "effective_date", regexRule: "", extractionStrategy: "table_column", sectionHint: "RATES", contextHint: "table_cell", dataType: "date" },
      { label: "expiration_date", fieldKey: "expiration_date", regexRule: "", extractionStrategy: "table_column", sectionHint: "RATES", contextHint: "table_cell", dataType: "date" },
      { label: "commodity", fieldKey: "commodity", regexRule: "", extractionStrategy: "table_column", sectionHint: "RATES", contextHint: "table_cell", dataType: "string" },
      { label: "origin_city", fieldKey: "origin_city", regexRule: "", extractionStrategy: "table_column", sectionHint: "RATES", contextHint: "table_cell", dataType: "string" },
      { label: "origin_via_city", fieldKey: "origin_via_city", regexRule: "", extractionStrategy: "table_column", sectionHint: "RATES", contextHint: "table_cell", dataType: "string" },
      { label: "destination_city", fieldKey: "destination_city", regexRule: "", extractionStrategy: "table_column", sectionHint: "RATES", contextHint: "table_cell", dataType: "string" },
      { label: "destination_via_city", fieldKey: "destination_via_city", regexRule: "", extractionStrategy: "table_column", sectionHint: "RATES", contextHint: "table_cell", dataType: "string" },
      { label: "service", fieldKey: "service", regexRule: "", extractionStrategy: "table_column", sectionHint: "RATES", contextHint: "table_cell", dataType: "string" },
      { label: "Remarks", fieldKey: "Remarks", regexRule: "", extractionStrategy: "table_column", sectionHint: "RATES", contextHint: "table_cell", dataType: "string" },
      { label: "SCOPE", fieldKey: "SCOPE", regexRule: "", extractionStrategy: "table_column", sectionHint: "RATES", contextHint: "table_cell", dataType: "string" },
      { label: "BaseRate 20", fieldKey: "BaseRate 20", regexRule: "", extractionStrategy: "table_column", sectionHint: "RATES", contextHint: "table_cell", dataType: "currency", postProcessing: ["trim", "remove_commas", "remove_currency"] },
      { label: "BaseRate 40", fieldKey: "BaseRate 40", regexRule: "", extractionStrategy: "table_column", sectionHint: "RATES", contextHint: "table_cell", dataType: "currency", postProcessing: ["trim", "remove_commas", "remove_currency"] },
      { label: "BaseRate 40H", fieldKey: "BaseRate 40H", regexRule: "", extractionStrategy: "table_column", sectionHint: "RATES", contextHint: "table_cell", dataType: "currency", postProcessing: ["trim", "remove_commas", "remove_currency"] },
      { label: "BaseRate 45", fieldKey: "BaseRate 45", regexRule: "", extractionStrategy: "table_column", sectionHint: "RATES", contextHint: "table_cell", dataType: "currency", postProcessing: ["trim", "remove_commas", "remove_currency"] },
      { label: "AMS(CHINA & JAPAN)", fieldKey: "AMS(CHINA & JAPAN)", regexRule: "", extractionStrategy: "table_column", sectionHint: "RATES", contextHint: "table_cell", dataType: "currency", postProcessing: ["trim", "remove_commas", "remove_currency"] },
      { label: "(HEA) Heavy Surcharge", fieldKey: "(HEA) Heavy Surcharge", regexRule: "", extractionStrategy: "table_column", sectionHint: "RATES", contextHint: "table_cell", dataType: "currency", postProcessing: ["trim", "remove_commas", "remove_currency"] },
      { label: "AGW", fieldKey: "AGW", regexRule: "", extractionStrategy: "table_column", sectionHint: "RATES", contextHint: "table_cell", dataType: "currency", postProcessing: ["trim", "remove_commas", "remove_currency"] },
      { label: "RED SEA DIVERSION CHARGE(RDS).", fieldKey: "RED SEA DIVERSION CHARGE(RDS).", regexRule: "", extractionStrategy: "table_column", sectionHint: "RATES", contextHint: "table_cell", dataType: "currency", postProcessing: ["trim", "remove_commas", "remove_currency"] },
    ],
  },
  {
    name: "Origin Arbitraries",
    fields: [
      { label: "Carrier", fieldKey: "Carrier", regexRule: "", extractionStrategy: "table_column", sectionHint: "ORIGIN_ARB", contextHint: "table_cell", dataType: "string" },
      { label: "Contract ID", fieldKey: "Contract ID", regexRule: "", extractionStrategy: "table_column", sectionHint: "ORIGIN_ARB", contextHint: "table_cell", dataType: "string" },
      { label: "effective_date", fieldKey: "effective_date", regexRule: "", extractionStrategy: "table_column", sectionHint: "ORIGIN_ARB", contextHint: "table_cell", dataType: "date" },
      { label: "expiration_date", fieldKey: "expiration_date", regexRule: "", extractionStrategy: "table_column", sectionHint: "ORIGIN_ARB", contextHint: "table_cell", dataType: "date" },
      { label: "commodity", fieldKey: "commodity", regexRule: "", extractionStrategy: "table_column", sectionHint: "ORIGIN_ARB", contextHint: "table_cell", dataType: "string" },
      { label: "origin_city", fieldKey: "origin_city", regexRule: "", extractionStrategy: "table_column", sectionHint: "ORIGIN_ARB", contextHint: "table_cell", dataType: "string" },
      { label: "origin_via_city", fieldKey: "origin_via_city", regexRule: "", extractionStrategy: "table_column", sectionHint: "ORIGIN_ARB", contextHint: "table_cell", dataType: "string" },
      { label: "service", fieldKey: "service", regexRule: "", extractionStrategy: "table_column", sectionHint: "ORIGIN_ARB", contextHint: "table_cell", dataType: "string" },
      { label: "Remarks", fieldKey: "Remarks", regexRule: "", extractionStrategy: "table_column", sectionHint: "ORIGIN_ARB", contextHint: "table_cell", dataType: "string" },
      { label: "Scope", fieldKey: "Scope", regexRule: "", extractionStrategy: "table_column", sectionHint: "ORIGIN_ARB", contextHint: "table_cell", dataType: "string" },
      { label: "BaseRate 20", fieldKey: "BaseRate 20", regexRule: "", extractionStrategy: "table_column", sectionHint: "ORIGIN_ARB", contextHint: "table_cell", dataType: "currency", postProcessing: ["trim", "remove_commas", "remove_currency"] },
      { label: "BaseRate 40", fieldKey: "BaseRate 40", regexRule: "", extractionStrategy: "table_column", sectionHint: "ORIGIN_ARB", contextHint: "table_cell", dataType: "currency", postProcessing: ["trim", "remove_commas", "remove_currency"] },
      { label: "BaseRate 40H", fieldKey: "BaseRate 40H", regexRule: "", extractionStrategy: "table_column", sectionHint: "ORIGIN_ARB", contextHint: "table_cell", dataType: "currency", postProcessing: ["trim", "remove_commas", "remove_currency"] },
      { label: "BaseRate 45", fieldKey: "BaseRate 45", regexRule: "", extractionStrategy: "table_column", sectionHint: "ORIGIN_ARB", contextHint: "table_cell", dataType: "currency", postProcessing: ["trim", "remove_commas", "remove_currency"] },
      { label: "20' AGW", fieldKey: "20' AGW", regexRule: "", extractionStrategy: "table_column", sectionHint: "ORIGIN_ARB", contextHint: "table_cell", dataType: "currency", postProcessing: ["trim", "remove_commas", "remove_currency"] },
      { label: "40' AGW", fieldKey: "40' AGW", regexRule: "", extractionStrategy: "table_column", sectionHint: "ORIGIN_ARB", contextHint: "table_cell", dataType: "currency", postProcessing: ["trim", "remove_commas", "remove_currency"] },
      { label: "45' AGW", fieldKey: "45' AGW", regexRule: "", extractionStrategy: "table_column", sectionHint: "ORIGIN_ARB", contextHint: "table_cell", dataType: "currency", postProcessing: ["trim", "remove_commas", "remove_currency"] },
    ],
  },
  {
    name: "Destination Arbitraries",
    fields: [
      { label: "Carrier", fieldKey: "Carrier", regexRule: "", extractionStrategy: "table_column", sectionHint: "DEST_ARB", contextHint: "table_cell", dataType: "string" },
      { label: "Contract ID", fieldKey: "Contract ID", regexRule: "", extractionStrategy: "table_column", sectionHint: "DEST_ARB", contextHint: "table_cell", dataType: "string" },
      { label: "effective_date", fieldKey: "effective_date", regexRule: "", extractionStrategy: "table_column", sectionHint: "DEST_ARB", contextHint: "table_cell", dataType: "date" },
      { label: "expiration_date", fieldKey: "expiration_date", regexRule: "", extractionStrategy: "table_column", sectionHint: "DEST_ARB", contextHint: "table_cell", dataType: "date" },
      { label: "commodity", fieldKey: "commodity", regexRule: "", extractionStrategy: "table_column", sectionHint: "DEST_ARB", contextHint: "table_cell", dataType: "string" },
      { label: "destination_city", fieldKey: "destination_city", regexRule: "", extractionStrategy: "table_column", sectionHint: "DEST_ARB", contextHint: "table_cell", dataType: "string" },
      { label: "destination_via_city", fieldKey: "destination_via_city", regexRule: "", extractionStrategy: "table_column", sectionHint: "DEST_ARB", contextHint: "table_cell", dataType: "string" },
      { label: "service", fieldKey: "service", regexRule: "", extractionStrategy: "table_column", sectionHint: "DEST_ARB", contextHint: "table_cell", dataType: "string" },
      { label: "Remarks", fieldKey: "Remarks", regexRule: "", extractionStrategy: "table_column", sectionHint: "DEST_ARB", contextHint: "table_cell", dataType: "string" },
      { label: "Scope", fieldKey: "Scope", regexRule: "", extractionStrategy: "table_column", sectionHint: "DEST_ARB", contextHint: "table_cell", dataType: "string" },
      { label: "BaseRate 20", fieldKey: "BaseRate 20", regexRule: "", extractionStrategy: "table_column", sectionHint: "DEST_ARB", contextHint: "table_cell", dataType: "currency", postProcessing: ["trim", "remove_commas", "remove_currency"] },
      { label: "BaseRate 40", fieldKey: "BaseRate 40", regexRule: "", extractionStrategy: "table_column", sectionHint: "DEST_ARB", contextHint: "table_cell", dataType: "currency", postProcessing: ["trim", "remove_commas", "remove_currency"] },
      { label: "BaseRate 40H", fieldKey: "BaseRate 40H", regexRule: "", extractionStrategy: "table_column", sectionHint: "DEST_ARB", contextHint: "table_cell", dataType: "currency", postProcessing: ["trim", "remove_commas", "remove_currency"] },
      { label: "BaseRate 45", fieldKey: "BaseRate 45", regexRule: "", extractionStrategy: "table_column", sectionHint: "DEST_ARB", contextHint: "table_cell", dataType: "currency", postProcessing: ["trim", "remove_commas", "remove_currency"] },
    ],
  },
];

const CONTRACT_SECTION_HINT_HELP: Record<"RATES" | "ORIGIN_ARB" | "DEST_ARB" | "HEADER", string> = {
  RATES: "6-1. General Rate",
  ORIGIN_ARB: "6-3. Origin Arbitrary",
  DEST_ARB: "6-4. Destination Arbitrary",
  HEADER: "Contract header section",
};

const CONTRACT_SECTION_HINT_SUGGESTIONS = ["RATES", "ORIGIN_ARB", "DEST_ARB", "HEADER"];
const GENERIC_SECTION_HINT_SUGGESTIONS = ["HEADER", "RECORD", "LINE_ITEMS", "SUMMARY"];
const CUSTOM_SECTION_VALUE = "__CUSTOM__";

const SELECT_CLASS =
  "w-full rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

function buildRegexFromSample(value: string): string {
  const raw = value.trim();
  if (!raw) return "";

  if (/^\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}$/.test(raw)) {
    return "([0-9]{1,2}[\\/\\-.][0-9]{1,2}[\\/\\-.][0-9]{2,4})";
  }

  if (/^[\$€¥£]?\s?[\d,.]+$/.test(raw)) {
    return "([\\$€¥£]?\\s?[0-9,]+(?:\\.[0-9]+)?)";
  }

  if (/^[A-Za-z][A-Za-z\s.'\-(),&]+$/.test(raw)) {
    return "([A-Za-z][A-Za-z\\s.'\\-(),&]{1,120})";
  }

  return "([^\\n]+)";
}

function buildRegexFromHints(
  fieldKey: string,
  dataType: SchemaPresetField["dataType"] | undefined,
  contextLabel: string,
  sampleValue: string,
): string {
  const key = fieldKey.trim().toLowerCase();
  const label = contextLabel.trim();

  const valuePattern = (() => {
    if (dataType === "date" || key.includes("date")) {
      return "([0-9]{1,2}[\\/\\-.][0-9]{1,2}[\\/\\-.][0-9]{2,4})";
    }
    if (
      dataType === "currency" ||
      dataType === "number" ||
      key.includes("rate") ||
      key.includes("amount") ||
      key.includes("charge") ||
      key.includes("surcharge")
    ) {
      return "([\\$€¥£]?\\s?[0-9,]+(?:\\.[0-9]+)?)";
    }
    if (
      key.includes("city") ||
      key.includes("origin") ||
      key.includes("destination")
    ) {
      return "([A-Za-z][A-Za-z\\s.'\\-(),&]{1,120})";
    }
    return buildRegexFromSample(sampleValue || "");
  })();

  if (!label) {
    return valuePattern || "([^\\n]+)";
  }

  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return `(?i)${escapedLabel}\\s*[:\\-]?\\s*${valuePattern || "([^\\n]+)"}`;
}

const GENERATED_RULE_RE = /^(trim|remove_commas|remove_currency|fix_date|add_days:-?\d+|sub_days:-?\d+|add:-?\d+(?:\.\d+)?|sub:-?\d+(?:\.\d+)?|mul:-?\d+(?:\.\d+)?|div:-?\d+(?:\.\d+)?|add_field:.+|sub_field:.+|mul_field:.+|div_field:.+|formula:.+)$/i;

function createEmptyFieldDraft(): FieldDraftState {
  return {
    label: "",
    fieldKey: "",
    sampleValue: "",
    regexRule: "",
    extractionStrategy: "table_column",
    dataType: "string",
    pageRange: "",
    postProcessing: [],
    altRegexRules: [],
    sectionHint: undefined,
    sectionIndicatorKey: "",
    contextHint: "table_cell",
    contextLabel: "",
    mandatory: false,
    expectedFormat: "",
    minLength: undefined,
    maxLength: undefined,
    allowedValues: [],
    dateOffsetDays: "",
    numberCalcMode: "",
    numberTransformOp: "",
    numberTransformValue: "",
    numberTransformField: "",
    numberFormula: "",
  };
}

function parseTransformDraft(
  field: SchemaPresetField,
): Pick<FieldDraftState, "dateOffsetDays" | "numberCalcMode" | "numberTransformOp" | "numberTransformValue" | "numberTransformField" | "numberFormula"> {
  const out: Pick<FieldDraftState, "dateOffsetDays" | "numberCalcMode" | "numberTransformOp" | "numberTransformValue" | "numberTransformField" | "numberFormula"> = {
    dateOffsetDays: "",
    numberCalcMode: "",
    numberTransformOp: "",
    numberTransformValue: "",
    numberTransformField: "",
    numberFormula: "",
  };

  for (const rawRule of field.postProcessing || []) {
    const rule = rawRule.trim().toLowerCase();
    const dateMatch = rule.match(/^(add_days|sub_days):(-?\d+)$/);
    if (dateMatch) {
      const sign = dateMatch[1] === "sub_days" ? -1 : 1;
      out.dateOffsetDays = String(sign * Number(dateMatch[2]));
      continue;
    }

    const numMatch = rule.match(/^(add|sub|mul|div):(-?\d+(?:\.\d+)?)$/);
    if (numMatch) {
      out.numberCalcMode = "value";
      out.numberTransformOp = numMatch[1] as NumberTransformOp;
      out.numberTransformValue = numMatch[2];
      continue;
    }

    const numFieldMatch = rule.match(/^(add|sub|mul|div)_field:(.+)$/);
    if (numFieldMatch) {
      out.numberCalcMode = "field";
      out.numberTransformOp = numFieldMatch[1] as NumberTransformOp;
      out.numberTransformField = numFieldMatch[2].trim();
      continue;
    }

    const formulaMatch = rule.match(/^formula:(.+)$/);
    if (formulaMatch) {
      out.numberCalcMode = "formula";
      out.numberFormula = formulaMatch[1].trim();
      continue;
    }
  }

  return out;
}

function buildPostProcessingRules(draft: FieldDraftState): string[] | undefined {
  const preserved = (draft.postProcessing || [])
    .map((r) => r.trim())
    .filter((r) => r && !GENERATED_RULE_RE.test(r));

  const rules = [...preserved, "trim"];
  if (draft.dataType === "currency") {
    rules.push("remove_commas", "remove_currency");
  }
  if (draft.dataType === "date") {
    rules.push("fix_date");
  }

  const offsetDays = Number((draft.dateOffsetDays || "").trim());
  if (draft.dataType === "date" && Number.isFinite(offsetDays) && offsetDays !== 0) {
    if (offsetDays > 0) {
      rules.push(`add_days:${Math.trunc(offsetDays)}`);
    } else {
      rules.push(`sub_days:${Math.abs(Math.trunc(offsetDays))}`);
    }
  }

  if (draft.dataType === "number") {
    const numberMode = draft.numberCalcMode || "";
    const numberOp = draft.numberTransformOp || "";
    const numberValue = (draft.numberTransformValue || "").trim();
    const numberField = (draft.numberTransformField || "").trim();
    const numberFormula = (draft.numberFormula || "").trim();

    if (numberMode === "value" && numberOp && numberValue) {
      rules.push(`${numberOp}:${numberValue}`);
    } else if (numberMode === "field" && numberOp && numberField) {
      rules.push(`${numberOp}_field:${numberField}`);
    } else if (numberMode === "formula" && numberFormula) {
      rules.push(`formula:${numberFormula}`);
    }
  }

  const deduped = Array.from(new Set(rules));
  return deduped.length > 0 ? deduped : undefined;
}

export function SchemaBuilderDialog({
  open,
  onClose,
  initialPreset,
  submitting = false,
  onSubmit,
}: SchemaBuilderDialogProps) {
  const [schemaName, setSchemaName] = useState("");
  const [schemaDescription, setSchemaDescription] = useState("");
  const [schemaExtractionMode, setSchemaExtractionMode] =
    useState<SchemaExtractionMode>("AUTO");
  const [schemaRecordStartRegex, setSchemaRecordStartRegex] = useState("");
  const [activeSection, setActiveSection] = useState<Section>("info");
  const [conditions, setConditions] = useState<ConditionRule[]>([]);
  const [tabs, setTabs] = useState<SchemaPresetTab[]>([]);
  const [activeTabIndex, setActiveTabIndex] = useState(0);
  const [tabDraft, setTabDraft] = useState("");
  const [isTabEditorOpen, setIsTabEditorOpen] = useState(false);
  const [editingTabIndex, setEditingTabIndex] = useState<number | null>(null);
  const [fieldDraft, setFieldDraft] = useState<FieldDraftState>(
    createEmptyFieldDraft(),
  );
  const [isAddingField, setIsAddingField] = useState(false);
  const [editingFieldIndex, setEditingFieldIndex] = useState<number | null>(
    null,
  );
  const [errors, setErrors] = useState<string[]>([]);
  const [payloadEditor, setPayloadEditor] = useState("");
  const [payloadDirty, setPayloadDirty] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSchemaName(initialPreset?.name ?? "");
    setSchemaDescription(initialPreset?.description ?? "");
    setSchemaExtractionMode(initialPreset?.extractionMode ?? "AUTO");
    setSchemaRecordStartRegex(initialPreset?.recordStartRegex ?? "");
    setTabs(initialPreset?.tabs ?? []);
    setActiveTabIndex(0);
    setTabDraft("");
    setIsTabEditorOpen(false);
    setEditingTabIndex(null);
    setFieldDraft(createEmptyFieldDraft());
    setIsAddingField(false);
    setEditingFieldIndex(null);
    setErrors([]);
    setShowAdvanced(false);
    setActiveSection("info");
    try {
      const raw = initialPreset?.conditions;
      setConditions(Array.isArray(raw) && raw.length > 0 ? ((raw as unknown) as ConditionRule[]) : []);
    } catch {
      setConditions([]);
    }
  }, [open, initialPreset]);

  const isGenericMode = schemaExtractionMode === "GENERIC";
  const sectionHintSuggestions = isGenericMode
    ? GENERIC_SECTION_HINT_SUGGESTIONS
    : CONTRACT_SECTION_HINT_SUGGESTIONS;

  const activeTab = tabs[activeTabIndex];

  const allFieldKeys = useMemo(
    () => Array.from(new Set(tabs.flatMap((t) => t.fields.map((f) => f.fieldKey)))),
    [tabs],
 );

  const payloadPreview = useMemo(
    () =>
      JSON.stringify(
        {
          id: initialPreset?.id,
          name: schemaName,
          description: schemaDescription || undefined,
          extractionMode: schemaExtractionMode,
          recordStartRegex: schemaRecordStartRegex.trim() || undefined,
          tabs,
          conditions: conditions.length > 0 ? conditions : undefined,
        },
        null,
        2,
      ),
    [
      initialPreset?.id,
      schemaExtractionMode,
      schemaName,
      schemaDescription,
      schemaRecordStartRegex,
      tabs,
      conditions,
    ],
  );

  useEffect(() => {
    if (!open) return;
    if (!payloadDirty) {
      setPayloadEditor(payloadPreview);
    }
  }, [open, payloadPreview, payloadDirty]);

  const applyPayloadEditor = () => {
    try {
      const parsed = JSON.parse(payloadEditor) as Partial<SchemaPresetDraft>;
      if (!parsed || typeof parsed !== "object") {
        throw new Error("Payload must be a JSON object.");
      }

      const nextName =
        typeof parsed.name === "string" ? parsed.name.trim() : "";
      if (!nextName) {
        throw new Error("Payload must include a non-empty 'name'.");
      }

      if (!Array.isArray(parsed.tabs)) {
        throw new Error("Payload must include 'tabs' as an array.");
      }

      const nextExtractionMode =
        parsed.extractionMode === "AUTO" ||
        parsed.extractionMode === "CONTRACT_BIASED" ||
        parsed.extractionMode === "GENERIC"
          ? parsed.extractionMode
          : "AUTO";

      const nextRecordStartRegex =
        typeof parsed.recordStartRegex === "string"
          ? parsed.recordStartRegex.trim()
          : "";

      const nextTabs: SchemaPresetTab[] = parsed.tabs.map((tab, tabIndex) => {
        const tabName = String((tab as any)?.name ?? "").trim();
        if (!tabName) {
          throw new Error(`Tab #${tabIndex + 1} is missing a valid 'name'.`);
        }

        const fieldsRaw = (tab as any)?.fields;
        if (!Array.isArray(fieldsRaw)) {
          throw new Error(
            `Tab '${tabName}' must include 'fields' as an array.`,
          );
        }

        const fields: SchemaPresetField[] = fieldsRaw.map(
          (field: any, fieldIndex: number) => {
            const label = String(field?.label ?? "").trim();
            const fieldKey = String(field?.fieldKey ?? "").trim();
            const regexRule = String(field?.regexRule ?? "");

            if (!label || !fieldKey) {
              throw new Error(
                `Tab '${tabName}', field #${fieldIndex + 1} must include non-empty 'label' and 'fieldKey'.`,
              );
            }

            return {
              label,
              fieldKey,
              regexRule,
              extractionStrategy: field?.extractionStrategy,
              dataType: field?.dataType,
              pageRange:
                typeof field?.pageRange === "string"
                  ? field.pageRange
                  : undefined,
              postProcessing: Array.isArray(field?.postProcessing)
                ? field.postProcessing
                    .map((v: unknown) => String(v).trim())
                    .filter(Boolean)
                : undefined,
              altRegexRules: Array.isArray(field?.altRegexRules)
                ? field.altRegexRules
                    .map((v: unknown) => String(v).trim())
                    .filter(Boolean)
                : undefined,
              sectionHint: field?.sectionHint,
              sectionIndicatorKey:
                typeof field?.sectionIndicatorKey === "string"
                  ? field.sectionIndicatorKey
                  : typeof field?.contextLabel === "string"
                    ? field.contextLabel
                    : undefined,
              contextHint: field?.contextHint,
              contextLabel:
                typeof field?.contextLabel === "string"
                  ? field.contextLabel
                  : undefined,
              mandatory:
                typeof field?.mandatory === "boolean"
                  ? field.mandatory
                  : undefined,
              expectedFormat:
                typeof field?.expectedFormat === "string"
                  ? field.expectedFormat
                  : undefined,
              minLength:
                typeof field?.minLength === "number"
                  ? field.minLength
                  : undefined,
              maxLength:
                typeof field?.maxLength === "number"
                  ? field.maxLength
                  : undefined,
              allowedValues: Array.isArray(field?.allowedValues)
                ? field.allowedValues
                    .map((v: unknown) => String(v).trim())
                    .filter(Boolean)
                : undefined,
            };
          },
        );

        return { name: tabName, fields };
      });

      setSchemaName(nextName);
      setSchemaExtractionMode(nextExtractionMode);
      setSchemaRecordStartRegex(nextRecordStartRegex);
      setTabs(nextTabs);
      setActiveTabIndex(0);
      setIsTabEditorOpen(false);
      setEditingTabIndex(null);
      setTabDraft("");
      clearFieldDraft();
      setErrors([]);
      setPayloadDirty(false);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Invalid payload JSON.";
      setErrors([`Payload JSON error: ${message}`]);
    }
  };

  const clearFieldDraft = () => {
    setFieldDraft(createEmptyFieldDraft());
    setEditingFieldIndex(null);
  };

  const startAddField = () => {
    clearFieldDraft();
    setIsAddingField(true);
    setShowAdvanced(false);
    setErrors([]);
  };

  const cancelFieldEditor = () => {
    clearFieldDraft();
    setIsAddingField(false);
    setShowAdvanced(false);
    setErrors([]);
  };

  const upsertTab = () => {
    const name = tabDraft.trim();
    if (!name) {
      setErrors(["Tab name is required."]);
      return;
    }

    const duplicate = tabs.findIndex(
      (t, i) =>
        i !== editingTabIndex && t.name.toLowerCase() === name.toLowerCase(),
    );
    if (duplicate >= 0) {
      setErrors(["Tab name must be unique."]);
      return;
    }

    if (editingTabIndex === null) {
      const next = [...tabs, { name, fields: [] }];
      setTabs(next);
      setActiveTabIndex(next.length - 1);
    } else {
      setTabs((prev) =>
        prev.map((t, i) => (i === editingTabIndex ? { ...t, name } : t)),
      );
      setActiveTabIndex(editingTabIndex);
    }

    setTabDraft("");
    setIsTabEditorOpen(false);
    setEditingTabIndex(null);
    setErrors([]);
  };

  const startAddTab = () => {
    setTabDraft("");
    setIsTabEditorOpen(true);
    setEditingTabIndex(null);
    setErrors([]);
  };

  const cancelTabEditor = () => {
    setTabDraft("");
    setIsTabEditorOpen(false);
    setEditingTabIndex(null);
    setErrors([]);
  };

  const editTab = (index: number) => {
    setTabDraft(tabs[index].name);
    setIsTabEditorOpen(true);
    setEditingTabIndex(index);
    setErrors([]);
  };

  const removeTab = (index: number) => {
    setTabs((prev) => {
      const nextTabs = prev.filter((_, i) => i !== index);

      setActiveTabIndex((current) => {
        if (nextTabs.length === 0) return 0;
        if (current === index) return Math.min(index, nextTabs.length - 1);
        if (current > index) return current - 1;
        return current;
      });

      return nextTabs;
    });

    if (editingTabIndex === index) {
      cancelTabEditor();
    } else if (editingTabIndex !== null && editingTabIndex > index) {
      setEditingTabIndex(editingTabIndex - 1);
    }
    setEditingFieldIndex(null);
  };

  const upsertField = () => {
    if (!activeTab) {
      setErrors(["Add a tab first."]);
      return;
    }

    const label = fieldDraft.label?.trim();
    const fieldKey = fieldDraft.fieldKey?.trim();
    const resolvedContextLabel = (
      fieldDraft.contextLabel ||
      label ||
      ""
    ).trim();
    const regexRule =
      fieldDraft.regexRule ||
      buildRegexFromHints(
        fieldDraft.fieldKey || "",
        fieldDraft.dataType,
        resolvedContextLabel,
        fieldDraft.sampleValue || "",
      );

    if (!label || !fieldKey) {
      setErrors(["Document Label and Field Key are required."]);
      return;
    }

    const duplicate = activeTab.fields.findIndex(
      (f, i) =>
        i !== editingFieldIndex &&
        f.fieldKey.toLowerCase() === fieldKey.toLowerCase(),
    );
    if (duplicate >= 0) {
      setErrors(["Field key must be unique in a tab."]);
      return;
    }

    setTabs((prev) =>
      prev.map((tab, idx) => {
        if (idx !== activeTabIndex) return tab;

        const nextField: SchemaPresetField = {
          label: label!,
          fieldKey: fieldKey!,
          regexRule,
          extractionStrategy: fieldDraft.extractionStrategy as any,
          dataType: fieldDraft.dataType as any,
          pageRange: fieldDraft.pageRange || undefined,
          postProcessing: buildPostProcessingRules(fieldDraft),
          altRegexRules:
            (fieldDraft.altRegexRules?.length || 0) > 0
              ? fieldDraft.altRegexRules
              : undefined,
          sectionHint: fieldDraft.sectionHint,
          sectionIndicatorKey: fieldDraft.sectionIndicatorKey,
          contextHint: fieldDraft.contextHint,
          contextLabel: resolvedContextLabel || undefined,
          mandatory: fieldDraft.mandatory,
          expectedFormat: fieldDraft.expectedFormat || undefined,
          minLength: fieldDraft.minLength,
          maxLength: fieldDraft.maxLength,
          allowedValues:
            (fieldDraft.allowedValues?.length || 0) > 0
              ? fieldDraft.allowedValues
              : undefined,
        };

        if (editingFieldIndex === null) {
          return { ...tab, fields: [...tab.fields, nextField] };
        }

        return {
          ...tab,
          fields: tab.fields.map((f, i) =>
            i === editingFieldIndex ? nextField : f,
          ),
        };
      }),
    );

    clearFieldDraft();
    setIsAddingField(false);
    setErrors([]);
  };

  const editField = (index: number) => {
    if (!activeTab) return;
    const field = activeTab.fields[index];
    const transforms = parseTransformDraft(field);
    setFieldDraft({
      label: field.label,
      fieldKey: field.fieldKey,
      regexRule: field.regexRule,
      sampleValue: "",
      extractionStrategy: field.extractionStrategy || "table_column",
      dataType: field.dataType || "string",
      pageRange: field.pageRange || "",
      postProcessing: field.postProcessing || [],
      altRegexRules: field.altRegexRules || [],
      sectionHint: field.sectionHint,
      sectionIndicatorKey: field.sectionIndicatorKey || field.contextLabel || "",
      contextHint: field.contextHint || "table_cell",
      contextLabel: field.contextLabel || "",
      mandatory: field.mandatory || false,
      expectedFormat: field.expectedFormat || "",
      minLength: field.minLength,
      maxLength: field.maxLength,
      allowedValues: field.allowedValues || [],
      ...transforms,
    });
    setIsAddingField(false);
    setEditingFieldIndex(index);
    setErrors([]);
  };

  const removeField = (index: number) => {
    setTabs((prev) =>
      prev.map((tab, idx) =>
        idx === activeTabIndex
          ? { ...tab, fields: tab.fields.filter((_, i) => i !== index) }
          : tab,
      ),
    );

    if (editingFieldIndex === index) clearFieldDraft();
  };

  const loadContractTemplate = () => {
    setSchemaName((prev) => (prev.trim() ? prev : "Contract Schema"));
    setSchemaExtractionMode("CONTRACT_BIASED");
    setSchemaRecordStartRegex("6\\s*[-.]\\s*1|GENERAL\\s+RATE");
    setTabs(CONTRACT_TEMPLATE_TABS);
    setActiveTabIndex(0);
    setTabDraft("");
    setIsTabEditorOpen(false);
    setEditingTabIndex(null);
    setIsAddingField(false);
    clearFieldDraft();
    setErrors([]);
  };

  const submitAll = async () => {
    const normalizedName = schemaName.trim();
    if (!normalizedName) {
      setErrors(["Schema name is required."]);
      return;
    }

    if (tabs.length === 0) {
      setErrors(["Add at least one tab."]);
      return;
    }

    if (tabs.some((t) => t.fields.length === 0)) {
      setErrors(["Each tab must have at least one field."]);
      return;
    }

    await onSubmit({
      id: initialPreset?.id,
      name: normalizedName,
      description: schemaDescription.trim() || undefined,
      extractionMode: schemaExtractionMode,
      recordStartRegex: schemaRecordStartRegex.trim() || undefined,
      tabs,
      conditions: conditions.length > 0 ? ((conditions as unknown) as Array<Record<string, unknown>>) : undefined,
    });
  };

  const addCondition = () => {
    setConditions((prev) => [
      ...prev,
      { id: Math.random().toString(36).slice(2), ifField: "", ifOperator: "equals", ifValue: "", thenField: "", thenAction: "set_to", thenValue: "" },
    ]);
    setActiveSection("conditions");
  };

  const updateCondition = (id: string, patch: Partial<ConditionRule>) => {
    setConditions((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  };

  const removeCondition = (id: string) => {
    setConditions((prev) => prev.filter((c) => c.id !== id));
  };

  const renderFieldEditor = () => (
    <div className="space-y-3 border-t pt-3 mt-1">
      {/* Required row */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-xs font-medium">
            Document Label <span className="text-destructive">*</span>
          </Label>
          <Input
            value={fieldDraft.label || ""}
            onChange={(e) => setFieldDraft((p) => ({ ...p, label: e.target.value }))}
            placeholder="e.g. Effective Date, Origin City"
          />
          <p className="text-[11px] text-muted-foreground">Exact text label as it appears in the PDF</p>
        </div>
        <div className="space-y-1">
          <Label className="text-xs font-medium">
            Field Key <span className="text-destructive">*</span>
          </Label>
          <Input
            value={fieldDraft.fieldKey || ""}
            onChange={(e) => setFieldDraft((p) => ({ ...p, fieldKey: e.target.value }))}
            placeholder="e.g. effective_date, origin_city"
          />
          <p className="text-[11px] text-muted-foreground">Column name shown in the review table</p>
        </div>
      </div>

      {/* Type + section */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-xs font-medium">Data Type</Label>
          <select
            value={fieldDraft.dataType || "string"}
            onChange={(e) => setFieldDraft((p) => ({ ...p, dataType: e.target.value as any }))}
            className={SELECT_CLASS}
          >
            <option value="string">Text / String</option>
            <option value="currency">Currency / Money</option>
            <option value="number">Number</option>
            <option value="date">Date</option>
            <option value="percentage">Percentage</option>
          </select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs font-medium">Section</Label>
          <select
            value={fieldDraft.sectionHint || ""}
            onChange={(e) => setFieldDraft((p) => ({ ...p, sectionHint: e.target.value || undefined }))}
            className={SELECT_CLASS}
          >
            <option value="">— Any section —</option>
            {sectionHintSuggestions.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          {fieldDraft.sectionHint && (CONTRACT_SECTION_HINT_HELP as Record<string, string>)[fieldDraft.sectionHint] && (
            <p className="text-[11px] text-muted-foreground">{(CONTRACT_SECTION_HINT_HELP as Record<string, string>)[fieldDraft.sectionHint]}</p>
          )}
        </div>
      </div>

      {/* Sample value + auto-regex */}
      <div className="space-y-1">
        <Label className="text-xs font-medium">
          Sample Value <span className="font-normal text-muted-foreground">(helps auto-generate regex)</span>
        </Label>
        <div className="flex gap-2">
          <Input
            value={fieldDraft.sampleValue || ""}
            onChange={(e) => setFieldDraft((p) => ({ ...p, sampleValue: e.target.value }))}
            placeholder="e.g. 12/15/2025   or   New York   or   350.00"
            className="flex-1"
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() =>
              setFieldDraft((p) => ({
                ...p,
                regexRule: buildRegexFromHints(p.fieldKey || "", p.dataType, (p.contextLabel || p.label || "").trim(), p.sampleValue || ""),
              }))
            }
          >
            Auto Regex
          </Button>
        </div>
      </div>

      {/* Mandatory */}
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="field-mandatory"
          checked={fieldDraft.mandatory || false}
          onChange={(e) => setFieldDraft((p) => ({ ...p, mandatory: e.target.checked }))}
          className="rounded border-input"
        />
        <Label htmlFor="field-mandatory" className="text-sm cursor-pointer">Mandatory field</Label>
      </div>

      {/* Advanced toggle */}
      <button
        type="button"
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        onClick={() => setShowAdvanced((v) => !v)}
      >
        {showAdvanced ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        Advanced options
      </button>

      {showAdvanced && (
        <div className="space-y-3 rounded-md border bg-muted/20 p-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Extraction Strategy</Label>
              <select
                value={fieldDraft.extractionStrategy || "table_column"}
                onChange={(e) => setFieldDraft((p) => ({ ...p, extractionStrategy: e.target.value as any }))}
                className={SELECT_CLASS}
              >
                <option value="table_column">Table Column</option>
                <option value="regex">Regex</option>
                <option value="header_field">Header Field</option>
                <option value="page_region">Page Region</option>
              </select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Context Hint</Label>
              <select
                value={fieldDraft.contextHint || "table_cell"}
                onChange={(e) => setFieldDraft((p) => ({ ...p, contextHint: e.target.value as any }))}
                className={SELECT_CLASS}
              >
                <option value="table_cell">Table Cell</option>
                <option value="same_line_after_label">Same Line After Label</option>
                <option value="next_line_after_label">Next Line After Label</option>
              </select>
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Context Label Override</Label>
            <Input
              value={fieldDraft.contextLabel || ""}
              onChange={(e) => setFieldDraft((p) => ({ ...p, contextLabel: e.target.value }))}
              placeholder="Leave empty to use Document Label"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Regex Rule</Label>
            <Input
              value={fieldDraft.regexRule || ""}
              onChange={(e) => setFieldDraft((p) => ({ ...p, regexRule: e.target.value }))}
              placeholder="Auto-generated or enter manually"
              className="font-mono text-xs"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Page Range</Label>
            <Input
              value={fieldDraft.pageRange || ""}
              onChange={(e) => setFieldDraft((p) => ({ ...p, pageRange: e.target.value }))}
              placeholder='e.g. "1" or "1-3" — leave empty for all pages'
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Expected Format</Label>
              <Input
                value={fieldDraft.expectedFormat || ""}
                onChange={(e) => setFieldDraft((p) => ({ ...p, expectedFormat: e.target.value }))}
                placeholder="e.g. DD/MM/YYYY"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Min / Max Length</Label>
              <div className="flex gap-2">
                <Input
                  type="number"
                  value={fieldDraft.minLength ?? ""}
                  onChange={(e) => setFieldDraft((p) => ({ ...p, minLength: e.target.value ? parseInt(e.target.value) : undefined }))}
                  placeholder="Min"
                />
                <Input
                  type="number"
                  value={fieldDraft.maxLength ?? ""}
                  onChange={(e) => setFieldDraft((p) => ({ ...p, maxLength: e.target.value ? parseInt(e.target.value) : undefined }))}
                  placeholder="Max"
                />
              </div>
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Post-Processing Rules (comma-separated)</Label>
            <Input
              value={fieldDraft.postProcessing?.join(", ") || ""}
              onChange={(e) =>
                setFieldDraft((p) => ({
                  ...p,
                  postProcessing: e.target.value.split(",").map((s) => s.trim()).filter(Boolean),
                }))
              }
              placeholder="trim, uppercase, remove_commas, remove_currency"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Alternative Regex Rules (one per line)</Label>
            <textarea
              value={fieldDraft.altRegexRules?.join("\n") || ""}
              onChange={(e) =>
                setFieldDraft((p) => ({
                  ...p,
                  altRegexRules: e.target.value.split("\n").map((s) => s.trim()).filter(Boolean),
                }))
              }
              placeholder="Primary regex tried first, then these in order..."
              className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-xs font-mono h-16 resize-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
        </div>
      )}
    </div>
  );

  const renderInfoSection = () => (
    <div className="space-y-5 py-2">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label>Schema Name <span className="text-destructive">*</span></Label>
          <Input
            value={schemaName}
            onChange={(e) => setSchemaName(e.target.value)}
            placeholder="e.g. Container Rates, Freight Contracts..."
          />
        </div>
        <div className="space-y-1.5">
          <Label>Description <span className="text-muted-foreground font-normal">(optional)</span></Label>
          <Input
            value={schemaDescription}
            onChange={(e) => setSchemaDescription(e.target.value)}
            placeholder="What does this schema extract?"
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label>Extraction Mode</Label>
          <select
            value={schemaExtractionMode}
            onChange={(e) => setSchemaExtractionMode(e.target.value as SchemaExtractionMode)}
            className={SELECT_CLASS}
          >
            <option value="AUTO">AUTO — let the system decide</option>
            <option value="CONTRACT_BIASED">CONTRACT_BIASED — optimised for logistics contracts</option>
            <option value="GENERIC">GENERIC — general documents</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <Label>Record Start Regex <span className="text-muted-foreground font-normal">(optional)</span></Label>
          <Input
            value={schemaRecordStartRegex}
            onChange={(e) => setSchemaRecordStartRegex(e.target.value)}
            placeholder="e.g. 6\s*[-.]1|GENERAL\s+RATE"
            className="font-mono text-xs"
          />
          <p className="text-xs text-muted-foreground">Pattern that marks the start of a new record.</p>
        </div>
      </div>
      <div className="border rounded-md p-4 bg-muted/20 space-y-2">
        <p className="text-sm font-medium">Quick-start template</p>
        <p className="text-xs text-muted-foreground">
          Populate with standard logistics contract fields (Rates, Origin &amp; Destination Arbitraries).
        </p>
        <Button type="button" variant="outline" size="sm" onClick={loadContractTemplate}>
          Load Contract Fields Template
        </Button>
      </div>
    </div>
  );

  const renderFieldsSection = () => (
    <div className="flex h-full overflow-hidden">
      {/* Sidebar */}
      <div className="w-52 shrink-0 border-r flex flex-col overflow-hidden">
        <div className="px-3 pt-3 pb-1 flex items-center justify-between">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Sections</span>
          <Badge variant="secondary" className="text-xs">{tabs.length}</Badge>
        </div>
        <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-0.5">
          {tabs.map((tab, idx) => {
            const isActive = idx === activeTabIndex;
            const isEditingThis = isTabEditorOpen && editingTabIndex === idx;
            if (isEditingThis) {
              return (
                <div key={idx} className="flex items-center gap-1 rounded-md border bg-background px-2 py-1">
                  <Input
                    value={tabDraft}
                    onChange={(e) => setTabDraft(e.target.value)}
                    placeholder="Section name"
                    className="h-6 flex-1 text-sm"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Enter") { e.preventDefault(); upsertTab(); }
                      if (e.key === "Escape") { e.preventDefault(); cancelTabEditor(); }
                    }}
                  />
                  <Button type="button" size="icon" variant="ghost" className="h-6 w-6 shrink-0" onClick={upsertTab}><Check className="h-3 w-3" /></Button>
                  <Button type="button" size="icon" variant="ghost" className="h-6 w-6 shrink-0" onClick={cancelTabEditor}><X className="h-3 w-3" /></Button>
                </div>
              );
            }
            return (
              <div
                key={idx}
                onClick={() => { setActiveTabIndex(idx); cancelFieldEditor(); }}
                className={`group flex items-center gap-1.5 rounded-md px-2 py-1.5 cursor-pointer text-sm transition-colors ${isActive ? "bg-primary/10 text-primary font-medium" : "hover:bg-muted text-foreground"}`}
              >
                <span className="flex-1 truncate">{tab.name}</span>
                <span className="text-[11px] text-muted-foreground shrink-0">({tab.fields.length})</span>
                <span className="hidden group-hover:flex items-center gap-0.5 shrink-0">
                  <Button type="button" size="icon" variant="ghost" className="h-5 w-5" onClick={(e) => { e.stopPropagation(); editTab(idx); }}>
                    <Pencil className="h-3 w-3" />
                  </Button>
                  <Button type="button" size="icon" variant="ghost" className="h-5 w-5 text-destructive hover:text-destructive" onClick={(e) => { e.stopPropagation(); removeTab(idx); }}>
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </span>
              </div>
            );
          })}
          {isTabEditorOpen && editingTabIndex === null && (
            <div className="flex items-center gap-1 rounded-md border bg-background px-2 py-1">
              <Input
                value={tabDraft}
                onChange={(e) => setTabDraft(e.target.value)}
                placeholder="Section name"
                className="h-6 flex-1 text-sm"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter") { e.preventDefault(); upsertTab(); }
                  if (e.key === "Escape") { e.preventDefault(); cancelTabEditor(); }
                }}
              />
              <Button type="button" size="icon" variant="ghost" className="h-6 w-6 shrink-0" onClick={upsertTab}><Check className="h-3 w-3" /></Button>
              <Button type="button" size="icon" variant="ghost" className="h-6 w-6 shrink-0" onClick={cancelTabEditor}><X className="h-3 w-3" /></Button>
            </div>
          )}
        </div>
        <div className="border-t p-2 shrink-0">
          <Button type="button" variant="outline" size="sm" className="w-full" onClick={startAddTab} disabled={isTabEditorOpen}>
            <Plus className="h-3.5 w-3.5 mr-1" />Add Section
          </Button>
        </div>
      </div>

      {/* Fields panel */}
      <ScrollArea className="flex-1">
        <div className="p-4 space-y-3">
          {activeTab ? (
            <>
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-semibold text-sm">{activeTab.name}</h3>
                  <p className="text-xs text-muted-foreground">{activeTab.fields.length} field{activeTab.fields.length !== 1 ? "s" : ""}</p>
                </div>
                {!isAddingField && editingFieldIndex === null && (
                  <Button type="button" size="sm" onClick={startAddField}>
                    <Plus className="h-3.5 w-3.5 mr-1" />Add Field
                  </Button>
                )}
              </div>

              {isAddingField && (
                <div className="rounded-md border bg-background p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">New Field</span>
                    <div className="flex gap-2">
                      <Button type="button" size="sm" onClick={upsertField}>Save Field</Button>
                      <Button type="button" size="sm" variant="outline" onClick={cancelFieldEditor}>Cancel</Button>
                    </div>
                  </div>
                  {renderFieldEditor()}
                </div>
              )}

              {activeTab.fields.length === 0 && !isAddingField ? (
                <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
                  No fields yet. Click "Add Field" to get started.
                </div>
              ) : (
                <div className="space-y-2">
                  {activeTab.fields.map((field, idx) => (
                    <div key={`${field.fieldKey}-${idx}`} className="rounded-md border bg-background">
                      <div className="flex items-center gap-3 p-2.5">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-sm truncate">{field.fieldKey}</span>
                            <Badge variant={(DATA_TYPE_COLORS[field.dataType || "string"] as any) || "secondary"} className="text-[10px] py-0">
                              {DATA_TYPE_LABELS[field.dataType || "string"] || field.dataType}
                            </Badge>
                            {field.mandatory && (
                              <Badge variant="outline" className="text-[10px] py-0 border-destructive/50 text-destructive">Required</Badge>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground truncate mt-0.5">
                            Label: {field.label}{field.sectionHint ? ` · ${field.sectionHint}` : ""}
                          </p>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          {editingFieldIndex === idx ? (
                            <>
                              <Button type="button" size="sm" onClick={upsertField}>Save</Button>
                              <Button type="button" size="sm" variant="outline" onClick={cancelFieldEditor}>Cancel</Button>
                            </>
                          ) : (
                            <Button type="button" size="sm" variant="outline" onClick={() => editField(idx)}>Edit</Button>
                          )}
                          <Button type="button" size="icon" variant="ghost" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => removeField(idx)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                      {editingFieldIndex === idx && (
                        <div className="px-3 pb-3">{renderFieldEditor()}</div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="flex flex-col items-center justify-center h-48 text-center gap-3">
              <Layers className="h-8 w-8 text-muted-foreground/40" />
              <div>
                <p className="text-sm font-medium">No sections yet</p>
                <p className="text-xs text-muted-foreground mt-1">Add a section in the sidebar to start defining fields.</p>
              </div>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );

  const renderConditionsSection = () => (
    <div className="space-y-4 py-2">
      <div>
        <h3 className="font-semibold">Conditions &amp; Rules</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Define rules that post-process extracted values. Example:{" "}
          <span className="italic">IF <strong>BaseRate 20</strong> is greater than 500 THEN <strong>BaseRate 40</strong> multiply by 1.2</span>.
        </p>
      </div>

      {allFieldKeys.length === 0 && (
        <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground text-center">
          Add fields in the <strong>Fields</strong> section first.
        </div>
      )}

      {conditions.length === 0 ? (
        <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
          No conditions defined. Click "Add Condition" to create one.
        </div>
      ) : (
        <div className="space-y-3">
          {conditions.map((cond, idx) => (
            <div key={cond.id} className="rounded-md border bg-background p-3 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <span className="text-xs font-semibold text-muted-foreground mt-0.5">Rule #{idx + 1}</span>
                <Button type="button" size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive shrink-0" onClick={() => removeCondition(cond.id)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="w-10 text-sm font-semibold text-muted-foreground shrink-0">IF</span>
                <select
                  value={cond.ifField}
                  onChange={(e) => updateCondition(cond.id, { ifField: e.target.value })}
                  className="rounded-md border border-input bg-background px-2 py-1.5 text-sm min-w-[140px]"
                >
                  <option value="">— select field —</option>
                  {allFieldKeys.map((k) => <option key={k} value={k}>{k}</option>)}
                </select>
                <select
                  value={cond.ifOperator}
                  onChange={(e) => updateCondition(cond.id, { ifOperator: e.target.value as ConditionOperator })}
                  className="rounded-md border border-input bg-background px-2 py-1.5 text-sm min-w-[160px]"
                >
                  {(Object.keys(OPERATOR_LABELS) as ConditionOperator[]).map((op) => (
                    <option key={op} value={op}>{OPERATOR_LABELS[op]}</option>
                  ))}
                </select>
                <Input value={cond.ifValue} onChange={(e) => updateCondition(cond.id, { ifValue: e.target.value })} placeholder="value..." className="w-32" />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="w-10 text-sm font-semibold text-primary shrink-0">THEN</span>
                <select
                  value={cond.thenField}
                  onChange={(e) => updateCondition(cond.id, { thenField: e.target.value })}
                  className="rounded-md border border-input bg-background px-2 py-1.5 text-sm min-w-[140px]"
                >
                  <option value="">— target field —</option>
                  {allFieldKeys.map((k) => <option key={k} value={k}>{k}</option>)}
                </select>
                <select
                  value={cond.thenAction}
                  onChange={(e) => updateCondition(cond.id, { thenAction: e.target.value as ConditionAction })}
                  className="rounded-md border border-input bg-background px-2 py-1.5 text-sm min-w-[130px]"
                >
                  {(Object.keys(ACTION_LABELS) as ConditionAction[]).map((a) => (
                    <option key={a} value={a}>{ACTION_LABELS[a]}</option>
                  ))}
                </select>
                {cond.thenAction !== "clear" && (
                  <Input value={cond.thenValue} onChange={(e) => updateCondition(cond.id, { thenValue: e.target.value })} placeholder={cond.thenAction === "multiply_by" ? "e.g. 1.2" : "value..."} className="w-32" />
                )}
              </div>
              {cond.ifField && cond.thenField && (
                <p className="text-xs text-muted-foreground border-t pt-2">
                  When <strong>{cond.ifField}</strong>{" "}{OPERATOR_LABELS[cond.ifOperator]}{cond.ifValue ? <> <em>"{cond.ifValue}"</em></> : ""}{" "}
                  {"-> "}{ACTION_LABELS[cond.thenAction]} <strong>{cond.thenField}</strong>{cond.thenAction !== "clear" && cond.thenValue ? <> by <em>{cond.thenValue}</em></> : null}.
                </p>
              )}
            </div>
          ))}
        </div>
      )}
      <Button type="button" variant="outline" onClick={addCondition}>
        <Plus className="h-4 w-4 mr-2" />Add Condition
      </Button>
    </div>
  );

  const renderJsonSection = () => (
    <div className="space-y-3 py-2">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-sm">Raw JSON Editor</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Edit the schema payload directly. Click "Apply" to sync back to the form.</p>
        </div>
        <div className="flex gap-2">
          <Button type="button" size="sm" variant="outline" onClick={() => { setPayloadEditor(payloadPreview); setPayloadDirty(false); setErrors([]); }}>
            Reset from Form
          </Button>
          <Button type="button" size="sm" onClick={applyPayloadEditor}>Apply JSON</Button>
        </div>
      </div>
      <textarea
        value={payloadEditor}
        onChange={(e) => { setPayloadEditor(e.target.value); setPayloadDirty(true); }}
        className="w-full rounded-md border border-input bg-muted/30 p-3 text-xs font-mono min-h-[420px] resize-y focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        spellCheck={false}
      />
    </div>
  );

  const SECTIONS: { id: Section; label: string; icon: React.ReactNode; badge?: number }[] = [
    { id: "info", label: "Info", icon: <Info className="h-4 w-4" /> },
    { id: "fields", label: "Fields", icon: <Layers className="h-4 w-4" />, badge: tabs.reduce((sum, t) => sum + t.fields.length, 0) },
    { id: "conditions", label: "Conditions", icon: <Zap className="h-4 w-4" />, badge: conditions.length || undefined },
    { id: "json", label: "JSON", icon: <Code2 className="h-4 w-4" /> },
  ];

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="sm:max-w-[1100px] h-[90vh] overflow-hidden flex flex-col p-0">
        <DialogHeader className="px-6 pt-5 pb-0 shrink-0">
          <DialogTitle>Schema Builder</DialogTitle>
        </DialogHeader>

        {/* Section tab nav */}
        <div className="flex items-center gap-0 px-6 border-b shrink-0 mt-3">
          {SECTIONS.map((sec) => (
            <button
              key={sec.id}
              type="button"
              onClick={() => setActiveSection(sec.id)}
              className={`flex items-center gap-1.5 px-3 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                activeSection === sec.id
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground/40"
              }`}
            >
              {sec.icon}
              {sec.label}
              {sec.badge !== undefined && sec.badge > 0 && (
                <span className={`rounded-full text-[10px] px-1.5 py-0 leading-4 font-normal ${activeSection === sec.id ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"}`}>
                  {sec.badge}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Content area */}
        <div className="flex-1 overflow-hidden">
          {activeSection === "fields" ? (
            renderFieldsSection()
          ) : (
            <ScrollArea className="h-full">
              <div className="px-6 py-4">
                {activeSection === "info" && renderInfoSection()}
                {activeSection === "conditions" && renderConditionsSection()}
                {activeSection === "json" && renderJsonSection()}
              </div>
            </ScrollArea>
          )}
        </div>

        {errors.length > 0 && (
          <div className="mx-6 shrink-0 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {errors.join(" ")}
          </div>
        )}

        <DialogFooter className="px-6 py-4 shrink-0 border-t">
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={submitAll} disabled={submitting}>
            {submitting ? "Saving..." : "Save Schema"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}