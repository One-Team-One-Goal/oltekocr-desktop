import {
  Injectable,
  NotFoundException,
  Logger,
  BadRequestException,
} from "@nestjs/common";
import { copyFileSync, existsSync } from "fs";
import { basename, extname } from "path";
import { v4 as uuid } from "uuid";
import { PrismaService } from "../prisma/prisma.service";
import { DocumentsService } from "../documents/documents.service";
import { getDataPath } from "../../data-dirs";
import {
  CreateSessionDto,
  DuplicateSessionDto,
  IngestFilesDto,
  IngestFolderDto,
  UpdateColumnsDto,
} from "./sessions.dto";
import type {
  DuplicateSessionResult,
  SessionRecord,
  SessionListItem,
  DocumentListItem,
  SessionColumn,
} from "@shared/types";

@Injectable()
export class SessionsService {
  private readonly logger = new Logger(SessionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly documentsService: DocumentsService,
  ) {}

  // ─── Create ────────────────────────────────────────────
  async create(dto: CreateSessionDto): Promise<SessionRecord> {
    if (
      dto.mode === "TABLE_EXTRACT" &&
      (!dto.columns || dto.columns.length === 0)
    ) {
      throw new BadRequestException(
        "TABLE_EXTRACT sessions require at least one column definition.",
      );
    }

    const session = await this.prisma.session.create({
      data: {
        name: dto.name,
        mode: dto.mode,
        columns: JSON.stringify(dto.columns ?? []),
        sourceType: dto.sourceType,
        sourcePath: dto.sourcePath ?? "",
        status: "PENDING",
      },
    });

    this.logger.log(
      `Created session "${session.name}" [${session.mode}] (${session.id})`,
    );
    return this.toRecord(session);
  }

