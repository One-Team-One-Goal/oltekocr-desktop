import { Injectable, NotFoundException, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { SettingsService } from "../settings/settings.service";
import { ListDocumentsQueryDto, UpdateDocumentDto } from "./documents.dto";
import type {
  DocumentRecord,
  DocumentListItem,
  DashboardStats,
  QualityCheck,
  OcrResult,
} from "@shared/types";
import { v4 as uuid } from "uuid";
import {
  copyFileSync,
  existsSync,
  unlinkSync,
  readdirSync,
  statSync,
  openSync,
  readSync,
  closeSync,
} from "fs";
import { join, basename, extname } from "path";
import { getDataPath } from "../../data-dirs";

const SUPPORTED_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".tiff",
  ".tif",
  ".bmp",
  ".pdf",
]);

interface PdfContentAnalysis {
  filePath: string;
  classification: "TEXT_ONLY" | "IMAGE_ONLY" | "MIXED" | "UNKNOWN";
  textPages: number;
  imagePages: number;
  totalPages: number;
  confidence: number;
  detector: "pdfplumber" | "pymupdf" | "combined";
  error: string | null;
}

interface PdfDetectorOutput {
  classification?: "TEXT_ONLY" | "IMAGE_ONLY" | "MIXED" | "UNKNOWN";
  textPages?: number;
  imagePages?: number;
  totalPages?: number;
  confidence?: number;
  detector?: "pdfplumber" | "pymupdf" | "combined";
  error?: string | null;
}

