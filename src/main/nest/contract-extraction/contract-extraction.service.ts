import { Injectable, Logger } from "@nestjs/common";
import { spawn } from "child_process";
import { join } from "path";
import { existsSync } from "fs";
import { PrismaService } from "../prisma/prisma.service";
import { SettingsService } from "../settings/settings.service";
import { DocumentsService } from "../documents/documents.service";

export interface ContractHeader {
  carrier: string;
  contractId: string;
  effectiveDate: string;
  expirationDate: string;
}

export interface ContractExtractionResult {
  header: ContractHeader;
  rates: Record<string, string>[];
  originArbs: Record<string, string>[];
  destArbs: Record<string, string>[];
  tabs?: Array<{ name: string; rows: Record<string, string>[] }>;
  schemaName?: string;
  rawPages: { page: number; text: string }[];
  pageCount: number;
  processingTime: number;
  warnings: string[];
}

interface SessionSchemaFieldRule {
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

interface SessionSchemaTabRule {
  name: string;
  fields: SessionSchemaFieldRule[];
}

interface SessionSchemaPresetRule {
  id: string;
  name: string;
  extractionMode?: "AUTO" | "CONTRACT_BIASED" | "GENERIC";
  recordStartRegex?: string;
  tabs: SessionSchemaTabRule[];
}

@Injectable()
export class ContractExtractionService {
  private readonly logger = new Logger(ContractExtractionService.name);

  private parseProgressLine(
    line: string,
  ): { progress: number; message: string } | null {
    const trimmed = line.trim();
    if (!trimmed) return null;
    const match = trimmed.match(/^\[progress\]\s*(.*)$/i);
    if (!match) return null;

    const payload = match[1].trim();
    const pctMatch = payload.match(/^([0-9]{1,3})(?:\.[0-9]+)?\s*%\s*(.*)$/);
    if (pctMatch) {
      const pct = Math.max(0, Math.min(100, Number(pctMatch[1])));
      const msg = (pctMatch[2] || "Processing...").trim() || "Processing...";
      return { progress: pct, message: msg };
    }

    return { progress: 0, message: payload || "Processing..." };
  }

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly documentsService: DocumentsService,
  ) {}

  private get legacyScriptPath(): string {
    return join(
      process.cwd(),
      "src",
      "main",
      "python",
      "pdf_contract_extract.py",
    );
  }

  private get dynamicScriptPath(): string {
    return join(
      process.cwd(),
      "src",
      "main",
      "python",
      "pdf_contract_extract_dynamic.py",
    );
  }

  private resolvePythonExe(): string {
    const cfg = this.settings.getAll().ocr;
    const configured = cfg.pythonPath || "python";

    if (configured && configured !== "python" && configured !== "python3") {
      return configured;
    }

    const root = process.cwd();
    const candidates = [
      join(root, ".venv", "Scripts", "python.exe"),
      join(root, ".venv", "bin", "python"),
    ];
    for (const candidate of candidates) {
      if (existsSync(candidate)) {
        return candidate;
      }
    }

    return configured;
  }

  async process(
    documentId: string,
    onProgress?: (progress: number, message: string) => void,
  ): Promise<ContractExtractionResult> {
    const doc = await this.prisma.document.findUnique({
      where: { id: documentId },
    });

    if (!doc) {
      this.logger.warn(`Document ${documentId} no longer exists — skipping`);
      return this.emptyResult();
    }

    const detectedType = this.documentsService.detectExtractionType(
      doc.imagePath,
    );
    await this.prisma.document.updateMany({
      where: { id: documentId },
      data: { extractionType: detectedType },
    });

    if (detectedType === "UNKNOWN") {
      const msg =
        "PDF content analysis is UNKNOWN. This file was not auto-processed. Please set extraction type manually (PDF_TEXT or PDF_IMAGE) and reprocess.";
      await this.prisma.document.updateMany({
        where: { id: documentId },
        data: {
          status: "ERROR",
          ocrWarnings: JSON.stringify([msg]),
        },
      });
      throw new Error(msg);
    }

    if (detectedType === "IMAGE" || detectedType === "EXCEL") {
      const msg = `Unsupported extraction type for PDF_EXTRACT: ${detectedType}`;
      await this.prisma.document.updateMany({
        where: { id: documentId },
        data: {
          status: "ERROR",
          ocrWarnings: JSON.stringify([msg]),
        },
      });
      throw new Error(msg);
    }

    await this.prisma.document.updateMany({
      where: { id: documentId },
      data: { status: "PROCESSING" },
    });

    const schemaPreset = doc.sessionId
      ? await this.getSessionSchemaPreset(doc.sessionId)
      : null;
    const extractor: "pdfplumber" | "docling" =
      detectedType === "PDF_IMAGE" ? "docling" : "pdfplumber";

    let result: ContractExtractionResult;
    try {
      result = await this.runPythonExtractor(
        doc.imagePath,
        schemaPreset,
        extractor,
        onProgress,
      );
    } catch (err: any) {
      await this.prisma.document.updateMany({
        where: { id: documentId },
        data: {
          status: "ERROR",
          ocrWarnings: JSON.stringify([String(err?.message ?? err)]),
        },
      });
      throw err;
    }

    await this.prisma.document.updateMany({
      where: { id: documentId },
      data: {
        status: "REVIEW",
        processedAt: new Date(),
        ocrPageCount: result.pageCount,
        ocrProcessingTime: result.processingTime,
        ocrWarnings: JSON.stringify(result.warnings),
        extractedJson: JSON.stringify({
          type: "CONTRACT",
          schemaName:
            result.schemaName ??
            (schemaPreset?.name?.trim() || "STANDARD_CONTRACT_SCHEMA"),
          header: result.header,
          rates: result.rates,
          originArbs: result.originArbs,
          destArbs: result.destArbs,
          tabs: result.tabs ?? [],
          rawPages: result.rawPages ?? [],
        }),
      },
    });

    return result;
  }

