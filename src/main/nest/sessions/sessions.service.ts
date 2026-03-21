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
  AssignSessionSchemaPresetDto,
  CreateSessionDto,
  DuplicateSessionDto,
  IngestFilesDto,
  IngestFolderDto,
  SchemaPresetFieldDto,
  SchemaPresetTabDto,
  SessionSchemaFieldDto,
  UpsertSchemaPresetDto,
  UpdateColumnsDto,
  UpdateSessionSchemaFieldsDto,
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
  private readonly allowedExtractionModels = new Set([
    "docling",
    "pdfplumber",
    "pymupdf",
    "unstructured",
  ]);

  constructor(
    private readonly prisma: PrismaService,
    private readonly documentsService: DocumentsService,
  ) {}

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
        documentType: dto.documentType ?? "",
        status: "PENDING",
      },
    });

    this.logger.log(
      `Created session "${session.name}" [${session.mode}] (${session.id})`,
    );
    return this.toRecord(session);
  }

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
      extractionModel: s.extractionModel ?? "docling",
      documentCount: s._count.documents,
      processedCount: processedMap[s.id] ?? 0,
      createdAt: s.createdAt.toISOString(),
    }));
  }

  async findOne(id: string): Promise<SessionRecord> {
    const session = await this.prisma.session.findUnique({ where: { id } });
    if (!session) throw new NotFoundException(`Session ${id} not found`);
    return this.toRecord(session);
  }

  async duplicate(
    sourceId: string,
    dto: DuplicateSessionDto,
  ): Promise<DuplicateSessionResult> {
    const source = await this.prisma.session.findUnique({
      where: { id: sourceId },
    });
    if (!source) throw new NotFoundException(`Session ${sourceId} not found`);

    const sourceDocuments =
      dto.strategy === "FULL"
        ? await this.prisma.document.findMany({
            where: { sessionId: sourceId },
            orderBy: { createdAt: "asc" },
          })
        : [];

    const sourceSchemaFields = await this.getSchemaRows(sourceId);
    const sourceSchemaPresetId = await this.getSessionSchemaPresetId(sourceId);

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

    if (sourceSchemaFields.length > 0) {
      await this.upsertSchemaRows(
        duplicated.id,
        sourceSchemaFields.map((field) => ({
          label: field.label,
          fieldKey: field.fieldKey,
          usualValue: field.usualValue,
          regexRule: field.regexRule,
        })),
      );
    }

    if (sourceSchemaPresetId) {
      await this.setSessionSchemaPresetId(duplicated.id, sourceSchemaPresetId);
    }

    this.logger.log(
      `Duplicated session ${sourceId} -> ${duplicated.id} using strategy=${dto.strategy}`,
    );

    return {
      session: this.toRecord(duplicated),
      documents,
    };
  }

  async rename(id: string, name: string): Promise<SessionRecord> {
    const session = await this.prisma.session.findUnique({ where: { id } });
    if (!session) throw new NotFoundException(`Session ${id} not found`);
    await this.prisma.session.update({ where: { id }, data: { name } });
    return this.findOne(id);
  }

  async updateExtractionModel(
    id: string,
    extractionModel: string,
  ): Promise<SessionRecord> {
    const session = await this.prisma.session.findUnique({ where: { id } });
    if (!session) throw new NotFoundException(`Session ${id} not found`);

    const nextModel = this.allowedExtractionModels.has(extractionModel)
      ? extractionModel
      : "docling";

    await this.prisma.session.update({
      where: { id },
      data: { extractionModel: nextModel },
    });

    if (nextModel !== extractionModel) {
      this.logger.warn(
        `Unsupported extraction model "${extractionModel}" for session ${id}; defaulted to docling`,
      );
    }

    return this.findOne(id);
  }

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

    this.logger.log(`Updated columns for session ${id}; preserved extractedRow`);
    return this.findOne(id);
  }

  async getSchemaFields(id: string): Promise<SessionSchemaFieldDto[]> {
    await this.ensureExists(id);
    const rows = await this.getSchemaRows(id);
    return rows.map((f) => ({
      label: f.label,
      fieldKey: f.fieldKey,
      usualValue: f.usualValue,
      regexRule: f.regexRule,
    }));
  }

  async updateSchemaFields(
    id: string,
    dto: UpdateSessionSchemaFieldsDto,
  ): Promise<SessionSchemaFieldDto[]> {
    await this.ensureExists(id);

    const normalized = dto.fields.map((field) => ({
      label: field.label.trim(),
      fieldKey: field.fieldKey.trim(),
      usualValue: (field.usualValue ?? "").trim(),
      regexRule: (field.regexRule ?? "").trim(),
    }));

    const duplicateKeys = new Set<string>();
    const seen = new Set<string>();
    for (const field of normalized) {
      const key = field.fieldKey.toLowerCase();
      if (seen.has(key)) duplicateKeys.add(field.fieldKey);
      seen.add(key);
    }

    if (duplicateKeys.size > 0) {
      throw new BadRequestException(
        `Duplicate field keys are not allowed: ${Array.from(duplicateKeys).join(", ")}`,
      );
    }

    await this.upsertSchemaRows(id, normalized);

    this.logger.log(`Updated ${normalized.length} schema fields for session ${id}`);
    return this.getSchemaFields(id);
  }

  async listSchemaPresets(): Promise<Array<{ id: string; name: string }>> {
    return this.prisma.$queryRawUnsafe<Array<{ id: string; name: string }>>(
      `SELECT id, name FROM schema_presets ORDER BY name COLLATE NOCASE ASC`,
    );
  }

  async getSchemaPreset(presetId: string): Promise<{
    id: string;
    name: string;
    tabs: Array<{
      name: string;
      fields: SchemaPresetFieldDto[];
    }>;
  }> {
    const preset = await this.prisma.$queryRawUnsafe<
      Array<{ id: string; name: string }>
    >(`SELECT id, name FROM schema_presets WHERE id = ?`, presetId);
    if (preset.length === 0) {
      throw new NotFoundException(`Schema preset ${presetId} not found`);
    }

    const tabs = await this.getSchemaPresetTabs(presetId);
    return {
      id: preset[0].id,
      name: preset[0].name,
      tabs,
    };
  }

  async createSchemaPreset(dto: UpsertSchemaPresetDto) {
    if (!dto.tabs?.length) {
      throw new BadRequestException("Schema preset requires at least one tab.");
    }

    const presetId = uuid();
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `
        INSERT INTO schema_presets (id, name, created_at, updated_at)
        VALUES (?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        `,
        presetId,
        dto.name.trim(),
      );

      await this.writeSchemaPresetTabs(tx, presetId, dto.tabs);
    });

    return this.getSchemaPreset(presetId);
  }

  async updateSchemaPreset(presetId: string, dto: UpsertSchemaPresetDto) {
    if (!dto.tabs?.length) {
      throw new BadRequestException("Schema preset requires at least one tab.");
    }

    await this.getSchemaPreset(presetId);

    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `UPDATE schema_presets SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        dto.name.trim(),
        presetId,
      );

      await tx.$executeRawUnsafe(
        `DELETE FROM schema_preset_tabs WHERE preset_id = ?`,
        presetId,
      );

      await this.writeSchemaPresetTabs(tx, presetId, dto.tabs);
    });

    return this.getSchemaPreset(presetId);
  }

  async deleteSchemaPreset(presetId: string): Promise<void> {
    await this.getSchemaPreset(presetId);
    await this.prisma.$executeRawUnsafe(
      `DELETE FROM schema_presets WHERE id = ?`,
      presetId,
    );
  }

  async getSessionSchemaPreset(id: string) {
    await this.ensureExists(id);
    const presetId = await this.getSessionSchemaPresetId(id);
    if (!presetId) {
      return { schemaPresetId: null, preset: null };
    }

    return {
      schemaPresetId: presetId,
      preset: await this.getSchemaPreset(presetId),
    };
  }

  async assignSessionSchemaPreset(id: string, dto: AssignSessionSchemaPresetDto) {
    await this.ensureExists(id);

    const nextId = dto.schemaPresetId?.trim() || null;
    if (nextId) {
      await this.getSchemaPreset(nextId);
    }

    await this.setSessionSchemaPresetId(id, nextId);
    return this.getSessionSchemaPreset(id);
  }

  async remove(id: string): Promise<void> {
    const session = await this.prisma.session.findUnique({ where: { id } });
    if (!session) throw new NotFoundException(`Session ${id} not found`);

    await this.prisma.session.delete({ where: { id } });
    this.logger.log(`Deleted session ${id} (documents cascade-deleted)`);
  }

  async ingestFiles(
    sessionId: string,
    dto: IngestFilesDto,
  ): Promise<DocumentListItem[]> {
    await this.ensureExists(sessionId);
    await this.prisma.session.update({
      where: { id: sessionId },
      data: { status: "PROCESSING" },
    });

    const docs = await this.documentsService.loadFiles(dto.filePaths, sessionId);
    this.logger.log(`Ingested ${docs.length} files into session ${sessionId}`);
    return docs;
  }

  async ingestFolder(
    sessionId: string,
    dto: IngestFolderDto,
  ): Promise<DocumentListItem[]> {
    await this.ensureExists(sessionId);
    await this.prisma.session.update({
      where: { id: sessionId },
      data: { status: "PROCESSING", sourcePath: dto.folderPath },
    });

    const docs = await this.documentsService.loadFolder(dto.folderPath, sessionId);
    this.logger.log(
      `Ingested ${docs.length} files from folder into session ${sessionId}`,
    );
    return docs;
  }

  async getDocuments(sessionId: string): Promise<DocumentListItem[]> {
    await this.ensureExists(sessionId);
    return this.documentsService.findAll({ sessionId } as any);
  }

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
      documentType: s.documentType ?? "",
      status: s.status,
      extractionModel: s.extractionModel ?? "docling",
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
    } catch {
      this.logger.warn(
        `Failed to copy session asset ${sourcePath} -> ${targetPath}. Reusing source path.`,
      );
      return sourcePath;
    }
  }

  private async getSchemaRows(sessionId: string): Promise<
    Array<{
      label: string;
      fieldKey: string;
      usualValue: string;
      regexRule: string;
    }>
  > {
    const rows = await this.prisma.$queryRawUnsafe<
      Array<{
        label: string;
        field_key: string;
        usual_value: string;
        regex_rule: string;
      }>
    >(
      `
      SELECT label, field_key, usual_value, regex_rule
      FROM session_schema_fields
      WHERE session_id = ?
      ORDER BY sort_order ASC
      `,
      sessionId,
    );

    return rows.map((row) => ({
      label: row.label,
      fieldKey: row.field_key,
      usualValue: row.usual_value,
      regexRule: row.regex_rule,
    }));
  }

  private async upsertSchemaRows(
    sessionId: string,
    fields: Array<{
      label: string;
      fieldKey: string;
      usualValue: string;
      regexRule: string;
    }>,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `DELETE FROM session_schema_fields WHERE session_id = ?`,
        sessionId,
      );

      for (let i = 0; i < fields.length; i += 1) {
        const field = fields[i];
        await tx.$executeRawUnsafe(
          `
          INSERT INTO session_schema_fields
            (id, session_id, sort_order, label, field_key, usual_value, regex_rule, created_at, updated_at)
          VALUES
            (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
          `,
          uuid(),
          sessionId,
          i,
          field.label,
          field.fieldKey,
          field.usualValue,
          field.regexRule,
        );
      }
    });
  }

  private async getSchemaPresetTabs(
    presetId: string,
  ): Promise<Array<{ name: string; fields: SchemaPresetFieldDto[] }>> {
    const tabs = await this.prisma.$queryRawUnsafe<
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

    const fields = await this.prisma.$queryRawUnsafe<
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
      WHERE tab_id IN (
        SELECT id FROM schema_preset_tabs WHERE preset_id = ?
      )
      ORDER BY sort_order ASC
      `,
      presetId,
    );

    const parseJsonArray = (raw: string | null): string[] | undefined => {
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

    return tabs.map((tab) => ({
      name: tab.name,
      fields: fields
        .filter((f) => f.tab_id === tab.id)
        .map((f) => ({
          label: f.label,
          fieldKey: f.field_key,
          regexRule: f.regex_rule,
          extractionStrategy:
            f.extraction_strategy === "regex" ||
            f.extraction_strategy === "table_column" ||
            f.extraction_strategy === "header_field" ||
            f.extraction_strategy === "page_region"
              ? f.extraction_strategy
              : undefined,
          dataType:
            f.data_type === "string" ||
            f.data_type === "currency" ||
            f.data_type === "number" ||
            f.data_type === "date" ||
            f.data_type === "percentage"
              ? f.data_type
              : undefined,
          pageRange: f.page_range ?? undefined,
          postProcessing: parseJsonArray(f.post_processing),
          altRegexRules: parseJsonArray(f.alt_regex_rules),
          sectionHint:
            f.section_hint === "RATES" ||
            f.section_hint === "ORIGIN_ARB" ||
            f.section_hint === "DEST_ARB" ||
            f.section_hint === "HEADER"
              ? f.section_hint
              : undefined,
          contextHint:
            f.context_hint === "same_line_after_label" ||
            f.context_hint === "next_line_after_label" ||
            f.context_hint === "table_cell"
              ? f.context_hint
              : undefined,
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
        })),
    }));
  }

  private async writeSchemaPresetTabs(
    tx: any,
    presetId: string,
    tabs: SchemaPresetTabDto[],
  ): Promise<void> {
    const stringifyArray = (input?: string[] | null) =>
      JSON.stringify((input ?? []).map((s) => String(s).trim()).filter(Boolean));

    for (let tabIndex = 0; tabIndex < tabs.length; tabIndex += 1) {
      const tab = tabs[tabIndex];
      const tabId = uuid();
      await tx.$executeRawUnsafe(
        `
        INSERT INTO schema_preset_tabs
          (id, preset_id, name, sort_order, created_at, updated_at)
        VALUES
          (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        `,
        tabId,
        presetId,
        tab.name.trim(),
        tabIndex,
      );

      const seen = new Set<string>();
      for (let fieldIndex = 0; fieldIndex < tab.fields.length; fieldIndex += 1) {
        const field = tab.fields[fieldIndex];
        const key = field.fieldKey.trim();
        const keyLower = key.toLowerCase();
        if (seen.has(keyLower)) {
          throw new BadRequestException(
            `Duplicate field key in tab "${tab.name}": ${key}`,
          );
        }
        seen.add(keyLower);

        await tx.$executeRawUnsafe(
          `
          INSERT INTO schema_preset_fields
            (id, tab_id, sort_order, label, field_key, regex_rule, extraction_strategy, data_type, page_range,
             post_processing, alt_regex_rules, section_hint, context_hint, context_label, mandatory,
             expected_format, min_length, max_length, allowed_values, created_at, updated_at)
          VALUES
            (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
          `,
          uuid(),
          tabId,
          fieldIndex,
          field.label.trim(),
          key,
          (field.regexRule ?? "").trim(),
          field.extractionStrategy ?? "regex",
          field.dataType ?? null,
          field.pageRange?.trim() || null,
          stringifyArray(field.postProcessing),
          stringifyArray(field.altRegexRules),
          field.sectionHint ?? null,
          field.contextHint ?? null,
          field.contextLabel?.trim() || null,
          field.mandatory ? 1 : 0,
          field.expectedFormat?.trim() || null,
          field.minLength ?? null,
          field.maxLength ?? null,
          stringifyArray(field.allowedValues),
        );
      }
    }
  }

  private async getSessionSchemaPresetId(sessionId: string): Promise<string | null> {
    const rows = await this.prisma.$queryRawUnsafe<
      Array<{ schema_preset_id: string | null }>
    >(`SELECT schema_preset_id FROM sessions WHERE id = ?`, sessionId);

    return rows[0]?.schema_preset_id ?? null;
  }

  private async setSessionSchemaPresetId(
    sessionId: string,
    schemaPresetId: string | null,
  ): Promise<void> {
    await this.prisma.$executeRawUnsafe(
      `UPDATE sessions SET schema_preset_id = ? WHERE id = ?`,
      schemaPresetId,
      sessionId,
    );
  }
}
