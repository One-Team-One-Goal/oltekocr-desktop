import {
  Injectable,
  NotFoundException,
  Logger,
  BadRequestException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { DocumentsService } from "../documents/documents.service";
import {
  CreateSessionDto,
  IngestFilesDto,
  IngestFolderDto,
  UpdateColumnsDto,
} from "./sessions.dto";
import type {
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
      data: { extractedRow: null },
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

    // Cascade delete documents (and their files) in the session
    const docs = await this.prisma.document.findMany({
      where: { sessionId: id },
      select: { id: true },
    });
    for (const doc of docs) {
      await this.documentsService.remove(doc.id);
    }

    await this.prisma.session.delete({ where: { id } });
    this.logger.log(`Deleted session ${id}`);
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
}
