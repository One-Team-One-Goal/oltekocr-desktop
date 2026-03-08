import { Injectable, NotFoundException, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
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

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(private readonly prisma: PrismaService) {}

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
  ): "IMAGE" | "PDF_TEXT" | "PDF_IMAGE" | "EXCEL" {
    const ext = extname(filePath).toLowerCase();
    if (ext === ".xlsx" || ext === ".xls") return "EXCEL";
    if (ext !== ".pdf") return "IMAGE";
    // For PDFs: peek at the binary to see if embedded fonts/text operators exist.
    // A scanned (image-only) PDF has no /Font resources; a digital PDF always does.
    try {
      const fd = openSync(filePath, "r");
      const buf = Buffer.alloc(65536); // read first 64 KB
      const bytesRead = readSync(fd, buf, 0, 65536, 0);
      closeSync(fd);
      const chunk = buf.slice(0, bytesRead).toString("latin1");
      return chunk.includes("/Font") ? "PDF_TEXT" : "PDF_IMAGE";
    } catch {
      return "PDF_TEXT";
    }
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