export interface PdfTextExtractionResult {
  filePath: string;
  classification: "TEXT_ONLY" | "IMAGE_ONLY" | "MIXED" | "UNKNOWN";
  modelUsed: "pdfplumber" | "docling" | "none";
  fullText: string;
  rawPages: Array<{ page: number; text: string }>;
  pageCount: number;
  processingTime: number;
  warnings: string[];
  error: string | null;
}

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  // ─── List ──────────────────────────────────────────────
  async findAll(
    query: ListDocumentsQueryDto & { sessionId?: string },
  ): Promise<DocumentListItem[]> {
    const where: Record<string, unknown> = {};

    if (query.sessionId) {
      where.sessionId = query.sessionId;
    }
    if (query.status) {
      where.status = query.status;
    }
    if (query.search) {
      where.OR = [
        { filename: { contains: query.search } },
        { notes: { contains: query.search } },
      ];
    }

    const sortBy = query.sortBy || "createdAt";
    const sortOrder = query.sortOrder || "desc";

    const docs = await this.prisma.document.findMany({
      where: where as any,
      orderBy: { [sortBy]: sortOrder },
      select: {
        id: true,
        filename: true,
        status: true,
        createdAt: true,
        ocrAvgConfidence: true,
        ocrProcessingTime: true,
        ocrPageCount: true,
        ocrTables: true,
        notes: true,
        qualityValid: true,
        qualityIssues: true,
        sessionId: true,
        extractionType: true,
        extractedRow: true,
      },
    });

    return docs.map((d) => ({
      id: d.id,
      filename: d.filename,
      status: d.status as any,
      createdAt: d.createdAt.toISOString(),
      ocrAvgConfidence: d.ocrAvgConfidence,
      ocrProcessingTime: d.ocrProcessingTime,
      ocrPageCount: d.ocrPageCount,
      ocrTableCount: JSON.parse(d.ocrTables || "[]").length,
      notes: d.notes,
      qualityValid: d.qualityValid,
      qualityIssueCount: JSON.parse(d.qualityIssues || "[]").length,
      sessionId: d.sessionId,
      extractionType: (d.extractionType as any) || "IMAGE",
      extractedRow: (() => {
        try {
          const parsed = JSON.parse(d.extractedRow || "{}");
          return Object.keys(parsed).length > 0 ? parsed : null;
        } catch {
          return null;
        }
      })(),
    }));
  }

  // ─── Get One ───────────────────────────────────────────
  async findOne(id: string): Promise<DocumentRecord> {
    const doc = await this.prisma.document.findUnique({ where: { id } });
    if (!doc) throw new NotFoundException(`Document ${id} not found`);
    return this.toDocumentRecord(doc);
  }

  // ─── Load Files ────────────────────────────────────────
  async loadFiles(
    filePaths: string[],
    sessionId?: string,
  ): Promise<DocumentListItem[]> {
    const created: DocumentListItem[] = [];

    for (const filePath of filePaths) {
      const ext = extname(filePath).toLowerCase();
      if (!SUPPORTED_EXTENSIONS.has(ext)) {
        this.logger.warn(`Skipping unsupported file: ${filePath}`);
        continue;
      }

      if (!existsSync(filePath)) {
        this.logger.warn(`File not found: ${filePath}`);
        continue;
      }

      const id = uuid();
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const destFilename = `${timestamp}_${basename(filePath)}`;
      const destPath = getDataPath("scans", destFilename);

      // Copy file to data/scans/
      copyFileSync(filePath, destPath);

      // Generate thumbnail (placeholder — sharp integration)
      const thumbnailPath = getDataPath("scans", "thumbnails", `${id}.jpg`);

      // Assess image quality (basic — just file stats for now)
      const quality = await this.assessQuality(destPath);

      // Create DB record
      const doc = await this.prisma.document.create({
        data: {
          id,
          filename: basename(filePath),
          imagePath: destPath,
          thumbnailPath,
          status: "QUEUED",
          // AUTO means the pipeline will detect the type when processing starts
          ...(sessionId ? { sessionId } : {}),
          qualityValid: quality.valid,
          qualityDpi: quality.dpi,
          qualityWidth: quality.width,
          qualityHeight: quality.height,
          qualityBlurScore: quality.blurScore,
          qualityIsBlurry: quality.isBlurry,
          qualityIsSkewed: quality.isSkewed,
          qualitySkewAngle: quality.skewAngle,
          qualityIssues: JSON.stringify(quality.issues),
        },
      });

      created.push({
        id: doc.id,
        filename: doc.filename,
        status: doc.status as any,
        createdAt: doc.createdAt.toISOString(),
        ocrAvgConfidence: 0,
        ocrProcessingTime: 0,
        ocrPageCount: 0,
        ocrTableCount: 0,
        notes: "",
        qualityValid: doc.qualityValid,
        qualityIssueCount: quality.issues.length,
        sessionId: (doc as any).sessionId ?? null,
        extractionType: ((doc as any).extractionType as any) || "IMAGE",
        extractedRow: null,
      });

      this.logger.log(`Loaded document: ${doc.filename} (${id})`);
    }

    return created;
  }

  // ─── Load Folder ───────────────────────────────────────
  async loadFolder(
    folderPath: string,
    sessionId?: string,
  ): Promise<DocumentListItem[]> {
    if (!existsSync(folderPath)) {
      throw new NotFoundException(`Folder not found: ${folderPath}`);
    }

    const files = readdirSync(folderPath)
      .filter((f) => {
        const ext = extname(f).toLowerCase();
        return SUPPORTED_EXTENSIONS.has(ext);
      })
      .map((f) => join(folderPath, f))
      .filter((f) => statSync(f).isFile());

    return this.loadFiles(files, sessionId);
  }

  // ─── Update ────────────────────────────────────────────
  async update(id: string, dto: UpdateDocumentDto): Promise<DocumentRecord> {
    await this.ensureExists(id);

    const data: Record<string, unknown> = {};
    if (dto.notes !== undefined) data.notes = dto.notes;
    if (dto.tags !== undefined) data.tags = JSON.stringify(dto.tags);
    if (dto.ocrFullText !== undefined) data.ocrFullText = dto.ocrFullText;
    if (dto.ocrMarkdown !== undefined) data.ocrMarkdown = dto.ocrMarkdown;
    if (dto.userEdits !== undefined)
      data.userEdits = JSON.stringify(dto.userEdits);
    if (dto.extractedRow !== undefined)
      data.extractedRow = JSON.stringify(dto.extractedRow);
    if (dto.extractionType !== undefined)
      data.extractionType = dto.extractionType;

    const doc = await this.prisma.document.update({
      where: { id },
      data: data as any,
    });

    return this.toDocumentRecord(doc);
  }

  // ─── Approve ───────────────────────────────────────────
  async approve(id: string): Promise<DocumentRecord> {
    await this.ensureExists(id);
    const doc = await this.prisma.document.update({
      where: { id },
      data: {
        status: "APPROVED",
        verifiedAt: new Date(),
      },
    });
    return this.toDocumentRecord(doc);
  }

  // ─── Reject ────────────────────────────────────────────
  async reject(id: string, reason?: string): Promise<DocumentRecord> {
    await this.ensureExists(id);
    const data: any = {
      status: "REJECTED",
      verifiedAt: new Date(),
    };
    if (reason) data.notes = reason;

    const doc = await this.prisma.document.update({
      where: { id },
      data,
    });
    return this.toDocumentRecord(doc);
  }

  // ─── Reprocess ─────────────────────────────────────────
  async reprocess(id: string): Promise<DocumentRecord> {
    await this.ensureExists(id);
    const doc = await this.prisma.document.update({
      where: { id },
      data: {
        status: "QUEUED",
        processedAt: null,
        verifiedAt: null,
        verifiedBy: "",
        ocrFullText: "",
        ocrMarkdown: "",
        ocrTextBlocks: "[]",
        ocrTables: "[]",
        ocrAvgConfidence: 0,
        ocrProcessingTime: 0,
        ocrPageCount: 0,
        ocrWarnings: "[]",
        extractedJson: "{}",
      },
    });
    return this.toDocumentRecord(doc);
  }

  // ─── Delete ────────────────────────────────────────────
  async remove(id: string): Promise<void> {
    const doc = await this.prisma.document.findUnique({ where: { id } });
    if (!doc) throw new NotFoundException(`Document ${id} not found`);

    // Delete files
    if (doc.imagePath && existsSync(doc.imagePath)) unlinkSync(doc.imagePath);
    if (doc.thumbnailPath && existsSync(doc.thumbnailPath))
      unlinkSync(doc.thumbnailPath);

    await this.prisma.document.delete({ where: { id } });
  }

  // ─── Stats ─────────────────────────────────────────────
  async getStats(): Promise<DashboardStats> {
    const counts = await this.prisma.document.groupBy({
      by: ["status"],
      _count: true,
    });

    const avgConf = await this.prisma.document.aggregate({
      _avg: { ocrAvgConfidence: true },
      where: { ocrAvgConfidence: { gt: 0 } },
    });

    const statusMap: Record<string, number> = {};
    let total = 0;
    for (const c of counts) {
      statusMap[c.status] = c._count;
      total += c._count;
    }

    return {
      total,
      queued: statusMap["QUEUED"] || 0,
      processing: statusMap["PROCESSING"] || 0,
      review: statusMap["REVIEW"] || 0,
      approved: statusMap["APPROVED"] || 0,
      rejected: statusMap["REJECTED"] || 0,
      exported: statusMap["EXPORTED"] || 0,
      error: statusMap["ERROR"] || 0,
      avgConfidence: avgConf._avg.ocrAvgConfidence || 0,
    };
  }

  // ─── Helpers ───────────────────────────────────────────
  detectExtractionType(
    filePath: string,
  ): "IMAGE" | "PDF_TEXT" | "PDF_IMAGE" | "EXCEL" | "UNKNOWN" {
    const ext = extname(filePath).toLowerCase();
    if (ext === ".xlsx" || ext === ".xls") return "EXCEL";
    if (ext !== ".pdf") return "IMAGE";

    const analysis = this.analyzeSinglePdf(filePath);
    if (analysis.classification === "TEXT_ONLY") return "PDF_TEXT";
    if (analysis.classification === "IMAGE_ONLY") return "PDF_IMAGE";
    if (analysis.classification === "MIXED") return "PDF_IMAGE";

    this.logger.warn(
      `PDF classification UNKNOWN for ${filePath}: ${analysis.error ?? "unknown detection error"}`,
    );
    return "UNKNOWN";
  }

  analyzePdfContent(filePaths: string[]): PdfContentAnalysis[] {
    return filePaths
      .filter((filePath) => extname(filePath).toLowerCase() === ".pdf")
      .map((filePath) => this.analyzeSinglePdf(filePath));
  }

  extractPdfText(filePaths: string[]): PdfTextExtractionResult[] {
    const pythonExe = this.resolvePythonExe(
      this.settings.getAll().ocr.pythonPath || "python",
    );
    const doclingTextScript = join(
      process.cwd(),
      "src",
      "main",
      "python",
      "pdf_docling_text_extract.py",
    );
    const pdfExtractScript = join(
      process.cwd(),
      "src",
      "main",
      "python",
      "pdf_extract.py",
    );

    return filePaths
      .filter((filePath) => extname(filePath).toLowerCase() === ".pdf")
      .map((filePath) => {
        const analysis = this.analyzeSinglePdf(filePath);

        if (!existsSync(filePath)) {
          return {
            filePath,
            classification: "UNKNOWN",
            modelUsed: "none",
            fullText: "",
            rawPages: [],
            pageCount: 0,
            processingTime: 0,
            warnings: [],
            error: "File not found",
          };
        }

        if (analysis.classification === "UNKNOWN") {
          return {
            filePath,
            classification: "UNKNOWN",
            modelUsed: "none",
            fullText: "",
            rawPages: [],
            pageCount: 0,
            processingTime: 0,
            warnings: [],
            error:
              analysis.error ||
              "Unable to classify PDF content for text extraction",
          };
        }

        const usePdfPlumber = analysis.classification === "TEXT_ONLY";
        const modelUsed: "pdfplumber" | "docling" = usePdfPlumber
          ? "pdfplumber"
          : "docling";
        const script = usePdfPlumber ? pdfExtractScript : doclingTextScript;

        if (!existsSync(script)) {
          return {
            filePath,
            classification: analysis.classification,
            modelUsed: "none",
            fullText: "",
            rawPages: [],
            pageCount: 0,
            processingTime: 0,
            warnings: [],
            error: `${modelUsed} extractor script not found`,
          };
        }

        try {
          const args = usePdfPlumber
            ? [
                script,
                "--input",
                filePath,
                "--model",
                "pdfplumber",
                "--mode",
                "text",
              ]
            : [script, "--input", filePath, "--mode", "ocr"];

          const result = require("child_process").spawnSync(pythonExe, args, {
            encoding: "utf8",
            timeout: 600000,
            stdio: ["pipe", "pipe", "pipe"],
          });

          const raw = String(result.stdout || "").trim();
          if (!raw) {
            return {
              filePath,
              classification: analysis.classification,
              modelUsed,
              fullText: "",
              rawPages: [],
              pageCount: 0,
              processingTime: 0,
              warnings: [],
              error: `Extractor returned empty output${result.status !== 0 ? ` (status ${String(result.status)})` : ""}`,
            };
          }

          let parsed: any;
          try {
            parsed = JSON.parse(raw);
          } catch {
            return {
              filePath,
              classification: analysis.classification,
              modelUsed,
              fullText: "",
              rawPages: [],
              pageCount: 0,
              processingTime: 0,
              warnings: [],
              error: `Extractor returned invalid JSON: ${raw.slice(0, 180)}`,
            };
          }

          if (parsed?.error) {
            return {
              filePath,
              classification: analysis.classification,
              modelUsed,
              fullText: "",
              rawPages: [],
              pageCount: 0,
              processingTime: 0,
              warnings: [],
              error: String(parsed.error),
            };
          }

          const rawPages = Array.isArray(parsed?.rawPages)
            ? parsed.rawPages.map((row: any) => ({
                page: Number(row?.page ?? 0),
                text: String(row?.text ?? ""),
              }))
            : this.buildRawPagesFromTextBlocks(
                parsed?.textBlocks,
                parsed?.pageCount,
              );

          const fullText = String(parsed?.fullText ?? "");
          const warnings = Array.isArray(parsed?.warnings)
            ? parsed.warnings.map((w: any) => String(w))
            : [];

          return {
            filePath,
            classification: analysis.classification,
            modelUsed,
            fullText,
            rawPages,
            pageCount: Number(parsed?.pageCount ?? 0),
            processingTime: Number(parsed?.processingTime ?? 0),
            warnings,
            error: null,
          };
        } catch (err: any) {
          return {
            filePath,
            classification: analysis.classification,
            modelUsed,
            fullText: "",
            rawPages: [],
            pageCount: 0,
            processingTime: 0,
            warnings: [],
            error: String(err?.message ?? err),
          };
        }
      });
  }

  private buildRawPagesFromTextBlocks(
    textBlocksLike: any,
    pageCountLike: any,
  ): Array<{ page: number; text: string }> {
    const blocks = Array.isArray(textBlocksLike) ? textBlocksLike : [];
    const pageCount = Number(pageCountLike ?? 0);
    const byPage = new Map<number, string[]>();

    for (const block of blocks) {
      const text = String(block?.text ?? "").trim();
      if (!text) continue;
      const page = Math.max(1, Number(block?.page ?? 1));
      const list = byPage.get(page) ?? [];
      list.push(text);
      byPage.set(page, list);
    }

    if (byPage.size === 0 && pageCount > 0) {
      return Array.from({ length: pageCount }, (_, idx) => ({
        page: idx + 1,
        text: "",
      }));
    }

    return Array.from(byPage.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([page, lines]) => ({
        page,
        text: lines.join("\n").trim(),
      }));
  }

  private analyzeSinglePdf(filePath: string): PdfContentAnalysis {
    if (!existsSync(filePath)) {
      return {
        filePath,
        classification: "UNKNOWN",
        textPages: 0,
        imagePages: 0,
        totalPages: 0,
        confidence: 0,
        detector: "combined",
        error: "File not found",
      };
    }

    const ext = extname(filePath).toLowerCase();
    if (ext !== ".pdf") {
      return {
        filePath,
        classification: "UNKNOWN",
        textPages: 0,
        imagePages: 0,
        totalPages: 0,
        confidence: 0,
        detector: "combined",
        error: "Not a PDF file",
      };
    }

    try {
      const pythonExe = this.resolvePythonExe(
        this.settings.getAll().ocr.pythonPath || "python",
      );
      const script = join(
        process.cwd(),
        "src",
        "main",
        "python",
        "pdf_text_detect.py",
      );
      const result = require("child_process").spawnSync(
        pythonExe,
        [script, filePath],
        {
          encoding: "utf8",
          timeout: 10000, // 10 second timeout
          stdio: ["pipe", "pipe", "pipe"],
        },
      );

      if (result.status !== 0) {
        return {
          filePath,
          classification: "UNKNOWN",
          textPages: 0,
          imagePages: 0,
          totalPages: 0,
          confidence: 0,
          detector: "combined",
          error: `Detector exited with status ${String(result.status)}: ${(result.stderr || "").trim() || "Unknown error"}`,
        };
      }

      const raw = String(result.stdout || "").trim();
      if (!raw) {
        return {
          filePath,
          classification: "UNKNOWN",
          textPages: 0,
          imagePages: 0,
          totalPages: 0,
          confidence: 0,
          detector: "combined",
          error: "Detector returned empty output",
        };
      }

      let parsed: PdfDetectorOutput;
      try {
        parsed = JSON.parse(raw) as PdfDetectorOutput;
      } catch {
        return {
          filePath,
          classification: "UNKNOWN",
          textPages: 0,
          imagePages: 0,
          totalPages: 0,
          confidence: 0,
          detector: "combined",
          error: `Detector returned invalid JSON: ${raw.slice(0, 180)}`,
        };
      }

      const classification = parsed.classification;
      if (
        classification !== "TEXT_ONLY" &&
        classification !== "IMAGE_ONLY" &&
        classification !== "MIXED" &&
        classification !== "UNKNOWN"
      ) {
        return {
          filePath,
          classification: "UNKNOWN",
          textPages: 0,
          imagePages: 0,
          totalPages: 0,
          confidence: 0,
          detector: "combined",
          error: "Detector returned unknown classification",
        };
      }

      return {
        filePath,
        classification,
        textPages: Number(parsed.textPages ?? 0),
        imagePages: Number(parsed.imagePages ?? 0),
        totalPages: Number(parsed.totalPages ?? 0),
        confidence: Number(parsed.confidence ?? 0),
        detector: parsed.detector ?? "combined",
        error: parsed.error ?? null,
      };
    } catch (err: any) {
      return {
        filePath,
        classification: "UNKNOWN",
        textPages: 0,
        imagePages: 0,
        totalPages: 0,
        confidence: 0,
        detector: "combined",
        error: String(err?.message ?? err),
      };
    }
  }

  private resolvePythonExe(configured: string): string {
    const venvPath = join(process.cwd(), ".venv", "Scripts", "python.exe");
    const venv312Path = join(
      process.cwd(),
      ".venv312",
      "Scripts",
      "python.exe",
    );

    if (existsSync(venvPath)) return venvPath;
    if (existsSync(venv312Path)) return venv312Path;
    return configured || "python";
  }

  private async ensureExists(id: string): Promise<void> {
    const count = await this.prisma.document.count({ where: { id } });
    if (count === 0) throw new NotFoundException(`Document ${id} not found`);
  }

  private async assessQuality(filePath: string): Promise<QualityCheck> {
    // Basic quality assessment — expand with sharp later
    const issues: string[] = [];
    try {
      const sharp = require("sharp");
      const metadata = await sharp(filePath).metadata();
      const dpi = metadata.density || 0;
      const width = metadata.width || 0;
      const height = metadata.height || 0;

      if (dpi > 0 && dpi < 150) issues.push(`Low DPI: ${dpi}`);
      if (width < 500 || height < 500)
        issues.push(`Small image: ${width}x${height}`);

      return {
        valid: issues.length === 0,
        dpi,
        width,
        height,
        blurScore: 0, // needs OpenCV or canvas-based Laplacian
        isBlurry: false,
        isSkewed: false,
        skewAngle: 0,
        issues,
      };
    } catch {
      return {
        valid: true,
        dpi: 0,
        width: 0,
        height: 0,
        blurScore: 0,
        isBlurry: false,
        isSkewed: false,
        skewAngle: 0,
        issues: [],
      };
    }
  }

  private toDocumentRecord(doc: any): DocumentRecord {
    return {
      id: doc.id,
      filename: doc.filename,
      imagePath: doc.imagePath,
      thumbnailPath: doc.thumbnailPath,
      status: doc.status,
      createdAt: doc.createdAt?.toISOString?.() || doc.createdAt,
      updatedAt: doc.updatedAt?.toISOString?.() || doc.updatedAt,
      processedAt: doc.processedAt?.toISOString?.() || null,
      verifiedAt: doc.verifiedAt?.toISOString?.() || null,
      verifiedBy: doc.verifiedBy,
      notes: doc.notes,
      tags: JSON.parse(doc.tags || "[]"),
      exported: doc.exported,
      exportPath: doc.exportPath,
      extractionType: doc.extractionType || "AUTO",
      quality: {
        valid: doc.qualityValid,
        dpi: doc.qualityDpi,
        width: doc.qualityWidth,
        height: doc.qualityHeight,
        blurScore: doc.qualityBlurScore,
        isBlurry: doc.qualityIsBlurry,
        isSkewed: doc.qualityIsSkewed,
        skewAngle: doc.qualitySkewAngle,
        issues: JSON.parse(doc.qualityIssues || "[]"),
      },
      ocrResult: doc.ocrFullText
        ? {
            fullText: doc.ocrFullText,
            markdown: doc.ocrMarkdown,
            textBlocks: JSON.parse(doc.ocrTextBlocks || "[]"),
            tables: JSON.parse(doc.ocrTables || "[]"),
            avgConfidence: doc.ocrAvgConfidence,
            processingTime: doc.ocrProcessingTime,
            pageCount: doc.ocrPageCount,
            warnings: JSON.parse(doc.ocrWarnings || "[]"),
          }
        : null,
      userEdits: JSON.parse(doc.userEdits || "{}"),
      extractedJson: JSON.parse(doc.extractedJson || "{}"),
    };
  }
}