  // ─── List ──────────────────────────────────────────────
  async findAll(): Promise<SessionListItem[]> {
    const sessions = await this.prisma.session.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        _count: { select: { documents: true } },
      },
    });

    const processed = await this.prisma.document.groupBy({
      by: ["sessionId"],
      where: {
        status: { in: ["REVIEW", "APPROVED", "REJECTED", "EXPORTED"] },
        sessionId: { not: null },
      },
      _count: true,
    });

    const processedMap: Record<string, number> = {};
    for (const p of processed) {
      if (p.sessionId) processedMap[p.sessionId] = p._count;
    }

    return sessions.map((s) => ({
      id: s.id,
      name: s.name,
      mode: s.mode as any,
      status: s.status as any,
      documentCount: s._count.documents,
      processedCount: processedMap[s.id] ?? 0,
      createdAt: s.createdAt.toISOString(),
    }));
  }

  // ─── Get One ───────────────────────────────────────────
  async findOne(id: string): Promise<SessionRecord> {
    const session = await this.prisma.session.findUnique({ where: { id } });
    if (!session) throw new NotFoundException(`Session ${id} not found`);
    return this.toRecord(session);
  }

  // ─── Duplicate ───────────────────────────────────────
  async duplicate(
    sourceId: string,
    dto: DuplicateSessionDto,
  ): Promise<DuplicateSessionResult> {
    const source = await this.prisma.session.findUnique({ where: { id: sourceId } });
    if (!source) throw new NotFoundException(`Session ${sourceId} not found`);

    const sourceDocuments =
      dto.strategy === "FULL"
        ? await this.prisma.document.findMany({
            where: { sessionId: sourceId },
            orderBy: { createdAt: "asc" },
          })
        : [];

    const duplicated = await this.prisma.session.create({
      data: {
        name: dto.name?.trim() || `${source.name} (Copy)`,
        mode: source.mode,
        columns: source.columns,
        sourceType: source.sourceType,
        sourcePath: source.sourcePath,
        status: dto.strategy === "FULL" ? source.status : "PENDING",
      },
    });

    let documents: DocumentListItem[] = [];

    if (dto.strategy === "FULL") {
      for (const sourceDoc of sourceDocuments) {
        const newDocId = uuid();

        const newImagePath = this.cloneSessionAsset(
          sourceDoc.imagePath,
          getDataPath(
            "scans",
            `${newDocId}_${basename(sourceDoc.imagePath || sourceDoc.filename || "document")}`,
          ),
        );

        const thumbnailExt = extname(sourceDoc.thumbnailPath || "") || ".jpg";
        const newThumbnailPath = this.cloneSessionAsset(
          sourceDoc.thumbnailPath,
          getDataPath("scans", "thumbnails", `${newDocId}${thumbnailExt}`),
        );

        await this.prisma.document.create({
          data: {
            id: newDocId,
            filename: sourceDoc.filename,
            imagePath: newImagePath,
            thumbnailPath: newThumbnailPath,
            status: sourceDoc.status,
            createdAt: sourceDoc.createdAt,
            processedAt: sourceDoc.processedAt,
            verifiedAt: sourceDoc.verifiedAt,
            verifiedBy: sourceDoc.verifiedBy,
            notes: sourceDoc.notes,
            tags: sourceDoc.tags,
            exported: sourceDoc.exported,
            exportPath: sourceDoc.exportPath,
            qualityValid: sourceDoc.qualityValid,
            qualityDpi: sourceDoc.qualityDpi,
            qualityWidth: sourceDoc.qualityWidth,
            qualityHeight: sourceDoc.qualityHeight,
            qualityBlurScore: sourceDoc.qualityBlurScore,
            qualityIsBlurry: sourceDoc.qualityIsBlurry,
            qualityIsSkewed: sourceDoc.qualityIsSkewed,
            qualitySkewAngle: sourceDoc.qualitySkewAngle,
            qualityIssues: sourceDoc.qualityIssues,
            ocrFullText: sourceDoc.ocrFullText,
            ocrMarkdown: sourceDoc.ocrMarkdown,
            ocrTextBlocks: sourceDoc.ocrTextBlocks,
            ocrTables: sourceDoc.ocrTables,
            ocrAvgConfidence: sourceDoc.ocrAvgConfidence,
            ocrProcessingTime: sourceDoc.ocrProcessingTime,
            ocrPageCount: sourceDoc.ocrPageCount,
            ocrWarnings: sourceDoc.ocrWarnings,
            sessionId: duplicated.id,
            userEdits: sourceDoc.userEdits,
            extractedJson: sourceDoc.extractedJson,
            extractedRow: sourceDoc.extractedRow,
          },
        });
      }

      documents = await this.documentsService.findAll({
        sessionId: duplicated.id,
      } as any);
    }

    this.logger.log(
      `Duplicated session ${sourceId} -> ${duplicated.id} using strategy=${dto.strategy}`,
    );

    return {
      session: this.toRecord(duplicated),
      documents,
    };
  }

  // ─── Rename ────────────────────────────────────────────
  async rename(id: string, name: string): Promise<SessionRecord> {
    const session = await this.prisma.session.findUnique({ where: { id } });
    if (!session) throw new NotFoundException(`Session ${id} not found`);
    await this.prisma.session.update({ where: { id }, data: { name } });
    return this.findOne(id);
  }

  // ─── Update Columns ────────────────────────────────────
  async updateColumns(
    id: string,
    dto: UpdateColumnsDto,
  ): Promise<SessionRecord> {
    const session = await this.prisma.session.findUnique({ where: { id } });
    if (!session) throw new NotFoundException(`Session ${id} not found`);

    await this.prisma.session.update({
      where: { id },
      data: { columns: JSON.stringify(dto.columns) },
    });

    // Clear extracted data for all documents so stale values don't persist
    await this.prisma.document.updateMany({
      where: { sessionId: id },
      data: { extractedRow: "{}" },
    });

    this.logger.log(
      `Updated columns for session ${id}; cleared extractedRow on all documents`,
    );
    return this.findOne(id);
  }

  // ─── Delete ────────────────────────────────────────────
  async remove(id: string): Promise<void> {
    const session = await this.prisma.session.findUnique({ where: { id } });
    if (!session) throw new NotFoundException(`Session ${id} not found`);

    // Deleting the session cascades to all its documents (and their exports/summaries)
    // via the onDelete: Cascade relation in the Prisma schema.
    await this.prisma.session.delete({ where: { id } });
    this.logger.log(`Deleted session ${id} (documents cascade-deleted)`);
  }

  // ─── Ingest Files ──────────────────────────────────────
  async ingestFiles(
    sessionId: string,
    dto: IngestFilesDto,
  ): Promise<DocumentListItem[]> {
    await this.ensureExists(sessionId);
    await this.prisma.session.update({
      where: { id: sessionId },
      data: { status: "PROCESSING" },
    });

    const docs = await this.documentsService.loadFiles(
      dto.filePaths,
      sessionId,
    );
    this.logger.log(`Ingested ${docs.length} files into session ${sessionId}`);
    return docs;
  }

  // ─── Ingest Folder ─────────────────────────────────────
  async ingestFolder(
    sessionId: string,
    dto: IngestFolderDto,
  ): Promise<DocumentListItem[]> {
    await this.ensureExists(sessionId);
    await this.prisma.session.update({
      where: { id: sessionId },
      data: { status: "PROCESSING", sourcePath: dto.folderPath },
    });

    const docs = await this.documentsService.loadFolder(
      dto.folderPath,
      sessionId,
    );
    this.logger.log(
      `Ingested ${docs.length} files from folder into session ${sessionId}`,
    );
    return docs;
  }

  // ─── Get Session Documents ─────────────────────────────
  async getDocuments(sessionId: string): Promise<DocumentListItem[]> {
    await this.ensureExists(sessionId);
    return this.documentsService.findAll({ sessionId } as any);
  }

  // ─── Get Session Stats ─────────────────────────────────
  async getStats(sessionId: string) {
    await this.ensureExists(sessionId);

    const counts = await this.prisma.document.groupBy({
      by: ["status"],
      where: { sessionId },
      _count: true,
    });

    const avgConf = await this.prisma.document.aggregate({
      _avg: { ocrAvgConfidence: true },
      where: { sessionId, ocrAvgConfidence: { gt: 0 } },
    });

    const statusMap: Record<string, number> = {};
    let total = 0;
    for (const c of counts) {
      statusMap[c.status] = c._count;
      total += c._count;
    }

    return {
      total,
      queued: statusMap["QUEUED"] ?? 0,
      processing: statusMap["PROCESSING"] ?? 0,
      review: statusMap["REVIEW"] ?? 0,
      approved: statusMap["APPROVED"] ?? 0,
      rejected: statusMap["REJECTED"] ?? 0,
      exported: statusMap["EXPORTED"] ?? 0,
      error: statusMap["ERROR"] ?? 0,
      avgConfidence: avgConf._avg.ocrAvgConfidence ?? 0,
    };
  }

  // ─── Update status (called by queue after all docs done) ─
  async syncStatus(sessionId: string): Promise<void> {
    const counts = await this.prisma.document.groupBy({
      by: ["status"],
      where: { sessionId },
      _count: true,
    });
    const total = counts.reduce((s, c) => s + c._count, 0);
    if (total === 0) return;

    const doneStatuses = new Set(["APPROVED", "REJECTED", "EXPORTED", "ERROR"]);
    const doneCount = counts
      .filter((c) => doneStatuses.has(c.status))
      .reduce((s, c) => s + c._count, 0);

    const newStatus = doneCount === total ? "DONE" : "PROCESSING";
    await this.prisma.session.update({
      where: { id: sessionId },
      data: { status: newStatus },
    });
  }

  // ─── Helpers ───────────────────────────────────────────
  private async ensureExists(id: string): Promise<void> {
    const count = await this.prisma.session.count({ where: { id } });
    if (count === 0) throw new NotFoundException(`Session ${id} not found`);
  }

  private toRecord(s: any): SessionRecord {
    return {
      id: s.id,
      name: s.name,
      mode: s.mode,
      columns: JSON.parse(s.columns || "[]") as SessionColumn[],
      sourceType: s.sourceType,
      sourcePath: s.sourcePath,
      status: s.status,
      createdAt: s.createdAt?.toISOString?.() ?? s.createdAt,
      updatedAt: s.updatedAt?.toISOString?.() ?? s.updatedAt,
    };
  }

  private cloneSessionAsset(sourcePath: string, targetPath: string): string {
    if (!sourcePath || !existsSync(sourcePath)) {
      return sourcePath || targetPath;
    }

    try {
      copyFileSync(sourcePath, targetPath);
      return targetPath;
    } catch (err) {
      this.logger.warn(
        `Failed to copy session asset ${sourcePath} -> ${targetPath}. Reusing source path.`,
      );
      return sourcePath;
    }
  }
}
