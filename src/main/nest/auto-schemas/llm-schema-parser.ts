type AnyRecord = Record<string, unknown>;

export interface ParsedLlmSchemaField {
  id: string;
  label: string;
  fieldKey: string;
  regexRule: string;
  extractionStrategy: "regex" | "table_column" | "header_field" | "page_region";
  dataType: "string" | "currency" | "number" | "date" | "percentage";
  sectionHint?: string;
  contextHint?: "same_line_after_label" | "next_line_after_label" | "table_cell";
  contextLabel?: string;
  mandatory?: boolean;
  postProcessing?: string[];
}

export interface ParsedLlmSchemaTab {
  name: string;
  fields: ParsedLlmSchemaField[];
}

export interface ParsedLlmSchemaSection {
  id: string;
  label: string;
  fields: ParsedLlmSchemaField[];
}

export interface ParsedLlmSchemaTable {
  id: string;
  label: string;
  columns: ParsedLlmSchemaField[];
}

export interface ParsedLlmSchema {
  documentId: string;
  company: string;
  extractionMode: "AUTO" | "CONTRACT_BIASED" | "GENERIC";
  recordStartRegex: string;
  sections: ParsedLlmSchemaSection[];
  tables: ParsedLlmSchemaTable[];
  tabs: ParsedLlmSchemaTab[];
}

const toFieldKey = (value: string, fallback: string) => {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || fallback;
};

const asArray = (value: unknown): AnyRecord[] =>
  Array.isArray(value)
    ? (value.filter((v) => !!v && typeof v === "object") as AnyRecord[])
    : [];

const toScalarString = (value: unknown): string => {
  if (Array.isArray(value)) {
    const first = value.find((v) => typeof v === "string" && v.trim().length > 0);
    return typeof first === "string" ? first : "";
  }
  return typeof value === "string" ? value : String(value || "");
};

const normalizeDataType = (value: unknown): ParsedLlmSchemaField["dataType"] => {
  const v = String(value || "").toLowerCase();
  if (v === "currency" || v === "number" || v === "date" || v === "percentage") {
    return v;
  }
  return "string";
};

const normalizeExtractionStrategy = (
  value: unknown,
  fallback: ParsedLlmSchemaField["extractionStrategy"],
): ParsedLlmSchemaField["extractionStrategy"] => {
  const v = String(value || "").toLowerCase();
  if (v === "regex" || v === "table_column" || v === "header_field" || v === "page_region") {
    return v;
  }
  if (v === "first_line") return "header_field";
  return fallback;
};

const normalizeContextHint = (value: unknown): ParsedLlmSchemaField["contextHint"] => {
  const v = String(value || "").toLowerCase();
  if (v === "same_line_after_label" || v === "next_line_after_label" || v === "table_cell") {
    return v;
  }
  return undefined;
};

const normalizePostProcessing = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const items = value.map((v) => String(v || "").trim()).filter((v) => !!v);
  return items.length > 0 ? items : undefined;
};

const parseField = (
  rawField: AnyRecord,
  fallbackId: string,
  fallbackLabel: string,
  fallbackStrategy: ParsedLlmSchemaField["extractionStrategy"],
): ParsedLlmSchemaField => {
  const id = String(rawField.id || fallbackId);
  const label = String(rawField.label || fallbackLabel);
  const rule =
    rawField.rule && typeof rawField.rule === "object"
      ? (rawField.rule as AnyRecord)
      : {};
  const ruleType = String(rule.type || "").toLowerCase();

  const explicitRegex = String(rawField.regex_rule || rawField.regexRule || "");
  const regexRule = explicitRegex || (ruleType === "regex" ? String(rule.pattern || "") : "");

  return {
    id,
    label,
    fieldKey: toFieldKey(
      String(rawField.field_key || rawField.fieldKey || rawField.id || label),
      fallbackId,
    ),
    regexRule,
    extractionStrategy: normalizeExtractionStrategy(
      rawField.extraction_strategy || rawField.extractionStrategy || ruleType,
      fallbackStrategy,
    ),
    dataType: normalizeDataType(rawField.data_type || rawField.dataType),
    sectionHint: rawField.section_hint
      ? String(rawField.section_hint)
      : rawField.sectionHint
        ? String(rawField.sectionHint)
        : undefined,
    contextHint: normalizeContextHint(rawField.context_hint || rawField.contextHint),
    contextLabel:
      rawField.context_label !== undefined
        ? String(rawField.context_label || "")
        : rawField.contextLabel !== undefined
          ? String(rawField.contextLabel || "")
          : undefined,
    mandatory: typeof rawField.mandatory === "boolean" ? rawField.mandatory : undefined,
    postProcessing: normalizePostProcessing(rawField.post_processing || rawField.postProcessing),
  };
};

