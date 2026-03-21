// ─── Session ─────────────────────────────────────────────
export const SessionMode = {
  OCR_EXTRACT: "OCR_EXTRACT",
  TABLE_EXTRACT: "TABLE_EXTRACT",
  PDF_EXTRACT: "PDF_EXTRACT",
  JSON_EXTRACT: "JSON_EXTRACT",
} as const;
export type SessionMode = (typeof SessionMode)[keyof typeof SessionMode];

export const SessionStatus = {
  PENDING: "PENDING",
  PROCESSING: "PROCESSING",
  DONE: "DONE",
  ERROR: "ERROR",
} as const;
export type SessionStatus = (typeof SessionStatus)[keyof typeof SessionStatus];

/** One user-defined field to extract in TABLE_EXTRACT mode */
export interface SessionColumn {
  key: string; // e.g. "company_name"
  label: string; // e.g. "Company Name"
  question: string; // QA question fed to the local extraction model e.g. "What is the company name?"
}

export interface SessionRecord {
  id: string;
  name: string;
  mode: SessionMode;
  columns: SessionColumn[];
  sourceType: "FILES" | "FOLDER";
  sourcePath: string;
  documentType: string;
  status: SessionStatus;
  extractionModel: string;
  createdAt: string;
  updatedAt: string;
}

export interface SessionListItem {
  id: string;
  name: string;
  mode: SessionMode;
  status: SessionStatus;
  extractionModel: string;
  documentCount: number;
  processedCount: number;
  createdAt: string;
}

export interface SessionPresetRecord {
  id: string;
  name: string;
  mode: SessionMode;
  columns: SessionColumn[];
  createdAt: string;
  updatedAt: string;
}

export type DuplicateSessionStrategy = "FULL" | "COLUMNS_ONLY";

export interface DuplicateSessionResult {
  session: SessionRecord;
  documents: DocumentListItem[];
}

// ─── Extraction Type ────────────────────────────────────
export const ExtractionType = {
  AUTO: "AUTO", // auto-detect at processing time
  IMAGE: "IMAGE", // standalone image file (jpg, png, tiff…)
  PDF_TEXT: "PDF_TEXT", // digital PDF with selectable text
  PDF_IMAGE: "PDF_IMAGE", // scanned PDF — pages are rasterised images
  EXCEL: "EXCEL", // spreadsheet
} as const;
export type ExtractionType =
  (typeof ExtractionType)[keyof typeof ExtractionType];

// ─── Document Status ─────────────────────────────────────
export const DocumentStatus = {
  QUEUED: "QUEUED",
  SCANNING: "SCANNING",
  PROCESSING: "PROCESSING",
  CANCELLING: "CANCELLING",
  REVIEW: "REVIEW",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
  EXPORTED: "EXPORTED",
  ERROR: "ERROR",
} as const;

export type DocumentStatus =
  (typeof DocumentStatus)[keyof typeof DocumentStatus];

// ─── Quality Check ───────────────────────────────────────
export interface QualityCheck {
  valid: boolean;
  dpi: number;
  width: number;
  height: number;
  blurScore: number;
  isBlurry: boolean;
  isSkewed: boolean;
  skewAngle: number;
  issues: string[];
}

// ─── OCR Types ───────────────────────────────────────────
export interface TextBlock {
  text: string;
  confidence?: number;
  blockType: "paragraph" | "heading" | "list" | "footer" | "header";
  bbox?: [number, number, number, number]; // x1, y1, x2, y2
  page: number;
}

export interface TableCell {
  row: number;
  col: number;
  text: string;
  confidence?: number;
  rowSpan?: number;
  colSpan?: number;
}

export interface ExtractedTable {
  tableId: string;
  rows: number;
  cols: number;
  cells: TableCell[];
  caption?: string;
  bbox?: [number, number, number, number];
}

export interface OcrResult {
  fullText: string;
  markdown: string;
  textBlocks: TextBlock[];
  tables: ExtractedTable[];
  avgConfidence: number;
  processingTime: number;
  pageCount: number;
  warnings: string[];
}

