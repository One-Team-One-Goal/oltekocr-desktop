import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { randomUUID } from "crypto";
import { PrismaService } from "../prisma/prisma.service";
import {
  CreateAutoSchemaDto,
  DetectAutoSchemaSectionsDto,
  GenerateAutoSchemaLlmDto,
  GenerateAutoSchemaSectionDraftDto,
} from "./auto-schemas.dto";
import { AutoSchemaLlmService } from "./auto-schema-llm.service";
import { parseLlmSchemaOutput } from "./llm-schema-parser";

interface AutoSchemaRow {
  id: string;
  name: string;
  documentId: string;
  uploadedFileName: string;
  rawJson: string;
  llmJson: string;
  schemaJson: string;
  createdAt: Date;
  updatedAt: Date;
}

interface SectionNode {
  id: string;
  token: string;
  title: string;
  level: number;
  confidence: number;
  lineNumber: number;
  pageStart: number | null;
  pageEnd: number | null;
  windowPages: number[];
  children: SectionNode[];
}

interface SourceLine {
  lineNumber: number;
  text: string;
  page: number | null;
}

interface FocusContextSummary {
  strategy: string;
  selectedSections: string[];
  focusedPages: number[];
  focusedLines: number[];
  fullTextChars: number;
  preview: string;
  contextText: string;
  contextTextTruncated: boolean;
}

@Injectable()
export class AutoSchemasService {
  private readonly logger = new Logger(AutoSchemasService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly autoSchemaLlmService: AutoSchemaLlmService,
  ) {}

  private get autoSchemaDelegate(): any | null {
    return (this.prisma as any).autoSchema ?? null;
  }

  private async ensureAutoSchemaTable() {
    await this.prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS auto_schemas (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        document_id TEXT NOT NULL DEFAULT '',
        uploaded_file_name TEXT NOT NULL DEFAULT '',
        raw_json TEXT NOT NULL DEFAULT '{}',
        llm_json TEXT NOT NULL DEFAULT '{}',
        schema_json TEXT NOT NULL DEFAULT '{}',
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await this.prisma.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS auto_schemas_document_id_idx ON auto_schemas(document_id)`,
    );
    await this.prisma.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS auto_schemas_created_at_idx ON auto_schemas(created_at)`,
    );
  }

  private normalizeRow(row: any): AutoSchemaRow {
    return {
      id: String(row.id),
      name: String(row.name ?? ""),
      documentId: String(row.documentId ?? row.document_id ?? ""),
      uploadedFileName: String(
        row.uploadedFileName ?? row.uploaded_file_name ?? "",
      ),
      rawJson: String(row.rawJson ?? row.raw_json ?? "{}"),
      llmJson: String(row.llmJson ?? row.llm_json ?? "{}"),
      schemaJson: String(row.schemaJson ?? row.schema_json ?? "{}"),
      createdAt: new Date(row.createdAt ?? row.created_at ?? Date.now()),
      updatedAt: new Date(row.updatedAt ?? row.updated_at ?? Date.now()),
    };
  }

  private async listRows(): Promise<AutoSchemaRow[]> {
    if (this.autoSchemaDelegate) {
      const rows = await this.autoSchemaDelegate.findMany({
        orderBy: { createdAt: "desc" },
        take: 100,
      });
      return rows.map((row: any) => this.normalizeRow(row));
    }

    await this.ensureAutoSchemaTable();
    const rows = (await this.prisma.$queryRawUnsafe(
      `SELECT id, name, document_id, uploaded_file_name, raw_json, llm_json, schema_json, created_at, updated_at
       FROM auto_schemas
       ORDER BY created_at DESC
       LIMIT 100`,
    )) as any[];
    return rows.map((row) => this.normalizeRow(row));
  }

