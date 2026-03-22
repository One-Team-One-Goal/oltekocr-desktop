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

export interface SchemaPresetField {
  label: string;
  fieldKey: string;
  regexRule: string;

  extractionStrategy?: "regex" | "table_column" | "header_field" | "page_region";
  dataType?: "string" | "currency" | "number" | "date" | "percentage";
  pageRange?: string;
  postProcessing?: string[];
  altRegexRules?: string[];
  sectionHint?: string;
  sectionIndicatorKey?: string;
  contextHint?: "same_line_after_label" | "next_line_after_label" | "table_cell";
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
    if (key.includes("city") || key.includes("origin") || key.includes("destination")) {
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
  const [editingTabIndex, setEditingTabIndex] = useState<number | null>(null);
  const [fieldDraft, setFieldDraft] = useState<FieldDraftState>(createEmptyFieldDraft());
  const [useCustomSectionHint, setUseCustomSectionHint] = useState(false);
  const [editingFieldIndex, setEditingFieldIndex] = useState<number | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [payloadEditor, setPayloadEditor] = useState("");
  const [payloadDirty, setPayloadDirty] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSchemaName(initialPreset?.name ?? "");
    setSchemaExtractionMode(initialPreset?.extractionMode ?? "AUTO");
    setSchemaRecordStartRegex(initialPreset?.recordStartRegex ?? "");
    setTabs(initialPreset?.tabs ?? []);
    setActiveTabIndex(0);
    setTabDraft("");
    setEditingTabIndex(null);
    setFieldDraft(createEmptyFieldDraft());
    setUseCustomSectionHint(false);
    setEditingFieldIndex(null);
    setErrors([]);
  }, [open, initialPreset]);

  const isGenericMode = schemaExtractionMode === "GENERIC";
  const sectionHintSuggestions = isGenericMode
    ? GENERIC_SECTION_HINT_SUGGESTIONS
    : CONTRACT_SECTION_HINT_SUGGESTIONS;

  const activeTab = tabs[activeTabIndex];
  const numberFieldOptions = useMemo(() => {
    if (!activeTab) return [] as string[];
    const currentFieldKey = (fieldDraft.fieldKey || "").trim().toLowerCase();
    const options = activeTab.fields
      .filter((f) => f.dataType === "number")
      .map((f) => f.fieldKey)
      .filter((key) => key.trim().toLowerCase() !== currentFieldKey);
    return Array.from(new Set(options));
  }, [activeTab, fieldDraft.fieldKey]);

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
    [initialPreset?.id, schemaExtractionMode, schemaName, schemaRecordStartRegex, tabs],
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

      const nextName = typeof parsed.name === "string" ? parsed.name.trim() : "";
      if (!nextName) {
        throw new Error("Payload must include a non-empty 'name'.");
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

      if (!Array.isArray(parsed.tabs)) {
        throw new Error("Payload must include 'tabs' as an array.");
      }

      const nextTabs: SchemaPresetTab[] = parsed.tabs.map((tab, tabIndex) => {
        const tabName = String((tab as any)?.name ?? "").trim();
        if (!tabName) {
          throw new Error(`Tab #${tabIndex + 1} is missing a valid 'name'.`);
        }

        const fieldsRaw = (tab as any)?.fields;
        if (!Array.isArray(fieldsRaw)) {
          throw new Error(`Tab '${tabName}' must include 'fields' as an array.`);
        }

        const fields: SchemaPresetField[] = fieldsRaw.map((field: any, fieldIndex: number) => {
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
            pageRange: typeof field?.pageRange === "string" ? field.pageRange : undefined,
            postProcessing: Array.isArray(field?.postProcessing)
              ? field.postProcessing.map((v: unknown) => String(v).trim()).filter(Boolean)
              : undefined,
            altRegexRules: Array.isArray(field?.altRegexRules)
              ? field.altRegexRules.map((v: unknown) => String(v).trim()).filter(Boolean)
              : undefined,
            sectionHint: field?.sectionHint,
            sectionIndicatorKey:
              typeof field?.sectionIndicatorKey === "string"
                ? field.sectionIndicatorKey
                : typeof field?.contextLabel === "string"
                  ? field.contextLabel
                  : undefined,
            contextHint: field?.contextHint,
            contextLabel: typeof field?.contextLabel === "string" ? field.contextLabel : undefined,
            mandatory: typeof field?.mandatory === "boolean" ? field.mandatory : undefined,
            expectedFormat:
              typeof field?.expectedFormat === "string" ? field.expectedFormat : undefined,
            minLength: typeof field?.minLength === "number" ? field.minLength : undefined,
            maxLength: typeof field?.maxLength === "number" ? field.maxLength : undefined,
            allowedValues: Array.isArray(field?.allowedValues)
              ? field.allowedValues.map((v: unknown) => String(v).trim()).filter(Boolean)
              : undefined,
          };
        });

        return { name: tabName, fields };
      });

      setSchemaName(nextName);
      setSchemaExtractionMode(nextExtractionMode);
      setSchemaRecordStartRegex(nextRecordStartRegex);
      setTabs(nextTabs);
      setActiveTabIndex(0);
      setEditingTabIndex(null);
      setTabDraft("");
      clearFieldDraft();
      setErrors([]);
      setPayloadDirty(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Invalid payload JSON.";
      setErrors([`Payload JSON error: ${message}`]);
    }
  };

  const clearFieldDraft = () => {
    setFieldDraft(createEmptyFieldDraft());
    setUseCustomSectionHint(false);
    setEditingFieldIndex(null);
  };

  const upsertTab = () => {
    const name = tabDraft.trim();
    if (!name) {
      setErrors(["Tab name is required."]);
      return;
    }

    const duplicate = tabs.findIndex(
      (t, i) => i !== editingTabIndex && t.name.toLowerCase() === name.toLowerCase(),
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
      setTabs((prev) => prev.map((t, i) => (i === editingTabIndex ? { ...t, name } : t)));
      setActiveTabIndex(editingTabIndex);
    }

    setTabDraft("");
    setEditingTabIndex(null);
    setErrors([]);
  };

  const editTab = (index: number) => {
    setTabDraft(tabs[index].name);
    setEditingTabIndex(index);
    setErrors([]);
  };

  const removeTab = (index: number) => {
    setTabs((prev) => prev.filter((_, i) => i !== index));
    setActiveTabIndex((prev) => (prev > 0 ? prev - 1 : 0));
    if (editingTabIndex === index) {
      setTabDraft("");
      setEditingTabIndex(null);
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
    const resolvedContextLabel = (label || "").trim();
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
      (f, i) => i !== editingFieldIndex && f.fieldKey.toLowerCase() === fieldKey.toLowerCase(),
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
          postProcessing: buildPostProcessingRules(fieldDraft),
          sectionHint: fieldDraft.sectionHint,
          sectionIndicatorKey: fieldDraft.sectionIndicatorKey,
          contextHint: fieldDraft.contextHint,
          contextLabel: fieldDraft.sectionIndicatorKey?.trim() || undefined,
        };

        if (editingFieldIndex === null) {
          return { ...tab, fields: [...tab.fields, nextField] };
        }

        return {
          ...tab,
          fields: tab.fields.map((f, i) => (i === editingFieldIndex ? nextField : f)),
        };
      }),
    );

    clearFieldDraft();
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
      postProcessing: field.postProcessing || [],
      sectionHint: field.sectionHint,
      sectionIndicatorKey: field.sectionIndicatorKey || field.contextLabel || "",
      contextHint: field.contextHint || "table_cell",
      ...transforms,
    });
    setUseCustomSectionHint(
      !!field.sectionHint &&
        !sectionHintSuggestions.includes(field.sectionHint.toUpperCase()),
    );
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
    setEditingTabIndex(null);
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

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="sm:max-w-[1100px] max-h-[90vh] overflow-hidden">
        <DialogHeader>
          <DialogTitle>Schema Builder</DialogTitle>
          <DialogDescription>
            Label is the source document text label. Field Key is the output column name shown in review.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[64vh] pr-3">
          <div className="space-y-4 py-1">
            <div>
              <Label>Schema Name</Label>
              <Input
                value={schemaName}
                onChange={(e) => setSchemaName(e.target.value)}
                placeholder="Contracts"
              />
            </div>

            <div className="grid grid-cols-2 gap-3 rounded-md border p-3">
              <div>
                <Label>Extraction Engine</Label>
                <select
                  value={schemaExtractionMode}
                  onChange={(e) =>
                    setSchemaExtractionMode(e.target.value as SchemaExtractionMode)
                  }
                  className={SELECT_CLASS}
                >
                  <option value="AUTO">AUTO</option>
                  <option value="GENERIC">GENERIC</option>
                  <option value="CONTRACT_BIASED">CONTRACT_BIASED</option>
                </select>
                <div className="text-xs text-muted-foreground mt-1">
                  AUTO picks contract mode for contract-like schemas; otherwise generic.
                </div>
              </div>
              <div>
                <Label>Record Start Regex (Optional)</Label>
                <Input
                  value={schemaRecordStartRegex}
                  onChange={(e) => setSchemaRecordStartRegex(e.target.value)}
                  placeholder="e.g., INVOICE|B/L\s+NO"
                />
                <div className="text-xs text-muted-foreground mt-1">
                  Used by generic mode to split multi-record PDFs into rows.
                </div>
              </div>
            </div>

            <div className="rounded-md border p-3 space-y-3">
              <Label>Tabs</Label>
              {!isGenericMode ? (
                <div className="flex items-center gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={loadContractTemplate}>
                    Load Contract Fields Template
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    Uses contract-specific field names, section hints, and table/header strategies.
                  </span>
                </div>
              ) : (
                <div className="text-xs text-muted-foreground rounded-md border border-dashed p-2">
                  Generic mode is schema-first. Define your own tabs/fields and optional section markers.
                </div>
              )}
              <div className="flex items-center gap-2">
                <Input
                  value={tabDraft}
                  onChange={(e) => setTabDraft(e.target.value)}
                  placeholder={isGenericMode ? "Records" : "Rates"}
                />
                <Button type="button" onClick={upsertTab}>
                  {editingTabIndex === null ? "Add Tab" : "Update Tab"}
                </Button>
                {editingTabIndex !== null && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setTabDraft("");
                      setEditingTabIndex(null);
                    }}
                  >
                    Cancel
                  </Button>
                )}
              </div>

              <div className="space-y-2">
                {tabs.length === 0 ? (
                  <div className="rounded-md border p-3 text-sm text-muted-foreground">
                    No tabs added.
                  </div>
                ) : (
                  tabs.map((tab, idx) => (
                    <div
                      key={`${tab.name}-${idx}`}
                      className={`rounded-md border p-2 flex items-center justify-between gap-2 ${
                        idx === activeTabIndex ? "border-primary" : ""
                      }`}
                    >
                      <button
                        type="button"
                        className="text-sm text-left flex-1"
                        onClick={() => setActiveTabIndex(idx)}
                      >
                        {tab.name} ({tab.fields.length} fields)
                      </button>
                      <div className="flex items-center gap-1">
                        <Button type="button" size="sm" variant="outline" onClick={() => editTab(idx)}>
                          Edit
                        </Button>
                        <Button type="button" size="sm" variant="destructive" onClick={() => removeTab(idx)}>
                          Delete
                        </Button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="rounded-md border p-3 space-y-3">
              <Label>
                Fields {activeTab ? `for \"${activeTab.name}\"` : ""}
              </Label>

              <div className="space-y-3 bg-muted/30 p-3 rounded-md">
                <Label className="font-semibold text-sm">Field Setup</Label>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">Document Label *</Label>
                    <Input
                      value={fieldDraft.label || ""}
                      onChange={(e) => setFieldDraft((p) => ({ ...p, label: e.target.value }))}
                      placeholder={
                        isGenericMode
                          ? "e.g., Invoice Number, PO Number, Due Date"
                          : "e.g., Destination, Effective Date, Scope"
                      }
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Field Key (Review Column) *</Label>
                    <Input
                      value={fieldDraft.fieldKey || ""}
                      onChange={(e) => setFieldDraft((p) => ({ ...p, fieldKey: e.target.value }))}
                      placeholder={
                        isGenericMode
                          ? "e.g., invoice_no or Invoice Number"
                          : "e.g., destination_city or Destination"
                      }
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2">
                    <Label className="text-xs">Usual Value</Label>
                    <Input
                      value={fieldDraft.sampleValue || ""}
                      onChange={(e) => setFieldDraft((p) => ({ ...p, sampleValue: e.target.value }))}
                      placeholder="e.g., New York / Charleston / 12/9/2025 / 350"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">Section Hint</Label>
                    <select
                      value={
                        useCustomSectionHint ||
                        (!!fieldDraft.sectionHint &&
                          !sectionHintSuggestions.includes(fieldDraft.sectionHint.toUpperCase()))
                          ? CUSTOM_SECTION_VALUE
                          : fieldDraft.sectionHint || ""
                      }
                      onChange={(e) => {
                        const next = e.target.value;
                        if (next === CUSTOM_SECTION_VALUE) {
                          setUseCustomSectionHint(true);
                          setFieldDraft((p) => ({ ...p, sectionHint: undefined }));
                          return;
                        }
                        setUseCustomSectionHint(false);
                        setFieldDraft((p) => ({ ...p, sectionHint: next || undefined }));
                      }}
                      className={SELECT_CLASS}
                    >
                      <option value="">Select Section</option>
                      {sectionHintSuggestions.map((hint) => (
                        <option key={hint} value={hint}>
                          {hint}
                        </option>
                      ))}
                      <option value={CUSTOM_SECTION_VALUE}>Custom / New Section</option>
                    </select>
                    <div className="text-xs text-muted-foreground mt-1">
                      {!isGenericMode &&
                      CONTRACT_SECTION_HINT_HELP[(fieldDraft.sectionHint || "") as "RATES" | "ORIGIN_ARB" | "DEST_ARB" | "HEADER"]
                        ? CONTRACT_SECTION_HINT_HELP[(fieldDraft.sectionHint || "") as "RATES" | "ORIGIN_ARB" | "DEST_ARB" | "HEADER"]
                        : "Choose Custom/New Section, then use Section Indicator Key to tell the extractor what text marks that section in the PDF."}
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs">Section Indicator Key (Optional)</Label>
                    <Input
                      value={fieldDraft.sectionIndicatorKey || ""}
                      onChange={(e) =>
                        setFieldDraft((p) => ({
                          ...p,
                          sectionIndicatorKey: e.target.value,
                        }))
                      }
                      placeholder="e.g., 7-2. Inland Charges"
                    />
                    <div className="text-xs text-muted-foreground mt-1">
                      Defines what text to search for in the PDF to find that section. Example: 7-2. Inland Charges.
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">Data Type</Label>
                    <select
                      value={fieldDraft.dataType || "string"}
                      onChange={(e) =>
                        setFieldDraft((p) => {
                          const nextType = e.target.value as SchemaPresetField["dataType"];
                          return {
                            ...p,
                            dataType: nextType,
                            dateOffsetDays: nextType === "date" ? p.dateOffsetDays : "",
                            numberCalcMode: nextType === "number" ? p.numberCalcMode : "",
                            numberTransformOp: nextType === "number" ? p.numberTransformOp : "",
                            numberTransformValue: nextType === "number" ? p.numberTransformValue : "",
                            numberTransformField: nextType === "number" ? p.numberTransformField : "",
                            numberFormula: nextType === "number" ? p.numberFormula : "",
                          };
                        })
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

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">Extraction Strategy</Label>
                    <select
                      value={fieldDraft.extractionStrategy || "table_column"}
                      onChange={(e) => setFieldDraft((p) => ({ ...p, extractionStrategy: e.target.value as any }))}
                      className={SELECT_CLASS}
                    >
                      <option value="table_column">Table Column</option>
                      <option value="header_field">Header Field</option>
                      <option value="regex">Regex</option>
                    </select>
                  </div>
                  <div>
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

                <div>
                  <Label className="text-xs">Regex Rule (optional)</Label>
                  <Input
                    value={fieldDraft.regexRule || ""}
                    onChange={(e) => setFieldDraft((p) => ({ ...p, regexRule: e.target.value }))}
                    placeholder="Leave blank for table/header mapping or use Auto Regex"
                  />
                </div>

                {fieldDraft.dataType === "date" && (
                  <div>
                    <Label className="text-xs">Date Offset Days</Label>
                    <Input
                      type="number"
                      value={fieldDraft.dateOffsetDays || ""}
                      onChange={(e) => setFieldDraft((p) => ({ ...p, dateOffsetDays: e.target.value }))}
                      placeholder="e.g., 60 or -30"
                    />
                  </div>
                )}

                {fieldDraft.dataType === "number" && (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label className="text-xs">Calculation Mode</Label>
                        <select
                          value={fieldDraft.numberCalcMode || ""}
                          onChange={(e) =>
                            setFieldDraft((p) => ({
                              ...p,
                              numberCalcMode: e.target.value as NumberCalcMode,
                              numberTransformValue: "",
                              numberTransformField: "",
                              numberFormula: "",
                            }))
                          }
                          className={SELECT_CLASS}
                        >
                          <option value="">None</option>
                          <option value="value">Use Value</option>
                          <option value="field">Use Another Field</option>
                          <option value="formula">Use Formula</option>
                        </select>
                      </div>
                      <div>
                        <Label className="text-xs">Operation</Label>
                        <select
                          value={fieldDraft.numberTransformOp || ""}
                          onChange={(e) => setFieldDraft((p) => ({ ...p, numberTransformOp: e.target.value as NumberTransformOp }))}
                          className={SELECT_CLASS}
                          disabled={fieldDraft.numberCalcMode !== "value" && fieldDraft.numberCalcMode !== "field"}
                        >
                          <option value="">None</option>
                          <option value="add">Add</option>
                          <option value="sub">Subtract</option>
                          <option value="mul">Multiply</option>
                          <option value="div">Divide</option>
                        </select>
                      </div>
                    </div>

                    {fieldDraft.numberCalcMode === "value" && (
                      <div>
                        <Label className="text-xs">Calculation Value</Label>
                        <Input
                          value={fieldDraft.numberTransformValue || ""}
                          onChange={(e) => setFieldDraft((p) => ({ ...p, numberTransformValue: e.target.value }))}
                          placeholder="e.g., 1.1"
                        />
                      </div>
                    )}

                    {fieldDraft.numberCalcMode === "field" && (
                      <div>
                        <Label className="text-xs">Other Field Key</Label>
                        <select
                          value={fieldDraft.numberTransformField || ""}
                          onChange={(e) =>
                            setFieldDraft((p) => ({
                              ...p,
                              numberTransformField: e.target.value,
                            }))
                          }
                          className={SELECT_CLASS}
                        >
                          <option value="">Select a number field</option>
                          {numberFieldOptions.map((fieldKey) => (
                            <option key={fieldKey} value={fieldKey}>
                              {fieldKey}
                            </option>
                          ))}
                          {!!fieldDraft.numberTransformField && !numberFieldOptions.includes(fieldDraft.numberTransformField) && (
                            <option value={fieldDraft.numberTransformField}>{fieldDraft.numberTransformField}</option>
                          )}
                        </select>
                        {numberFieldOptions.length === 0 && (
                          <div className="text-xs text-muted-foreground mt-1">
                            Add at least one field with Data Type set to Number in this tab.
                          </div>
                        )}
                      </div>
                    )}

                    {fieldDraft.numberCalcMode === "formula" && (
                      <div>
                        <Label className="text-xs">Formula</Label>
                        <Input
                          value={fieldDraft.numberFormula || ""}
                          onChange={(e) => setFieldDraft((p) => ({ ...p, numberFormula: e.target.value }))}
                          placeholder="e.g., {{BaseRate 20}} * 1.1 + 25"
                        />
                        <div className="text-xs text-muted-foreground mt-1">
                          Use {"{{field key}}"} placeholders for other numeric fields.
                        </div>
                      </div>
                    )}
                  </div>
                )}

                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">
                    Minimal mode: label/key + section + type + strategy. Date/number transforms become post-processing rules.
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
                            (p.label || "").trim(),
                            p.sampleValue || "",
                          ),
                        }))
                      }
                    >
                      Auto Regex
                    </Button>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Button type="button" onClick={upsertField}>
                  {editingFieldIndex === null ? "Add Field" : "Update Field"}
                </Button>
                {editingFieldIndex !== null && (
                  <Button type="button" variant="outline" onClick={clearFieldDraft}>
                    Cancel Edit
                  </Button>
                )}
              </div>

              {activeTab ? (
                <div className="space-y-2">
                  {activeTab.fields.length === 0 ? (
                    <div className="rounded-md border p-3 text-sm text-muted-foreground">
                      No fields in this tab.
                    </div>
                  ) : (
                    activeTab.fields.map((field, idx) => (
                      <div
                        key={`${field.fieldKey}-${idx}`}
                        className="rounded-md border p-2 flex items-center justify-between gap-2"
                      >
                        <div className="min-w-0 text-sm">
                          <div className="font-medium truncate">{field.fieldKey}</div>
                          <div className="text-muted-foreground truncate text-xs">
                            Document Label: {field.label} | {field.dataType || "string"} | {field.regexRule || "(no regex)"}
                          </div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <Button type="button" size="sm" variant="outline" onClick={() => editField(idx)}>
                            Edit
                          </Button>
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
                    ))
                  )}
                </div>
              ) : (
                <div className="rounded-md border p-3 text-sm text-muted-foreground">
                  Add and select a tab first.
                </div>
              )}
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
                className="max-h-[240px] min-h-[180px] w-full overflow-auto rounded-md border bg-muted/40 p-3 text-xs font-mono"
              />
            </div>
          </div>
        </ScrollArea>

        {errors.length > 0 && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            {errors.join(" ")}
          </div>
        )}

        <DialogFooter>
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