// ─── Document ────────────────────────────────────────────
export interface DocumentRecord {
  id: string;
  filename: string;
  imagePath: string;
  thumbnailPath: string;
  status: DocumentStatus;
  createdAt: string;
  updatedAt: string;
  processedAt: string | null;
  verifiedAt: string | null;
  verifiedBy: string;
  notes: string;
  tags: string[];
  exported: boolean;
  exportPath: string;
  extractionType: ExtractionType;
  quality: QualityCheck;
  ocrResult: OcrResult | null;
  userEdits: Record<string, unknown>;
  extractedJson: Record<string, unknown>;
}

// ─── Document List Item (lightweight) ────────────────────
export interface DocumentListItem {
  id: string;
  filename: string;
  status: DocumentStatus;
  createdAt: string;
  ocrAvgConfidence: number;
  ocrProcessingTime: number;
  ocrPageCount: number;
  ocrTableCount: number;
  notes: string;
  qualityValid: boolean;
  qualityIssueCount: number;
  sessionId: string | null;
  extractionType: ExtractionType;
  /** Populated for TABLE_EXTRACT sessions after OCR — key=column.key, value={ answer, score } */
  extractedRow: Record<string, { answer: string; score: number }> | null;
}

// ─── Stats ───────────────────────────────────────────────
export interface DashboardStats {
  total: number;
  queued: number;
  processing: number;
  review: number;
  approved: number;
  rejected: number;
  exported: number;
  error: number;
  avgConfidence: number;
}

// ─── Export ──────────────────────────────────────────────
export type ExportFormat = "excel" | "json" | "csv";

export interface ExportRequest {
  documentIds: string[];
  format: ExportFormat;
}

export interface ExportHistoryRecord {
  id: number;
  documentId: string;
  exportFormat: string;
  exportPath: string;
  exportedAt: string;
}

// ─── Settings ────────────────────────────────────────────
export interface AppSettings {
  app: {
    name: string;
    version: string;
    theme: "dark" | "light";
  };
  scanner: {
    mode: "wia" | "folder";
    dpi: number;
    colorMode: "grayscale" | "color" | "bw";
    autoCrop: boolean;
    watchFolder: string;
    supportedFormats: string[];
  };
  ocr: {
    language: string;
    confidenceThreshold: number;
    extractTables: boolean;
    timeout: number;
    autoEnhance: boolean;
    autoDeskew: boolean;
    minDpi: number;
    blurThreshold: number;
    /** Absolute path to the Python executable that has rapidocr installed */
    pythonPath: string;
  };
  storage: {
    databasePath: string;
    scansFolder: string;
    exportsFolder: string;
    maxStorageGb: number;
  };
  export: {
    defaultFormat: ExportFormat;
    includeImages: boolean;
    dateFormat: string;
  };
  llm: {
    provider: "groq" | "openrouter";
    defaultModel: string;
    temperature: number;
  };
}

// ─── WebSocket Events ────────────────────────────────────
export interface WsQueueUpdate {
  event: "queue:update";
  data: { size: number; processing: string | null };
}

export interface WsDocumentStatus {
  event: "document:status";
  data: { id: string; status: DocumentStatus; updatedAt: string };
}

export interface WsProcessingProgress {
  event: "processing:progress";
  data: { id: string; progress: number; message: string };
}

export interface WsProcessingLog {
  event: "processing:log";
  data: { id: string; line: string; timestamp: string };
}

export type WsEvent =
  | WsQueueUpdate
  | WsDocumentStatus
  | WsProcessingProgress
  | WsProcessingLog;

// ─── IPC Channels ────────────────────────────────────────
export const IpcChannel = {
  OPEN_FILE_DIALOG: "dialog:open-file",
  OPEN_FOLDER_DIALOG: "dialog:open-folder",
  SAVE_FILE_DIALOG: "dialog:save-file",
  COPY_FILE: "fs:copy-file",
  GET_APP_PATH: "app:get-path",
  SHOW_ITEM_IN_FOLDER: "shell:show-item",
  WINDOW_CLOSE: "window:close",
  WINDOW_MINIMIZE: "window:minimize",
  WINDOW_MAXIMIZE: "window:maximize",
} as const;