  private async getRowById(id: string): Promise<AutoSchemaRow | null> {
    if (this.autoSchemaDelegate) {
      const row = await this.autoSchemaDelegate.findUnique({ where: { id } });
      return row ? this.normalizeRow(row) : null;
    }

    await this.ensureAutoSchemaTable();
    const rows = (await this.prisma.$queryRawUnsafe(
      `SELECT id, name, document_id, uploaded_file_name, raw_json, llm_json, schema_json, created_at, updated_at
       FROM auto_schemas
       WHERE id = ?
       LIMIT 1`,
      id,
    )) as any[];
    if (!rows.length) return null;
    return this.normalizeRow(rows[0]);
  }

  private async createRow(dto: CreateAutoSchemaDto): Promise<AutoSchemaRow> {
    if (this.autoSchemaDelegate) {
      const row = await this.autoSchemaDelegate.create({
        data: {
          name: dto.name,
          documentId: dto.documentId,
          uploadedFileName: dto.uploadedFileName,
          rawJson: JSON.stringify(dto.rawJson ?? {}),
          llmJson: JSON.stringify(dto.llmJson ?? {}),
          schemaJson: JSON.stringify(dto.schemaJson ?? {}),
        },
      });
      return this.normalizeRow(row);
    }

    await this.ensureAutoSchemaTable();
    const id = randomUUID();
    const now = new Date().toISOString();
    await this.prisma.$executeRawUnsafe(
      `INSERT INTO auto_schemas
       (id, name, document_id, uploaded_file_name, raw_json, llm_json, schema_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      dto.name,
      dto.documentId,
      dto.uploadedFileName,
      JSON.stringify(dto.rawJson ?? {}),
      JSON.stringify(dto.llmJson ?? {}),
      JSON.stringify(dto.schemaJson ?? {}),
      now,
      now,
    );

    const row = await this.getRowById(id);
    if (!row) {
      throw new NotFoundException(`Auto schema ${id} not found after create`);
    }
    return row;
  }

  private async updateLlmAndSchemaJson(
    id: string,
    llmJson: Record<string, unknown>,
    schemaJson: Record<string, unknown>,
  ): Promise<void> {
    if (this.autoSchemaDelegate) {
      await this.autoSchemaDelegate.update({
        where: { id },
        data: {
          llmJson: JSON.stringify(llmJson ?? {}),
          schemaJson: JSON.stringify(schemaJson ?? {}),
        },
      });
      return;
    }

    await this.ensureAutoSchemaTable();
    await this.prisma.$executeRawUnsafe(
      `UPDATE auto_schemas
       SET llm_json = ?, schema_json = ?, updated_at = ?
       WHERE id = ?`,
      JSON.stringify(llmJson ?? {}),
      JSON.stringify(schemaJson ?? {}),
      new Date().toISOString(),
      id,
    );
  }

  async list() {
    const rows = await this.listRows();

    return rows.map((row: any) => this.toResponse(row));
  }

  async getById(id: string) {
    const row = await this.getRowById(id);

    if (!row) {
      throw new NotFoundException(`Auto schema ${id} not found`);
    }

    return this.toResponse(row);
  }

  async create(dto: CreateAutoSchemaDto) {
    const created = await this.createRow(dto);

    return this.toResponse(created);
  }

  async generateLlmFromAutoSchema(id: string, dto: GenerateAutoSchemaLlmDto) {
    const row = await this.getRowById(id);

    if (!row) {
      throw new NotFoundException(`Auto schema ${id} not found`);
    }

    const sourceJson = this.tryParse(row.rawJson);
    const sectionWindowPages = dto.sectionWindowPages ?? 2;
    const sectionTree = this.detectSectionOutline(sourceJson, 0.45, 300);
    const selectedSectionNodes = this.resolveSelectedSections(
      sectionTree,
      dto.selectedSections || [],
    );

    const focusedJson = selectedSectionNodes.length
      ? this.buildFocusedSourceJson(
          sourceJson,
          selectedSectionNodes,
          sectionWindowPages,
        )
      : sourceJson;

    const selectedSectionLabels = selectedSectionNodes.map((node) =>
      node.token ? `${node.token} ${node.title}` : node.title,
    );

    const llmJson = await this.autoSchemaLlmService.generateStructuredSchema({
      doclingJson: focusedJson,
      model: dto.model,
      baseUrl: dto.baseUrl,
      selectedSections:
        selectedSectionLabels.length > 0
          ? selectedSectionLabels
          : dto.selectedSections,
    });

    const parsed = parseLlmSchemaOutput(llmJson);
    const focusContext = this.summarizeFocusContext(focusedJson);
    this.logFocusContext("llm-extract", row.id, focusContext);

    await this.updateLlmAndSchemaJson(
      row.id,
      llmJson,
      parsed as unknown as Record<string, unknown>,
    );

    return {
      autoSchemaId: row.id,
      documentId: row.documentId,
      uploadedFileName: row.uploadedFileName,
      llmJson,
      parsed,
      focusedPages: this.readFocusedPages(focusedJson),
      focusedSectionCount: selectedSectionNodes.length,
      focusContext,
    };
  }

  async detectSectionsFromAutoSchema(
    id: string,
    dto: DetectAutoSchemaSectionsDto,
  ) {
    const row = await this.getRowById(id);
    if (!row) {
      throw new NotFoundException(`Auto schema ${id} not found`);
    }

    const raw = this.tryParse(row.rawJson);
    const minConfidence = dto.minConfidence ?? 0.55;
    const maxNodes = dto.maxNodes ?? 120;

    const sections = this.detectSectionOutline(raw, minConfidence, maxNodes);

    return {
      autoSchemaId: row.id,
      documentId: row.documentId,
      uploadedFileName: row.uploadedFileName,
      textLength: this.extractSourceText(raw).length,
      sections,
    };
  }

  async generateSectionDraftFromAutoSchema(
    id: string,
    dto: GenerateAutoSchemaSectionDraftDto,
  ) {
    const row = await this.getRowById(id);
    if (!row) {
      throw new NotFoundException(`Auto schema ${id} not found`);
    }

    const sourceJson = this.tryParse(row.rawJson);
    const sectionTree = this.detectSectionOutline(sourceJson, 0.45, 300);
    const targetSection = this.findSectionById(sectionTree, dto.sectionId);
    if (!targetSection) {
      throw new NotFoundException(
        `Section ${dto.sectionId} not found for auto schema ${id}`,
      );
    }

    const sectionWindowPages = dto.sectionWindowPages ?? 2;
    const focusedJson = this.buildFocusedSourceJson(
      sourceJson,
      [targetSection],
      sectionWindowPages,
    );

    const sectionLabel = targetSection.token
      ? `${targetSection.token} ${targetSection.title}`
      : targetSection.title;

    const llmJson = await this.autoSchemaLlmService.generateStructuredSchema({
      doclingJson: focusedJson,
      model: dto.model,
      baseUrl: dto.baseUrl,
      selectedSections: [sectionLabel],
    });

    const parsed = parseLlmSchemaOutput(llmJson);
    const focusContext = this.summarizeFocusContext(focusedJson);
    this.logFocusContext("section-draft", row.id, focusContext);

    return {
      autoSchemaId: row.id,
      documentId: row.documentId,
      uploadedFileName: row.uploadedFileName,
      section: {
        id: targetSection.id,
        token: targetSection.token,
        title: targetSection.title,
        pageStart: targetSection.pageStart,
        pageEnd: targetSection.pageEnd,
      },
      focusedPages: this.readFocusedPages(focusedJson),
      focusContext,
      llmJson,
      parsed,
    };
  }

  private logFocusContext(
    route: "llm-extract" | "section-draft",
    autoSchemaId: string,
    ctx: FocusContextSummary,
  ) {
    const pages = ctx.focusedPages.join(", ");
    const lines = ctx.focusedLines.slice(0, 12).join(", ");
    this.logger.log(
      `[${route}] autoSchema=${autoSchemaId} strategy=${ctx.strategy} chars=${ctx.fullTextChars} pages=[${pages}] lines=[${lines}${ctx.focusedLines.length > 12 ? ", ..." : ""}] sections=${ctx.selectedSections.join(" | ")}`,
    );
    if (ctx.preview) {
      this.logger.log(`[${route}] preview=${ctx.preview}`);
    }
  }

  private summarizeFocusContext(
    focusedJson: Record<string, unknown>,
  ): FocusContextSummary {
    const focus =
      focusedJson.__focus && typeof focusedJson.__focus === "object"
        ? (focusedJson.__focus as Record<string, unknown>)
        : {};

    const strategyRaw = String(focus.focusStrategy || "").trim();
    const strategy = strategyRaw || "page_window";
    const selectedSections = Array.isArray(focus.selectedSections)
      ? focus.selectedSections
          .map((s) => String(s || "").trim())
          .filter((s) => !!s)
      : [];
    const focusedPages = Array.isArray(focus.focusedPages)
      ? focus.focusedPages
          .map((n) => Number(n))
          .filter((n) => Number.isFinite(n))
      : [];
    const focusedLines = Array.isArray(focus.focusedLines)
      ? focus.focusedLines
          .map((n) => Number(n))
          .filter((n) => Number.isFinite(n))
      : [];

    const fullText = String(focusedJson.fullText || focusedJson.markdown || "");
    const preview = fullText.replace(/\s+/g, " ").trim().slice(0, 500);
    const maxContextChars = 8000;
    const contextText = fullText.slice(0, maxContextChars);
    const contextTextTruncated = fullText.length > maxContextChars;

    return {
      strategy,
      selectedSections,
      focusedPages,
      focusedLines,
      fullTextChars: fullText.length,
      preview,
      contextText,
      contextTextTruncated,
    };
  }

  private findSectionById(
    nodes: SectionNode[],
    sectionId: string,
  ): SectionNode | null {
    for (const node of nodes) {
      if (node.id === sectionId) return node;
      if (node.children.length) {
        const hit = this.findSectionById(node.children, sectionId);
        if (hit) return hit;
      }
    }
    return null;
  }

  private readFocusedPages(sourceJson: Record<string, unknown>): number[] {
    const focus = sourceJson.__focus;
    if (!focus || typeof focus !== "object") return [];
    const pages = (focus as Record<string, unknown>).focusedPages;
    if (!Array.isArray(pages)) return [];
    return pages
      .filter((v) => Number.isFinite(Number(v)))
      .map((v) => Number(v));
  }

  private extractSourceText(rawJson: Record<string, unknown>): string {
    const candidates = [
      rawJson.markdown,
      rawJson.fullText,
      rawJson.ocrMarkdown,
      rawJson.ocrFullText,
      rawJson.text,
    ];

    for (const value of candidates) {
      if (typeof value === "string" && value.trim().length > 0) {
        return value;
      }
    }

    return "";
  }

  private extractSourceLines(rawJson: Record<string, unknown>): SourceLine[] {
    const textBlocks = rawJson.textBlocks;
    if (!Array.isArray(textBlocks)) {
      return this.extractSourceText(rawJson)
        .replace(/\r\n/g, "\n")
        .split("\n")
        .map((line, idx) => ({
          lineNumber: idx + 1,
          text: line.trim(),
          page: null,
        }))
        .filter((line) => !!line.text);
    }

    const lines: SourceLine[] = [];
    let nextLineNumber = 1;
    for (const block of textBlocks) {
      if (!block || typeof block !== "object") continue;
      const lineText = String(
        (block as Record<string, unknown>).text || "",
      ).trim();
      if (!lineText) continue;
      const pageRaw = Number((block as Record<string, unknown>).page ?? NaN);
      const page = Number.isFinite(pageRaw) ? pageRaw : null;

      for (const part of lineText.replace(/\r\n/g, "\n").split("\n")) {
        const trimmed = part.trim();
        if (!trimmed) continue;
        lines.push({ lineNumber: nextLineNumber++, text: trimmed, page });
      }
    }

    return lines;
  }

  private buildFocusedSourceJsonByLineWindow(
    rawJson: Record<string, unknown>,
    selectedNodes: SectionNode[],
    effectiveWindowPages: number,
  ): Record<string, unknown> {
    const sourceLines = this.extractSourceLines(rawJson);
    if (!sourceLines.length) {
      return rawJson;
    }

    const linesPerWindow = effectiveWindowPages >= 2 ? 120 : 70;
    const lineNumbers = new Set<number>();

    for (const node of selectedNodes) {
      const center = Math.max(1, Number(node.lineNumber || 1));
      const start = Math.max(1, center - Math.floor(linesPerWindow / 2));
      const end = center + Math.floor(linesPerWindow / 2);
      for (let lineNo = start; lineNo <= end; lineNo++) {
        lineNumbers.add(lineNo);
      }
    }

    if (lineNumbers.size === 0) {
      return rawJson;
    }

    const focusedLines = sourceLines.filter((line) =>
      lineNumbers.has(line.lineNumber),
    );
    const fullText = this.limitText(
      focusedLines.map((line) => line.text).join("\n"),
      24000,
    );

    if (!fullText.trim()) {
      return rawJson;
    }

    return {
      ...rawJson,
      fullText,
      markdown: fullText,
      textBlocks: [
        {
          page: null,
          text: fullText,
        },
      ],
      tables: [],
      __focus: {
        focusedPages: [],
        focusedLines: focusedLines.slice(0, 400).map((line) => line.lineNumber),
        focusStrategy: "line_window",
        sectionWindowPages: effectiveWindowPages,
        selectedSections: selectedNodes.map((node) =>
          node.token ? `${node.token} ${node.title}` : node.title,
        ),
      },
    };
  }

  private detectSectionOutline(
    rawJson: Record<string, unknown>,
    minConfidence: number,
    maxNodes: number,
  ): SectionNode[] {
    const sourceLines = this.extractSourceLines(rawJson);
    if (!sourceLines.length) return [];

    const pageCount = Number(rawJson.pageCount || 0);
    const flatNodes: Array<Omit<SectionNode, "children">> = [];

    for (let idx = 0; idx < sourceLines.length; idx++) {
      const line = sourceLines[idx].text.trim();
      if (!line || line.length < 2 || line.length > 140) continue;

      const candidate = this.parseHeadingCandidate(line);
      if (!candidate) continue;
      if (candidate.confidence < minConfidence) continue;

      const pageStart = sourceLines[idx].page;
      const windowPages: number[] = [];
      if (pageStart && pageStart > 0) {
        const pageCap = pageCount > 0 ? pageCount : pageStart + 1;
        for (let p = pageStart; p <= Math.min(pageCap, pageStart + 1); p++) {
          windowPages.push(p);
        }
      }

      flatNodes.push({
        id: `sec_${idx + 1}`,
        token: candidate.token,
        title: candidate.title,
        level: candidate.level,
        confidence: candidate.confidence,
        lineNumber: idx + 1,
        pageStart,
        pageEnd: pageStart,
        windowPages,
      });

      if (flatNodes.length >= maxNodes) break;
    }

    const roots: SectionNode[] = [];
    const stack: SectionNode[] = [];

    for (const node of flatNodes) {
      const nextNode: SectionNode = { ...node, children: [] };

      while (
        stack.length > 0 &&
        stack[stack.length - 1].level >= nextNode.level
      ) {
        stack.pop();
      }

      const parent = stack[stack.length - 1];
      if (parent) {
        parent.children.push(nextNode);
      } else {
        roots.push(nextNode);
      }

      stack.push(nextNode);
    }

    return roots;
  }

  private normalizeSectionLabel(value: string): string {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  private resolveSelectedSections(
    sectionTree: SectionNode[],
    selectedSections: string[],
  ): SectionNode[] {
    if (!selectedSections.length) return [];
    const wanted = new Set(
      selectedSections.map((s) => this.normalizeSectionLabel(s)),
    );
    const hits: SectionNode[] = [];

    const walk = (nodes: SectionNode[]) => {
      for (const node of nodes) {
        const title = this.normalizeSectionLabel(node.title);
        const full = this.normalizeSectionLabel(
          node.token ? `${node.token} ${node.title}` : node.title,
        );
        if (wanted.has(title) || wanted.has(full)) {
          hits.push(node);
        }
        if (node.children.length) walk(node.children);
      }
    };

    walk(sectionTree);
    return hits;
  }

  private buildFocusedSourceJson(
    rawJson: Record<string, unknown>,
    selectedNodes: SectionNode[],
    sectionWindowPages: number,
  ): Record<string, unknown> {
    const headingPrefixChars = 30;
    const maxStartPageChars = 12000;
    const maxForwardPageChars = 12000;
    const effectiveWindowPages = Math.max(1, Math.min(sectionWindowPages, 2));
    const pageCount = Number(rawJson.pageCount || 0);
    const pageSet = new Set<number>();

    for (const node of selectedNodes) {
      if (!node.pageStart || node.pageStart <= 0) continue;
      const maxPage =
        pageCount > 0 ? pageCount : node.pageStart + effectiveWindowPages - 1;
      for (
        let p = node.pageStart;
        p <= Math.min(maxPage, node.pageStart + effectiveWindowPages - 1);
        p++
      ) {
        pageSet.add(p);
      }
    }

    if (pageSet.size === 0) {
      return this.buildFocusedSourceJsonByLineWindow(
        rawJson,
        selectedNodes,
        effectiveWindowPages,
      );
    }

    const textBlocksRaw = Array.isArray(rawJson.textBlocks)
      ? rawJson.textBlocks
      : [];
    const filteredBlocks = textBlocksRaw.filter((block) => {
      if (!block || typeof block !== "object") return false;
      const page = Number((block as Record<string, unknown>).page ?? NaN);
      return Number.isFinite(page) && pageSet.has(page);
    });

    const pageText = new Map<number, string[]>();
    for (const block of filteredBlocks) {
      const page = Number((block as Record<string, unknown>).page ?? NaN);
      if (!Number.isFinite(page)) continue;
      const text = String((block as Record<string, unknown>).text || "").trim();
      if (!text) continue;
      if (!pageText.has(page)) {
        pageText.set(page, []);
      }
      pageText.get(page)!.push(text);
    }

    const compactByPage = new Map<number, string[]>();

    for (const node of selectedNodes) {
      if (!node.pageStart || node.pageStart <= 0) continue;

      const startPageText = (pageText.get(node.pageStart) || []).join("\n");
      if (startPageText) {
        const headingHints = [
          node.token ? `${node.token} ${node.title}` : "",
          node.title,
        ].filter((v) => !!v);
        const anchoredStart = this.sliceFromHeading(
          startPageText,
          headingHints,
          headingPrefixChars,
          maxStartPageChars,
        );
        if (anchoredStart) {
          if (!compactByPage.has(node.pageStart)) {
            compactByPage.set(node.pageStart, []);
          }
          compactByPage.get(node.pageStart)!.push(anchoredStart);
        }
      }

      const nextPage = node.pageStart + 1;
      if (effectiveWindowPages >= 2 && pageSet.has(nextPage)) {
        const nextPageText = (pageText.get(nextPage) || []).join("\n");
        if (nextPageText) {
          if (!compactByPage.has(nextPage)) {
            compactByPage.set(nextPage, []);
          }
          compactByPage
            .get(nextPage)!
            .push(this.limitText(nextPageText, maxForwardPageChars));
        }
      }
    }

    const compactBlocks = [...compactByPage.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([page, chunks]) => ({
        page,
        text: this.limitText(chunks.filter((c) => !!c).join("\n\n"), 24000),
      }))
      .filter((block) => !!block.text);

    const fullText = compactBlocks.map((b) => b.text).join("\n\n");

    const focusedPages = [...pageSet].sort((a, b) => a - b);

    return {
      ...rawJson,
      fullText,
      markdown: fullText,
      textBlocks: compactBlocks,
      tables: [],
      __focus: {
        focusedPages,
        sectionWindowPages: effectiveWindowPages,
        headingPrefixChars,
        selectedSections: selectedNodes.map((node) =>
          node.token ? `${node.token} ${node.title}` : node.title,
        ),
      },
    };
  }

  private limitText(value: string, maxChars: number): string {
    if (!value) return "";
    if (value.length <= maxChars) return value;
    return `${value.slice(0, maxChars)}\n...[truncated]`;
  }

  private sliceFromHeading(
    pageText: string,
    headingHints: string[],
    prefixChars: number,
    maxChars: number,
  ): string {
    const lower = pageText.toLowerCase();
    let bestIdx = -1;

    for (const rawHint of headingHints) {
      const hint = rawHint.trim().toLowerCase();
      if (!hint) continue;
      const idx = lower.indexOf(hint);
      if (idx >= 0 && (bestIdx < 0 || idx < bestIdx)) {
        bestIdx = idx;
      }
    }

    if (bestIdx < 0) {
      return this.limitText(pageText, maxChars);
    }

    const start = Math.max(0, bestIdx - prefixChars);
    return this.limitText(pageText.slice(start), maxChars);
  }

  private parseHeadingCandidate(line: string): {
    token: string;
    title: string;
    level: number;
    confidence: number;
  } | null {
    const numbered = /^(\d{1,2}(?:-\d+|-[A-Z])?)[.)]?\s*(.+)?$/i.exec(line);
    if (numbered) {
      const token = numbered[1].toUpperCase();
      const rest = (numbered[2] || "").trim();
      const title = rest || token;
      const level = token.includes("-") ? 2 : 1;
      return {
        token,
        title,
        level,
        confidence: this.scoreHeading(token, title, line),
      };
    }

    const alpha = /^([A-Z](?:-[A-Z0-9])?)[.)]\s*(.+)?$/.exec(line);
    if (alpha) {
      const token = alpha[1].toUpperCase();
      const rest = (alpha[2] || "").trim();
      const title = rest || token;
      return {
        token,
        title,
        level: 3,
        confidence: this.scoreHeading(token, title, line),
      };
    }

    const roman = /^([IVXLCDM]{1,6})[.)]\s*(.+)?$/i.exec(line);
    if (roman) {
      const token = roman[1].toUpperCase();
      const rest = (roman[2] || "").trim();
      const title = rest || token;
      return {
        token,
        title,
        level: 2,
        confidence: this.scoreHeading(token, title, line),
      };
    }

    const labelOnly = /^([A-Z][A-Z0-9\s'()\/-]{3,}):$/.exec(line);
    if (labelOnly) {
      const title = labelOnly[1].trim();
      return {
        token: "",
        title,
        level: 1,
        confidence: this.scoreHeading("", title, line),
      };
    }

    return null;
  }

  private scoreHeading(token: string, title: string, rawLine: string): number {
    let score = 0.45;
    if (token) score += 0.2;
    if (rawLine.endsWith(":")) score += 0.1;
    if (title.length <= 90) score += 0.1;

    const letters = rawLine.replace(/[^A-Za-z]/g, "");
    if (letters.length > 0) {
      const uppercase = letters.replace(/[^A-Z]/g, "").length;
      if (uppercase / letters.length >= 0.65) {
        score += 0.1;
      }
    }

    if (/[.!?]$/.test(rawLine) && !rawLine.endsWith(":")) {
      score -= 0.1;
    }

    if (title.length < 3) {
      score -= 0.15;
    }

    return Math.max(0, Math.min(0.99, score));
  }

  private toResponse(row: AutoSchemaRow) {
    return {
      id: row.id,
      name: row.name,
      documentId: row.documentId,
      uploadedFileName: row.uploadedFileName,
      rawJson: this.tryParse(row.rawJson),
      llmJson: this.tryParse(row.llmJson),
      schemaJson: this.tryParse(row.schemaJson),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      source: "auto_schema",
      isAutoSchema: true,
    };
  }

  private tryParse(value: string): Record<string, unknown> {
    try {
      return JSON.parse(value || "{}");
    } catch {
      return {};
    }
  }
}