  private runPythonExtractor(
    pdfPath: string,
    schemaPreset: SessionSchemaPresetRule | null,
    extractor: "pdfplumber" | "docling",
    onProgress?: (progress: number, message: string) => void,
  ): Promise<ContractExtractionResult> {
    const pythonExe = this.resolvePythonExe();
    const useDynamic = Boolean(schemaPreset && schemaPreset.tabs.length > 0);
    const script = useDynamic ? this.dynamicScriptPath : this.legacyScriptPath;
    const cfg = this.settings.getAll().ocr;
    const CONTRACT_TIMEOUT_S = Math.max(cfg.timeout ?? 180, 600);
    const timeoutMs = CONTRACT_TIMEOUT_S * 1000;

    if (!existsSync(script)) {
      return Promise.reject(
        new Error(`Contract extraction script not found: ${script}`),
      );
    }

    return new Promise((resolve, reject) => {
      const args = ["-u", script, "--pdf", pdfPath, "--extractor", extractor];
      if (useDynamic && schemaPreset) {
        this.logger.log(
          `Using dynamic extractor (${extractor}) with schema preset '${schemaPreset.name}' (${schemaPreset.tabs.length} tab(s))`,
        );
        args.push("--schema-json", JSON.stringify(schemaPreset));
      } else {
        this.logger.log(
          `Using legacy standard contract extractor (${extractor}, no schema preset attached)`,
        );
      }

      const child = spawn(pythonExe, args, {
        windowsHide: true,
        env: { ...process.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" },
      });

      let stdout = "";
      let stderr = "";
      let stderrRemainder = "";

      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      child.stderr.on("data", (chunk: Buffer) => {
        const text = chunk.toString();
        stderr += text;
        stderrRemainder += text;

        const lines = stderrRemainder.split(/\r?\n/);
        stderrRemainder = lines.pop() ?? "";

        for (const rawLine of lines) {
          const parsed = this.parseProgressLine(rawLine);
          if (parsed) {
            this.logger.log(`[progress] ${parsed.progress}% ${parsed.message}`);
            onProgress?.(parsed.progress, parsed.message);
          }
        }
      });

      const timer = setTimeout(() => {
        child.kill();
        reject(
          new Error(
            `Contract extraction timed out after ${CONTRACT_TIMEOUT_S}s`,
          ),
        );
      }, timeoutMs);

      child.on("close", (code) => {
        clearTimeout(timer);

        if (stderrRemainder.trim()) {
          const parsed = this.parseProgressLine(stderrRemainder);
          if (parsed) {
            this.logger.log(`[progress] ${parsed.progress}% ${parsed.message}`);
            onProgress?.(parsed.progress, parsed.message);
          }
        }

        if (stderr) {
          this.logger.warn(`[contract-extract stderr] ${stderr.trim()}`);
        }

        const jsonStart = stdout.indexOf("{");
        try {
          if (jsonStart < 0) {
            throw new Error("No JSON object found in output");
          }
          const parsed = JSON.parse(stdout.slice(jsonStart));
          if (parsed.error) {
            reject(new Error(parsed.error));
          } else {
            resolve(parsed as ContractExtractionResult);
          }
        } catch {
          reject(
            new Error(
              `Contract extractor exited with code ${code}.\nstderr: ${stderr.slice(0, 500)}\nstdout: ${stdout.slice(0, 500)}`,
            ),
          );
        }
      });
    });
  }

  private emptyResult(): ContractExtractionResult {
    return {
      header: {
        carrier: "",
        contractId: "",
        effectiveDate: "",
        expirationDate: "",
      },
      rates: [],
      originArbs: [],
      destArbs: [],
      rawPages: [],
      pageCount: 0,
      processingTime: 0,
      warnings: [],
    };
  }

  private async getSessionSchemaPreset(
    sessionId: string,
  ): Promise<SessionSchemaPresetRule | null> {
    const sessionRows = await this.prisma.$queryRawUnsafe<
      Array<{ schema_preset_id: string | null }>
    >(`SELECT schema_preset_id FROM sessions WHERE id = ?`, sessionId);

    const presetId = sessionRows[0]?.schema_preset_id;
    if (!presetId) return null;

    const presetRows = await this.prisma.$queryRawUnsafe<
      Array<{
        id: string;
        name: string;
        extraction_mode: string | null;
        record_start_regex: string | null;
      }>
    >(
      `
      SELECT id, name, extraction_mode, record_start_regex
      FROM schema_presets
      WHERE id = ?
      `,
      presetId,
    );
    if (presetRows.length === 0) return null;

    const tabRows = await this.prisma.$queryRawUnsafe<
      Array<{ id: string; name: string }>
    >(
      `
      SELECT id, name
      FROM schema_preset_tabs
      WHERE preset_id = ?
      ORDER BY sort_order ASC
      `,
      presetId,
    );

    const fieldRows = await this.prisma.$queryRawUnsafe<
      Array<{
        tab_id: string;
        label: string;
        field_key: string;
        regex_rule: string;
        extraction_strategy: string | null;
        data_type: string | null;
        page_range: string | null;
        post_processing: string | null;
        alt_regex_rules: string | null;
        section_hint: string | null;
        context_hint: string | null;
        context_label: string | null;
        mandatory: number | boolean | null;
        expected_format: string | null;
        min_length: number | null;
        max_length: number | null;
        allowed_values: string | null;
      }>
    >(
      `
      SELECT
        tab_id,
        label,
        field_key,
        regex_rule,
        extraction_strategy,
        data_type,
        page_range,
        post_processing,
        alt_regex_rules,
        section_hint,
        context_hint,
        context_label,
        mandatory,
        expected_format,
        min_length,
        max_length,
        allowed_values
      FROM schema_preset_fields
      WHERE tab_id IN (SELECT id FROM schema_preset_tabs WHERE preset_id = ?)
      ORDER BY sort_order ASC
      `,
      presetId,
    );

    return {
      id: presetRows[0].id,
      name: presetRows[0].name,
      extractionMode:
        presetRows[0].extraction_mode === "CONTRACT_BIASED" ||
        presetRows[0].extraction_mode === "GENERIC" ||
        presetRows[0].extraction_mode === "AUTO"
          ? (presetRows[0].extraction_mode as
              | "AUTO"
              | "CONTRACT_BIASED"
              | "GENERIC")
          : "AUTO",
      recordStartRegex: presetRows[0].record_start_regex ?? undefined,
      tabs: tabRows.map((tab) => ({
        name: tab.name,
        fields: fieldRows
          .filter((f) => f.tab_id === tab.id)
          .map((f) => {
            const parseJsonArray = (
              raw: string | null,
            ): string[] | undefined => {
              if (!raw) return undefined;
              try {
                const parsed = JSON.parse(raw);
                return Array.isArray(parsed)
                  ? parsed.map((v) => String(v).trim()).filter(Boolean)
                  : undefined;
              } catch {
                return undefined;
              }
            };

            const extractionStrategy =
              f.extraction_strategy === "regex" ||
              f.extraction_strategy === "table_column" ||
              f.extraction_strategy === "header_field" ||
              f.extraction_strategy === "page_region"
                ? f.extraction_strategy
                : undefined;

            const dataType =
              f.data_type === "string" ||
              f.data_type === "currency" ||
              f.data_type === "number" ||
              f.data_type === "date" ||
              f.data_type === "percentage"
                ? f.data_type
                : undefined;

            const sectionHint = (f.section_hint ?? "").trim() || undefined;
            const sectionIndicatorKey =
              (f.context_label ?? "").trim() || undefined;

            const contextHint =
              f.context_hint === "same_line_after_label" ||
              f.context_hint === "next_line_after_label" ||
              f.context_hint === "table_cell"
                ? f.context_hint
                : undefined;

            return {
              label: f.label,
              fieldKey: f.field_key,
              regexRule: f.regex_rule,
              extractionStrategy,
              dataType,
              pageRange: f.page_range ?? undefined,
              postProcessing: parseJsonArray(f.post_processing),
              altRegexRules: parseJsonArray(f.alt_regex_rules),
              sectionHint,
              sectionIndicatorKey,
              contextHint,
              contextLabel: f.context_label ?? undefined,
              mandatory:
                typeof f.mandatory === "boolean"
                  ? f.mandatory
                  : typeof f.mandatory === "number"
                    ? f.mandatory !== 0
                    : undefined,
              expectedFormat: f.expected_format ?? undefined,
              minLength: f.min_length ?? undefined,
              maxLength: f.max_length ?? undefined,
              allowedValues: parseJsonArray(f.allowed_values),
            };
          }),
      })),
    };
  }
}