export function parseLlmSchemaOutput(input: unknown): ParsedLlmSchema {
  const root = (input && typeof input === "object" ? (input as AnyRecord) : {}) as AnyRecord;

  const sectionNodes = asArray(root.sections);
  const tableNodes = asArray(root.tables);

  const sections: ParsedLlmSchemaSection[] = sectionNodes.map((section, sectionIdx) => {
    const sectionId = String(section.id || `section_${sectionIdx + 1}`);
    const sectionLabel = String(section.label || `Section ${sectionIdx + 1}`);
    const fields = asArray(section.fields)
      .filter((field) => field.is_active !== false)
      .map((field, fieldIdx) =>
        parseField(
          field,
          `${sectionId}_field_${fieldIdx + 1}`,
          `Field ${fieldIdx + 1}`,
          "regex",
        ),
      );

    return {
      id: sectionId,
      label: sectionLabel,
      fields,
    };
  });

  const tables: ParsedLlmSchemaTable[] = tableNodes
    .filter((table) => table.is_active !== false)
    .map((table, tableIdx) => {
      const tableId = String(table.id || `table_${tableIdx + 1}`);
      const tableLabel = String(table.label || `Table ${tableIdx + 1}`);
      const sourceColumns =
        asArray(table.column_definitions).length > 0
          ? asArray(table.column_definitions)
          : asArray(table.columns);
      const columns = sourceColumns
        .filter((column) => column.is_active !== false)
        .map((column, colIdx) =>
          parseField(
            column,
            `${tableId}_col_${colIdx + 1}`,
            `Column ${colIdx + 1}`,
            "table_column",
          ),
        );

      return {
        id: tableId,
        label: tableLabel,
        columns,
      };
    });

  const explicitTabs = asArray(root.tabs)
    .map((tab, tabIdx) => {
      const tabName = String(tab.name || `Tab ${tabIdx + 1}`);
      const tabFields = asArray(tab.fields)
        .filter((field) => field.is_active !== false)
        .map((field, fieldIdx) =>
          parseField(
            field,
            `tab_${tabIdx + 1}_field_${fieldIdx + 1}`,
            `Field ${fieldIdx + 1}`,
            "regex",
          ),
        );
      return { name: tabName, fields: tabFields };
    })
    .filter((tab) => tab.fields.length > 0);

  const tabs: ParsedLlmSchemaTab[] =
    explicitTabs.length > 0
      ? explicitTabs
      : [
          ...sections.map((section) => ({
            name: section.label,
            fields: section.fields,
          })),
          ...tables.map((table) => ({
            name: table.label,
            fields: table.columns,
          })),
        ].filter((tab) => tab.fields.length > 0);

  return {
    documentId: toScalarString(root.document_id),
    company: toScalarString(root.company),
    extractionMode:
      String(root.extraction_mode || "").toUpperCase() === "CONTRACT_BIASED"
        ? "CONTRACT_BIASED"
        : String(root.extraction_mode || "").toUpperCase() === "GENERIC"
          ? "GENERIC"
          : "AUTO",
    recordStartRegex: String(root.record_start_regex || ""),
    sections,
    tables,
    tabs,
  };
}
