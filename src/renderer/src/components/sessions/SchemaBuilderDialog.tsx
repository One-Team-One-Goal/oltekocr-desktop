import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Check, Pencil, Plus, Trash2, X } from "lucide-react";

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
  extractionMode?: "AUTO" | "CONTRACT_BIASED" | "GENERIC";
  recordStartRegex?: string;
  tabs: SchemaPresetTab[];
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
type FieldDraftState = Partial<SchemaPresetField> & {
  sampleValue?: string;
  dateOffsetDays?: string;
  numberCalcMode?: NumberCalcMode;
  numberTransformOp?: NumberTransformOp;
  numberTransformValue?: string;
  numberTransformField?: string;
  numberFormula?: string;
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
  const [schemaExtractionMode, setSchemaExtractionMode] =
    useState<SchemaExtractionMode>("AUTO");
  const [schemaRecordStartRegex, setSchemaRecordStartRegex] = useState("");
  const [tabs, setTabs] = useState<SchemaPresetTab[]>([]);
  const [activeTabIndex, setActiveTabIndex] = useState(0);
  const [tabDraft, setTabDraft] = useState("");
  const [isTabEditorOpen, setIsTabEditorOpen] = useState(false);
  const [editingTabIndex, setEditingTabIndex] = useState<number | null>(null);
  const [fieldDraft, setFieldDraft] = useState<FieldDraftState>(
    createEmptyFieldDraft(),
  );
  const [useCustomSectionHint, setUseCustomSectionHint] = useState(false);
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
    setSchemaExtractionMode(initialPreset?.extractionMode ?? "AUTO");
    setSchemaRecordStartRegex(initialPreset?.recordStartRegex ?? "");
    setTabs(initialPreset?.tabs ?? []);
    setActiveTabIndex(0);
    setTabDraft("");
    setIsTabEditorOpen(false);
    setEditingTabIndex(null);
    setFieldDraft(createEmptyFieldDraft());
    setUseCustomSectionHint(false);
    setIsAddingField(false);
    setEditingFieldIndex(null);
    setErrors([]);
    setShowAdvanced(false);
  }, [open, initialPreset]);

  const isGenericMode = schemaExtractionMode === "GENERIC";
  const sectionHintSuggestions = isGenericMode
    ? GENERIC_SECTION_HINT_SUGGESTIONS
    : CONTRACT_SECTION_HINT_SUGGESTIONS;

  const activeTab = tabs[activeTabIndex];
  const payloadPreview = useMemo(
    () =>
      JSON.stringify(
        {
          id: initialPreset?.id,
          name: schemaName,
          extractionMode: schemaExtractionMode,
          recordStartRegex: schemaRecordStartRegex.trim() || undefined,
          tabs,
        },
        null,
        2,
      ),
    [
      initialPreset?.id,
      schemaExtractionMode,
      schemaName,
      schemaRecordStartRegex,
      tabs,
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
    setUseCustomSectionHint(false);
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
    setUseCustomSectionHint(
      !!field.sectionHint &&
        !sectionHintSuggestions.includes(field.sectionHint.toUpperCase()),
    );
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
      extractionMode: schemaExtractionMode,
      recordStartRegex: schemaRecordStartRegex.trim() || undefined,
      tabs,
    });
  };

  const renderFieldEditor = () => (
    <>
      <div className="space-y-3 bg-muted/30 p-3 rounded-md">
        <Label className="font-semibold text-sm">Field Setup</Label>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Document Label *</Label>
            <Input
              value={fieldDraft.label || ""}
              onChange={(e) =>
                setFieldDraft((p) => ({ ...p, label: e.target.value }))
              }
              placeholder="e.g., Destination, Effective Date, Scope"
            />
          </div>
          <div>
            <Label className="text-xs">Field Key (Review Column) *</Label>
            <Input
              value={fieldDraft.fieldKey || ""}
              onChange={(e) =>
                setFieldDraft((p) => ({ ...p, fieldKey: e.target.value }))
              }
              placeholder="e.g., destination_city or Destination"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">
              Document Label Override (Optional)
            </Label>
            <Input
              value={fieldDraft.contextLabel || ""}
              onChange={(e) =>
                setFieldDraft((p) => ({ ...p, contextLabel: e.target.value }))
              }
              placeholder="Leave empty to use Document Label"
            />
          </div>
          <div>
            <Label className="text-xs">Usual Value</Label>
            <Input
              value={fieldDraft.sampleValue || ""}
              onChange={(e) =>
                setFieldDraft((p) => ({ ...p, sampleValue: e.target.value }))
              }
              placeholder="e.g., New York / Charleston / 12/9/2025 / 350"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Section Hint</Label>
            <select
              value={fieldDraft.sectionHint || "RATES"}
              onChange={(e) =>
                setFieldDraft((p) => ({
                  ...p,
                  sectionHint: e.target.value as any,
                }))
              }
              className={SELECT_CLASS}
            >
              <option value="RATES">RATES</option>
              <option value="ORIGIN_ARB">ORIGIN_ARB</option>
              <option value="DEST_ARB">DEST_ARB</option>
              <option value="HEADER">HEADER</option>
            </select>
            <div className="text-xs text-muted-foreground mt-1">
              {
                CONTRACT_SECTION_HINT_HELP[
                  (fieldDraft.sectionHint || "RATES") as
                    | "RATES"
                    | "ORIGIN_ARB"
                    | "DEST_ARB"
                    | "HEADER"
                ]
              }
            </div>
          </div>
          <div>
            <Label className="text-xs">Context Hint</Label>
            <select
              value={fieldDraft.contextHint || "table_cell"}
              onChange={(e) =>
                setFieldDraft((p) => ({
                  ...p,
                  contextHint: e.target.value as any,
                }))
              }
              className={SELECT_CLASS}
            >
              <option value="table_cell">Table Cell</option>
              <option value="same_line_after_label">
                Same Line After Label
              </option>
              <option value="next_line_after_label">
                Next Line After Label
              </option>
            </select>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={fieldDraft.mandatory || false}
            onChange={(e) =>
              setFieldDraft((p) => ({ ...p, mandatory: e.target.checked }))
            }
            id="mandatory-check"
          />
          <Label htmlFor="mandatory-check" className="text-sm cursor-pointer">
            Mandatory
          </Label>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">
            Use Document Label for the PDF text label and Field Key for the
            review table column.
          </span>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() =>
                setFieldDraft((p) => ({
                  ...p,
                  regexRule: buildRegexFromHints(
                    p.fieldKey || "",
                    p.dataType,
                    (p.contextLabel || p.label || "").trim(),
                    p.sampleValue || "",
                  ),
                }))
              }
            >
              Auto Regex
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setShowAdvanced((v) => !v)}
            >
              {showAdvanced ? "Hide Advanced" : "Show Advanced"}
            </Button>
          </div>
        </div>
      </div>

      {showAdvanced && (
        <>
          <div className="space-y-2 bg-muted/30 p-3 rounded-md">
            <Label className="font-semibold text-sm">Extraction Strategy</Label>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Strategy</Label>
                <select
                  value={fieldDraft.extractionStrategy || "regex"}
                  onChange={(e) =>
                    setFieldDraft((p) => ({
                      ...p,
                      extractionStrategy: e.target.value as any,
                    }))
                  }
                  className={SELECT_CLASS}
                >
                  <option value="regex">Regex</option>
                  <option value="table_column">Table Column</option>
                  <option value="header_field">Header Field</option>
                  <option value="page_region">Page Region</option>
                </select>
              </div>
              <div>
                <Label className="text-xs">Data Type</Label>
                <select
                  value={fieldDraft.dataType || "string"}
                  onChange={(e) =>
                    setFieldDraft((p) => ({
                      ...p,
                      dataType: e.target.value as any,
                    }))
                  }
                  className={SELECT_CLASS}
                >
                  <option value="string">String</option>
                  <option value="currency">Currency</option>
                  <option value="number">Number</option>
                  <option value="date">Date</option>
                  <option value="percentage">Percentage</option>
                </select>
              </div>
            </div>
            <div>
              <Label className="text-xs">
                Page Range (e.g., \"1\", \"1-3\", \"1,5,7\")
              </Label>
              <Input
                value={fieldDraft.pageRange || ""}
                onChange={(e) =>
                  setFieldDraft((p) => ({ ...p, pageRange: e.target.value }))
                }
                placeholder="Leave empty to search all pages"
              />
            </div>
          </div>

          <div className="space-y-2 bg-muted/30 p-3 rounded-md">
            <Label className="font-semibold text-sm">
              Post-Processing & Fallbacks
            </Label>
            <div>
              <Label className="text-xs">
                Post-Processing Rules (comma-separated)
              </Label>
              <Input
                value={fieldDraft.postProcessing?.join(", ") || ""}
                onChange={(e) =>
                  setFieldDraft((p) => ({
                    ...p,
                    postProcessing: e.target.value
                      .split(",")
                      .map((s) => s.trim())
                      .filter(Boolean),
                  }))
                }
                placeholder="trim, uppercase, remove_commas, remove_currency"
              />
              <div className="text-xs text-muted-foreground mt-1">
                Examples: trim, uppercase, lowercase, remove_commas,
                remove_currency, extract_digits, fix_date
              </div>
            </div>
            <div>
              <Label className="text-xs">
                Alternative Regex Rules (one per line)
              </Label>
              <textarea
                value={fieldDraft.altRegexRules?.join("\n") || ""}
                onChange={(e) =>
                  setFieldDraft((p) => ({
                    ...p,
                    altRegexRules: e.target.value
                      .split("\n")
                      .map((s) => s.trim())
                      .filter(Boolean),
                  }))
                }
                placeholder="Primary regex will be tried first, then these in order..."
                className="w-full px-2 py-1 rounded border text-sm h-16"
              />
            </div>
          </div>

          <div className="space-y-2 bg-muted/30 p-3 rounded-md">
            <Label className="font-semibold text-sm">
              Context & Section Hints
            </Label>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Section Hint</Label>
                <select
                  value={fieldDraft.sectionHint || ""}
                  onChange={(e) =>
                    setFieldDraft((p) => ({
                      ...p,
                      sectionHint: e.target.value as any,
                    }))
                  }
                  className={SELECT_CLASS}
                >
                  <option value="">None</option>
                  <option value="RATES">RATES</option>
                  <option value="ORIGIN_ARB">ORIGIN_ARB</option>
                  <option value="DEST_ARB">DEST_ARB</option>
                  <option value="HEADER">HEADER</option>
                </select>
              </div>
              <div>
                <Label className="text-xs">Context Hint</Label>
                <select
                  value={fieldDraft.contextHint || ""}
                  onChange={(e) =>
                    setFieldDraft((p) => ({
                      ...p,
                      contextHint: e.target.value as any,
                    }))
                  }
                  className={SELECT_CLASS}
                >
                  <option value="">None</option>
                  <option value="same_line_after_label">
                    Same Line After Label
                  </option>
                  <option value="next_line_after_label">
                    Next Line After Label
                  </option>
                  <option value="table_cell">Table Cell</option>
                </select>
              </div>
            </div>
            <div>
              <Label className="text-xs">
                Context Label (e.g., \"Effective Date:\")
              </Label>
              <Input
                value={fieldDraft.contextLabel || ""}
                onChange={(e) =>
                  setFieldDraft((p) => ({ ...p, contextLabel: e.target.value }))
                }
                placeholder="Look for this label before extracting value"
              />
            </div>
          </div>

          <div className="space-y-2 bg-muted/30 p-3 rounded-md">
            <Label className="font-semibold text-sm">
              Validation & Constraints
            </Label>
            <div className="text-xs text-muted-foreground">
              Use only when you need stricter checks.
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Expected Format</Label>
                <Input
                  value={fieldDraft.expectedFormat || ""}
                  onChange={(e) =>
                    setFieldDraft((p) => ({
                      ...p,
                      expectedFormat: e.target.value,
                    }))
                  }
                  placeholder="DD/MM/YYYY"
                />
              </div>
              <div>
                <Label className="text-xs">Min/Max Length</Label>
                <div className="flex gap-2">
                  <Input
                    type="number"
                    value={fieldDraft.minLength || ""}
                    onChange={(e) =>
                      setFieldDraft((p) => ({
                        ...p,
                        minLength: e.target.value
                          ? parseInt(e.target.value)
                          : undefined,
                      }))
                    }
                    placeholder="Min"
                    className="flex-1"
                  />
                  <Input
                    type="number"
                    value={fieldDraft.maxLength || ""}
                    onChange={(e) =>
                      setFieldDraft((p) => ({
                        ...p,
                        maxLength: e.target.value
                          ? parseInt(e.target.value)
                          : undefined,
                      }))
                    }
                    placeholder="Max"
                    className="flex-1"
                  />
                </div>
              </div>
            </div>
            <div>
              <Label className="text-xs">
                Allowed Values (comma-separated, for enum validation)
              </Label>
              <Input
                value={fieldDraft.allowedValues?.join(", ") || ""}
                onChange={(e) =>
                  setFieldDraft((p) => ({
                    ...p,
                    allowedValues: e.target.value
                      .split(",")
                      .map((s) => s.trim())
                      .filter(Boolean),
                  }))
                }
                placeholder="value1, value2, value3"
              />
            </div>
          </div>
        </>
      )}
    </>
  );

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="sm:max-w-[1100px] h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Schema Builder</DialogTitle>
          <DialogDescription>
            Label is the document label from the PDF. Field Key is the column name shown in Contract Review.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="flex-1 overflow-hidden">
              <div className="space-y-4 py-4 px-6">
                <div>
                  <Label>Schema Name</Label>
                  <Input
                    value={schemaName}
                    onChange={(e) => setSchemaName(e.target.value)}
                    placeholder="Contracts"
                  />
                </div>

                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={loadContractTemplate}
                    >
                      Load Contract Fields Template
                    </Button>
                    <span className="text-xs text-muted-foreground">
                      Uses PDF-contract field names, section hints, and table/header
                      strategies.
                    </span>
                  </div>

                  <div>
                    <div className="flex flex-wrap items-end gap-1 border-b pb-0">
                      {tabs.map((tab, idx) => {
                        const isActive = idx === activeTabIndex;
                        const isEditingThisTab =
                          isTabEditorOpen && editingTabIndex === idx;

                        if (isEditingThisTab) {
                          return (
                            <div
                              key={`${tab.name}-${idx}`}
                              className="-mb-px flex h-9 items-center gap-1 rounded-t-md border border-border border-b-background bg-background px-2"
                            >
                              <Input
                                value={tabDraft}
                                onChange={(e) => setTabDraft(e.target.value)}
                                placeholder="Tab Name"
                                className="h-6 w-36"
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") {
                                    e.preventDefault();
                                    upsertTab();
                                  }
                                  if (e.key === "Escape") {
                                    e.preventDefault();
                                    cancelTabEditor();
                                  }
                                }}
                                autoFocus
                              />
                              <Button
                                type="button"
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7"
                                onClick={upsertTab}
                                aria-label={`Confirm ${tab.name} tab edit`}
                              >
                                <Check className="h-4 w-4" />
                              </Button>
                              <Button
                                type="button"
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7"
                                onClick={cancelTabEditor}
                                aria-label={`Cancel ${tab.name} tab edit`}
                              >
                                <X className="h-4 w-4" />
                              </Button>
                            </div>
                          );
                        }

                        return (
                          <button
                            key={`${tab.name}-${idx}`}
                            type="button"
                            onClick={() => setActiveTabIndex(idx)}
                            className={`group relative -mb-px rounded-t-md border px-3 py-1.5 pr-16 text-sm transition-colors ${
                              isActive
                                ? "border-border border-b-background bg-background font-medium text-foreground"
                                : "border-transparent bg-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                            }`}
                          >
                            {tab.name}
                            <span className="ml-1 text-xs text-muted-foreground">
                              ({tab.fields.length})
                            </span>
                            <span className="absolute right-1.5 top-1/2 flex -translate-y-1/2 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                              <Button
                                type="button"
                                size="icon"
                                variant="ghost"
                                className="h-6 w-6"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  editTab(idx);
                                }}
                                aria-label={`Edit ${tab.name} tab`}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                type="button"
                                size="icon"
                                variant="ghost"
                                className="h-6 w-6 text-destructive hover:text-destructive"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  removeTab(idx);
                                }}
                                aria-label={`Delete ${tab.name} tab`}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </span>
                          </button>
                        );
                      })}

                      {isTabEditorOpen && editingTabIndex === null && (
                        <div className="-mb-px flex h-9 items-center gap-1 rounded-t-md border border-border border-b-background bg-background px-2">
                          <Input
                            value={tabDraft}
                            onChange={(e) => setTabDraft(e.target.value)}
                            placeholder="Tab Name"
                            className="h-6 w-36"
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                upsertTab();
                              }
                              if (e.key === "Escape") {
                                e.preventDefault();
                                cancelTabEditor();
                              }
                            }}
                            autoFocus
                          />
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            onClick={upsertTab}
                            aria-label="Confirm new tab"
                          >
                            <Check className="h-4 w-4" />
                          </Button>
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            onClick={cancelTabEditor}
                            aria-label="Cancel new tab"
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      )}

                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="-mb-px h-9 w-9 rounded-t-md border border-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                        onClick={startAddTab}
                        disabled={isTabEditorOpen}
                        aria-label="Add tab"
                      >
                        <Plus className="h-4 w-4" />
                      </Button>
                    </div>

                    {activeTab ? (
                      <div className="space-y-3 border p-3 border-border rounded-md border-t-0 rounded-t-none">
                        <div className="rounded-md border bg-background p-2">
                          <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0 text-sm">
                              <div className="font-medium">New field</div>
                              <div className="text-muted-foreground truncate text-xs">
                                Add a field to this tab.
                              </div>
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              <Button
                                type="button"
                                size="sm"
                                onClick={
                                  isAddingField ? upsertField : startAddField
                                }
                              >
                                {isAddingField ? "Save" : "Add Field"}
                              </Button>
                              {isAddingField && (
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  onClick={cancelFieldEditor}
                                >
                                  Cancel
                                </Button>
                              )}
                            </div>
                          </div>
                          {isAddingField && (
                            <div className="mt-3">{renderFieldEditor()}</div>
                          )}
                        </div>

                        <div className="space-y-2">
                          {activeTab.fields.length === 0 ? (
                            <div className="rounded-md border bg-background p-3 text-sm text-muted-foreground">
                              No fields in this tab.
                            </div>
                          ) : (
                            activeTab.fields.map((field, idx) => (
                              <div
                                key={`${field.fieldKey}-${idx}`}
                                className="rounded-md border bg-background p-2"
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <div className="min-w-0 text-sm">
                                    <div className="font-medium truncate">
                                      {field.fieldKey}
                                    </div>
                                    <div className="text-muted-foreground truncate text-xs">
                                      Document Label: {field.label} |{" "}
                                      {field.dataType || "string"} |{" "}
                                      {field.regexRule || "(no regex)"}
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-1 shrink-0">
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="outline"
                                      onClick={() =>
                                        editingFieldIndex === idx
                                          ? upsertField()
                                          : editField(idx)
                                      }
                                    >
                                      {editingFieldIndex === idx ? "Save" : "Edit"}
                                    </Button>
                                    {editingFieldIndex === idx && (
                                      <Button
                                        type="button"
                                        size="sm"
                                        variant="outline"
                                        onClick={cancelFieldEditor}
                                      >
                                        Cancel
                                      </Button>
                                    )}
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="destructive"
                                      onClick={() => removeField(idx)}
                                    >
                                      Delete
                                    </Button>
                                  </div>
                                </div>

                                {editingFieldIndex === idx && (
                                  <div className="mt-3">{renderFieldEditor()}</div>
                                )}
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-md border bg-background p-3 text-sm text-muted-foreground">
                        No tabs added yet. Click the plus icon to create one.
                      </div>
                    )}
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <Label>Payload Preview (Editable JSON)</Label>
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setPayloadEditor(payloadPreview);
                          setPayloadDirty(false);
                          setErrors([]);
                        }}
                      >
                        Reset from Form
                      </Button>
                      <Button type="button" size="sm" onClick={applyPayloadEditor}>
                        Apply JSON
                      </Button>
                    </div>
                  </div>
                  <textarea
                    value={payloadEditor}
                    onChange={(e) => {
                      setPayloadEditor(e.target.value);
                      setPayloadDirty(true);
                    }}
                    className="max-h-[720px] min-h-[500px] w-full overflow-auto rounded-md border bg-muted/40 p-3 text-xs font-mono"
                  />
                </div>
              </div>
        </ScrollArea>

        {errors.length > 0 && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive mx-6 flex-shrink-0">
            {errors.join(" ")}
          </div>
        )}

        <DialogFooter className="px-6 flex-shrink-0 border-t pt-4">
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
