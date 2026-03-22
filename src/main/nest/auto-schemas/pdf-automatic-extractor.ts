type AnyRecord = Record<string, unknown>;

export interface ParsedExtractorField {
  id: string;
  label: string;
  fieldKey: string;
  regexRule: string;
  extractionStrategy: "regex" | "table_column" | "header_field" | "page_region";
  dataType: "string";
}

export interface ParsedExtractorTab {
  name: string;
  fields: ParsedExtractorField[];
}

export interface ParsedSection {
  id: string;
  label: string;
  fields: ParsedExtractorField[];
}

export interface ParsedTable {
  id: string;
  label: string;
  columns: ParsedExtractorField[];
}

export interface ParsedPdfAutomaticExtractor {
  documentId: string;
  company: string;
  sections: ParsedSection[];
  tables: ParsedTable[];
  tabs: ParsedExtractorTab[];
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
  Array.isArray(value) ? (value.filter((v) => !!v && typeof v === "object") as AnyRecord[]) : [];

export function parsePdfAutomaticExtractorOutput(input: unknown): ParsedPdfAutomaticExtractor {
  const root = (input && typeof input === "object" ? (input as AnyRecord) : {}) as AnyRecord;

  const sectionNodes = asArray(root.sections);
  const tableNodes = asArray(root.tables);

  const sections: ParsedSection[] = sectionNodes.map((section, sectionIdx) => {
    const sectionId = String(section.id || `section_${sectionIdx + 1}`);
    const sectionLabel = String(section.label || `Section ${sectionIdx + 1}`);
    const fields = asArray(section.fields)
      .filter((field) => field.is_active !== false)
      .map((field, fieldIdx) => {
        const id = String(field.id || `${sectionId}_field_${fieldIdx + 1}`);
        const label = String(field.label || `Field ${fieldIdx + 1}`);
        const rule = field.rule && typeof field.rule === "object" ? (field.rule as AnyRecord) : {};
        const ruleType = String(rule.type || "").toLowerCase();
        const regexRule = ruleType === "regex" ? String(rule.pattern || "") : "";

        return {
          id,
          label,
          fieldKey: toFieldKey(String(field.id || label), `field_${sectionIdx + 1}_${fieldIdx + 1}`),
          regexRule,
          extractionStrategy: (ruleType === "first_line" ? "header_field" : "regex") as
            | "regex"
            | "header_field",
          dataType: "string" as const,
        };
      });

    return {
      id: sectionId,
      label: sectionLabel,
      fields,
    };
  });

  const tables: ParsedTable[] = tableNodes
    .filter((table) => table.is_active !== false)
    .map((table, tableIdx) => {
      const tableId = String(table.id || `table_${tableIdx + 1}`);
      const tableLabel = String(table.label || `Table ${tableIdx + 1}`);
      const columns = asArray(table.column_definitions).map((column, colIdx) => {
        const id = String(column.id || `${tableId}_col_${colIdx + 1}`);
        const label = String(column.label || `Column ${colIdx + 1}`);

        return {
          id,
          label,
          fieldKey: toFieldKey(String(column.id || label), `col_${tableIdx + 1}_${colIdx + 1}`),
          regexRule: "",
          extractionStrategy: "table_column" as const,
          dataType: "string" as const,
        };
      });

      return {
        id: tableId,
        label: tableLabel,
        columns,
      };
    });

  const tabs: ParsedExtractorTab[] = [
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
    documentId: String(root.document_id || ""),
    company: String(root.company || ""),
    sections,
    tables,
    tabs,
  };
}
