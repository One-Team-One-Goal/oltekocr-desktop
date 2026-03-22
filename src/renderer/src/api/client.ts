const BASE_URL = "http://localhost:3847/api";

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const url = `${BASE_URL}${path}`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string> | undefined),
  };

  if (options.body instanceof FormData) {
    delete headers["Content-Type"];
  }

  const res = await fetch(url, {
    headers,
    ...options,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || `HTTP ${res.status}: ${res.statusText}`);
  }

  // 204 No Content (e.g. DELETE) — return undefined without calling res.json()
  if (res.status === 204 || res.headers.get("content-length") === "0") {
    return undefined as T;
  }

  return res.json();
}

// ─── Documents ───────────────────────────────────────────
export const documentsApi = {
  list: (params?: Record<string, string>) => {
    const qs = params ? "?" + new URLSearchParams(params).toString() : "";
    return request<any[]>(`/documents${qs}`);
  },
  get: (id: string) => request<any>(`/documents/${id}`),
  stats: () => request<any>("/documents/stats"),
  loadFiles: (filePaths: string[]) =>
    request<any[]>("/documents/load", {
      method: "POST",
      body: JSON.stringify({ filePaths }),
    }),
  loadFolder: (folderPath: string) =>
    request<any[]>("/documents/load-folder", {
      method: "POST",
      body: JSON.stringify({ folderPath }),
    }),
  update: (id: string, data: any) =>
    request<any>(`/documents/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  approve: (id: string) =>
    request<any>(`/documents/${id}/approve`, { method: "PATCH" }),
  reject: (id: string, reason?: string) =>
    request<any>(`/documents/${id}/reject`, {
      method: "PATCH",
      body: JSON.stringify({ reason }),
    }),
  reprocess: (id: string) =>
    request<any>(`/documents/${id}/reprocess`, { method: "PATCH" }),
  delete: (id: string) =>
    request<any>(`/documents/${id}`, { method: "DELETE" }),
  batchUpdateExtractionType: (ids: string[], extractionType: string) =>
    Promise.all(
      ids.map((id) =>
        request<any>(`/documents/${id}`, {
          method: "PATCH",
          body: JSON.stringify({ extractionType }),
        }),
      ),
    ),
  imageUrl: (id: string) => `${BASE_URL}/documents/${id}/image`,
  thumbnailUrl: (id: string) => `${BASE_URL}/documents/${id}/thumbnail`,
};

// ─── Export ──────────────────────────────────────────────
export const exportApi = {
  exportDocuments: (documentIds: string[], format: string) =>
    request<{ exportPath: string }>("/export", {
      method: "POST",
      body: JSON.stringify({ documentIds, format }),
    }),
  exportAllApproved: (format: string) =>
    request<{ exportPath: string }>("/export/all-approved", {
      method: "POST",
      body: JSON.stringify({ format }),
    }),
  history: () => request<any[]>("/export/history"),
};

// ─── Settings ────────────────────────────────────────────
export const settingsApi = {
  get: () => request<any>("/settings"),
  getDefaults: () => request<any>("/settings/defaults"),
  update: (data: any) =>
    request<any>("/settings", {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
};

// ─── Scanner ─────────────────────────────────────────────
export const scannerApi = {
  list: () => request<any[]>("/scanner/list"),
  scan: () => request<any>("/scanner/scan", { method: "POST" }),
  startWatch: () => request<any>("/scanner/watch/start", { method: "POST" }),
  stopWatch: () => request<any>("/scanner/watch/stop", { method: "POST" }),
  watchStatus: () => request<any>("/scanner/watch/status"),
};

// ─── OCR ─────────────────────────────────────────────────
export const ocrApi = {
  status: () => request<any>("/ocr/status"),
  process: (id: string) =>
    request<any>(`/ocr/process/${id}`, { method: "POST" }),
};

// ─── Queue ───────────────────────────────────────────────
export const queueApi = {
  status: () => request<any>("/queue/status"),
  add: (documentIds: string[]) =>
    request<any>("/queue/add", {
      method: "POST",
      body: JSON.stringify({ documentIds }),
    }),
  pause: () => request<any>("/queue/pause", { method: "POST" }),
  resume: () => request<any>("/queue/resume", { method: "POST" }),
  clear: () => request<any>("/queue", { method: "DELETE" }),
  cancel: (documentIds: string[]) =>
    request<any>("/queue/cancel", {
      method: "POST",
      body: JSON.stringify({ documentIds }),
    }),
};

// ─── Auto Schemas ───────────────────────────────────────
export interface AutoSchemaRecord {
  id: string;
  name: string;
  documentId: string;
  uploadedFileName: string;
  rawJson: Record<string, unknown>;
  llmJson: Record<string, unknown>;
  schemaJson: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  source?: string;
  isAutoSchema?: boolean;
}

export interface AutoSchemaSectionNode {
  id: string;
  token: string;
  title: string;
  level: number;
  confidence: number;
  lineNumber: number;
  pageStart: number | null;
  pageEnd: number | null;
  windowPages: number[];
  children: AutoSchemaSectionNode[];
}

export interface AutoSchemaLlmParsed {
  documentId: string;
  company: string;
  extractionMode?: "AUTO" | "CONTRACT_BIASED" | "GENERIC";
  recordStartRegex?: string;
  extractionTasks?: Array<{
    id: string;
    sectionId?: string;
    sectionLabel: string;
    objective: string;
    fields: Array<{
      id: string;
      label: string;
      fieldKey: string;
      regexRule: string;
      extractionStrategy:
        | "regex"
        | "table_column"
        | "header_field"
        | "page_region";
      dataType: "string" | "currency" | "number" | "date" | "percentage";
      sectionHint?: string;
      contextHint?:
        | "same_line_after_label"
        | "next_line_after_label"
        | "table_cell";
      contextLabel?: string;
      mandatory?: boolean;
      postProcessing?: string[];
    }>;
  }>;
  sections: Array<{
    id: string;
    label: string;
    fields: Array<{
      id: string;
      label: string;
      fieldKey: string;
      regexRule: string;
      extractionStrategy:
        | "regex"
        | "table_column"
        | "header_field"
        | "page_region";
      dataType: "string" | "currency" | "number" | "date" | "percentage";
      sectionHint?: string;
      contextHint?:
        | "same_line_after_label"
        | "next_line_after_label"
        | "table_cell";
      contextLabel?: string;
      mandatory?: boolean;
      postProcessing?: string[];
    }>;
  }>;
  tables: Array<{
    id: string;
    label: string;
    columns: Array<{
      id: string;
      label: string;
      fieldKey: string;
      regexRule: string;
      extractionStrategy:
        | "regex"
        | "table_column"
        | "header_field"
        | "page_region";
      dataType: "string" | "currency" | "number" | "date" | "percentage";
      sectionHint?: string;
      contextHint?:
        | "same_line_after_label"
        | "next_line_after_label"
        | "table_cell";
      contextLabel?: string;
      mandatory?: boolean;
      postProcessing?: string[];
    }>;
  }>;
  tabs: Array<{
    name: string;
    fields: Array<{
      id: string;
      label: string;
      fieldKey: string;
      regexRule: string;
      extractionStrategy:
        | "regex"
        | "table_column"
        | "header_field"
        | "page_region";
      dataType: "string" | "currency" | "number" | "date" | "percentage";
      sectionHint?: string;
      contextHint?:
        | "same_line_after_label"
        | "next_line_after_label"
        | "table_cell";
      contextLabel?: string;
      mandatory?: boolean;
      postProcessing?: string[];
    }>;
  }>;
}

export interface AutoSchemaSectionDraftResponse {
  autoSchemaId: string;
  documentId: string;
  uploadedFileName: string;
  section: {
    id: string;
    token: string;
    title: string;
    pageStart: number | null;
    pageEnd: number | null;
  };
  focusedPages: number[];
  focusContext?: {
    strategy: string;
    selectedSections: string[];
    focusedPages: number[];
    focusedLines: number[];
    fullTextChars: number;
    preview: string;
    contextText: string;
    contextTextTruncated: boolean;
  };
  llmJson: Record<string, unknown>;
  parsed: AutoSchemaLlmParsed;
}

export const autoSchemasApi = {
  list: () => request<AutoSchemaRecord[]>("/auto-schemas"),
  get: (id: string) => request<AutoSchemaRecord>(`/auto-schemas/${id}`),
  create: (data: {
    name: string;
    documentId: string;
    uploadedFileName: string;
    rawJson: Record<string, unknown>;
    llmJson?: Record<string, unknown>;
    schemaJson?: Record<string, unknown>;
  }) =>
    request<AutoSchemaRecord>("/auto-schemas", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  generateLlm: (
    id: string,
    data?: {
      model?: string;
      baseUrl?: string;
      selectedSections?: string[];
      sectionWindowPages?: number;
    },
  ) =>
    request<{
      autoSchemaId: string;
      documentId: string;
      uploadedFileName: string;
      llmJson: Record<string, unknown>;
      parsed: AutoSchemaLlmParsed;
      focusedPages?: number[];
      focusedSectionCount?: number;
      focusContext?: {
        strategy: string;
        selectedSections: string[];
        focusedPages: number[];
        focusedLines: number[];
        fullTextChars: number;
        preview: string;
        contextText: string;
        contextTextTruncated: boolean;
      };
    }>(`/auto-schemas/${id}/llm-extract`, {
      method: "POST",
      body: JSON.stringify(data || {}),
    }),
  detectSections: (
    id: string,
    data?: { minConfidence?: number; maxNodes?: number },
  ) =>
    request<{
      autoSchemaId: string;
      documentId: string;
      uploadedFileName: string;
      textLength: number;
      sections: AutoSchemaSectionNode[];
    }>(`/auto-schemas/${id}/sections`, {
      method: "POST",
      body: JSON.stringify(data || {}),
    }),
  generateSectionDraft: (
    id: string,
    data: {
      sectionId: string;
      sectionWindowPages?: number;
      model?: string;
      baseUrl?: string;
    },
  ) =>
    request<AutoSchemaSectionDraftResponse>(
      `/auto-schemas/${id}/section-draft`,
      {
        method: "POST",
        body: JSON.stringify(data),
      },
    ),
};

// ─── Sessions ────────────────────────────────────────────
export interface SessionSchemaFieldPayload {
  label: string;
  fieldKey: string;
  usualValue: string;
  regexRule: string;
}

export interface SchemaPresetFieldPayload {
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

export interface SchemaPresetTabPayload {
  name: string;
  fields: SchemaPresetFieldPayload[];
}

export interface SchemaPresetPayload {
  id: string;
  name: string;
  extractionMode?: "AUTO" | "CONTRACT_BIASED" | "GENERIC";
  recordStartRegex?: string;
  tabs: SchemaPresetTabPayload[];
}

export const sessionsApi = {
  list: () => request<any[]>("/sessions"),
  get: (id: string) => request<any>(`/sessions/${id}`),
  create: (data: {
    name: string;
    mode: "OCR_EXTRACT" | "TABLE_EXTRACT" | "PDF_EXTRACT" | "JSON_EXTRACT";
    columns?: { key: string; label: string; question: string }[];
    sourceType: "FILES" | "FOLDER";
    sourcePath?: string;
    documentType?: string;
  }) =>
    request<any>("/sessions", { method: "POST", body: JSON.stringify(data) }),
  remove: (id: string) =>
    request<void>(`/sessions/${id}`, { method: "DELETE" }),
  rename: (id: string, name: string) =>
    request<any>(`/sessions/${id}/rename`, {
      method: "PATCH",
      body: JSON.stringify({ name }),
    }),
  updateColumns: (
    id: string,
    columns: { key: string; label: string; question: string }[],
  ) =>
    request<any>(`/sessions/${id}/columns`, {
      method: "PATCH",
      body: JSON.stringify({ columns }),
    }),
  ingestFiles: (id: string, filePaths: string[]) =>
    request<any[]>(`/sessions/${id}/ingest/files`, {
      method: "POST",
      body: JSON.stringify({ filePaths }),
    }),
  ingestFolder: (id: string, folderPath: string) =>
    request<any[]>(`/sessions/${id}/ingest/folder`, {
      method: "POST",
      body: JSON.stringify({ folderPath }),
    }),
  getDocuments: (id: string) => request<any[]>(`/sessions/${id}/documents`),
  getStats: (id: string) => request<any>(`/sessions/${id}/stats`),
  updateExtractionModel: (id: string, extractionModel: string) =>
    request<any>(`/sessions/${id}/extraction-model`, {
      method: "PATCH",
      body: JSON.stringify({ extractionModel }),
    }),
  getSchemaFields: (id: string) =>
    request<SessionSchemaFieldPayload[]>(`/sessions/${id}/schema-fields`),
  updateSchemaFields: (id: string, fields: SessionSchemaFieldPayload[]) =>
    request<SessionSchemaFieldPayload[]>(`/sessions/${id}/schema-fields`, {
      method: "PATCH",
      body: JSON.stringify({ fields }),
    }),
  listSchemaPresets: () =>
    request<
      Array<{
        id: string;
        name: string;
        extractionMode?: "AUTO" | "CONTRACT_BIASED" | "GENERIC";
        recordStartRegex?: string;
      }>
    >(`/sessions/schema-presets`),
  getSchemaPreset: (presetId: string) =>
    request<SchemaPresetPayload>(`/sessions/schema-presets/${presetId}`),
  createSchemaPreset: (data: {
    name: string;
    extractionMode?: "AUTO" | "CONTRACT_BIASED" | "GENERIC";
    recordStartRegex?: string;
    tabs: SchemaPresetTabPayload[];
  }) =>
    request<SchemaPresetPayload>(`/sessions/schema-presets`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  updateSchemaPreset: (
    presetId: string,
    data: {
      name: string;
      extractionMode?: "AUTO" | "CONTRACT_BIASED" | "GENERIC";
      recordStartRegex?: string;
      tabs: SchemaPresetTabPayload[];
    },
  ) =>
    request<SchemaPresetPayload>(`/sessions/schema-presets/${presetId}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  deleteSchemaPreset: (presetId: string) =>
    request<void>(`/sessions/schema-presets/${presetId}`, { method: "DELETE" }),
  getSessionSchemaPreset: (id: string) =>
    request<{
      schemaPresetId: string | null;
      preset: SchemaPresetPayload | null;
    }>(`/sessions/${id}/schema-preset`),
  assignSessionSchemaPreset: (id: string, schemaPresetId?: string | null) =>
    request<{
      schemaPresetId: string | null;
      preset: SchemaPresetPayload | null;
    }>(`/sessions/${id}/schema-preset`, {
      method: "PATCH",
      body: JSON.stringify({ schemaPresetId: schemaPresetId ?? null }),
    }),
  duplicate: (
    id: string,
    data: { strategy: "FULL" | "COLUMNS_ONLY"; name?: string },
  ) =>
    request<any>(`/sessions/${id}/duplicate`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
};

// ─── Session Presets ────────────────────────────────────
export const sessionPresetsApi = {
  list: () => request<any[]>("/session-presets"),
  get: (id: string) => request<any>(`/session-presets/${id}`),
  create: (data: {
    name: string;
    mode: "OCR_EXTRACT" | "TABLE_EXTRACT";
    columns?: { key: string; label: string; question: string }[];
  }) =>
    request<any>("/session-presets", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  update: (
    id: string,
    data: {
      name?: string;
      mode?: "OCR_EXTRACT" | "TABLE_EXTRACT";
      columns?: { key: string; label: string; question: string }[];
    },
  ) =>
    request<any>(`/session-presets/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  remove: (id: string) =>
    request<void>(`/session-presets/${id}`, { method: "DELETE" }),
};

// ─── Models ──────────────────────────────────────────────
export interface ModelStatus {
  id: string;
  name: string;
  description: string;
  recommended: boolean;
  downloaded: boolean;
  size: string;
}

export interface LlmModelStatus {
  id: string;
  name: string;
  description: string;
  recommended: boolean;
  downloaded: boolean;
  size: string;
}

export interface LlmRecommendation {
  recommendedId: string;
  ramGb: number;
  logicalCores: number;
  reason: string;
}

export interface LlmInstallProgress {
  modelId: string;
  active: boolean;
  percent: number | null;
  downloadedMb: number | null;
  totalMb: number | null;
  speedMbps: number | null;
  eta: string | null;
  lastLine: string | null;
}

export const modelsApi = {
  list: () => request<ModelStatus[]>("/models"),
  install: (id: string) =>
    request<{ ok: boolean; log: string }>(`/models/${id}/install`, {
      method: "POST",
    }),
  cancelInstall: (id: string) =>
    request<{ ok: boolean; log: string }>(`/models/${id}/install/cancel`, {
      method: "POST",
    }),
  uninstall: (id: string) =>
    request<{ ok: boolean; log: string }>(`/models/${id}`, {
      method: "DELETE",
    }),
  listLlm: () => request<LlmModelStatus[]>("/models/llm"),
  llmRecommendation: () =>
    request<LlmRecommendation>("/models/llm/recommendation"),
  installLlm: (id: string) =>
    request<{ ok: boolean; log: string }>(
      `/models/llm/${encodeURIComponent(id)}/install`,
      {
        method: "POST",
      },
    ),
  installLlmProgress: (id: string) =>
    request<LlmInstallProgress>(
      `/models/llm/${encodeURIComponent(id)}/install/progress`,
    ),
  cancelInstallLlm: (id: string) =>
    request<{ ok: boolean; log: string }>(
      `/models/llm/${encodeURIComponent(id)}/install/cancel`,
      {
        method: "POST",
      },
    ),
  uninstallLlm: (id: string) =>
    request<{ ok: boolean; log: string }>(
      `/models/llm/${encodeURIComponent(id)}`,
      {
        method: "DELETE",
      },
    ),
};

// ─── Swagger ─────────────────────────────────────────────
export const SWAGGER_URL = `${BASE_URL}/docs`;
