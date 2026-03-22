import {
  Injectable,
  NotFoundException,
  OnModuleInit,
} from "@nestjs/common";
import { spawn } from "child_process";
import { existsSync } from "fs";
import { join } from "path";
import { v4 as uuid } from "uuid";
import * as ExcelJS from "exceljs";
import { getDataPath } from "../../data-dirs";
import { PrismaService } from "../prisma/prisma.service";
import {
  UpdateGroupsV2Dto,
  UpdateSheetsDto,
  SaveSchemaV2Dto,
  ManualOutputColumnDto,
  ManualGroupDto,
  PreviewManualSchemaDto,
  CreateManualSchemaDefinitionDto,
} from "./manual-schemas.dto";

// ─── Internal types ───────────────────────────────────────────────────────────

type RawBlock = {
  id: string;
  type: "kv_pair" | "table" | "paragraph";
  page: number;
  y: number;
  text?: string;
  key?: string;
  value?: string;
  headers?: string[];
  rows?: Record<string, string>[];
  rawTableIndex?: number;
  sampleRows?: Record<string, string>[];
};

type RawTableInfo = {
  id: string;
  rawIndex: number;
  page: number;
  y: number;
  headers: string[];
  rowCount: number;
  sampleRows: Record<string, string>[];
};

type ColumnConfig = {
  key: string;
  label: string;
  source: "detected" | "computed";
  included: boolean;
  format: string;
  sampleValue: string;
  computeType?: string;
  computeConfig?: Record<string, unknown>;
};

type GroupV2 = {
  id: string;
  name: string;
  rawTableIds: string[];
  headers: string[];
  rows: Record<string, string>[];
  context: Record<string, string>;
  pageStart: number;
  pageEnd: number;
  mergeConfidence: "exact" | "similar" | "manual";
  columns: ColumnConfig[];
};

type SheetConfig = {
  name: string;
  groupIds: string[];
  includeContext: boolean;
};

// ─── Regex extract presets ────────────────────────────────────────────────────

const EXTRACT_PRESETS: Record<string, string> = {
  first_number: "(\\d[\\d,\\.]*)",
  text_before_dash: "^(.*?)\\s*-",
  text_after_colon: ":\\s*(.*)",
  text_in_parens: "\\(([^)]+)\\)",
  last_word: "(\\S+)$",
};

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class ManualSchemasService implements OnModuleInit {
  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    // V2 tables
    await this.prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS msb_sessions (
        id TEXT PRIMARY KEY,
        file_name TEXT NOT NULL,
        file_path TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'extracted',
        raw_tables_json TEXT NOT NULL DEFAULT '[]',
        groups_json TEXT NOT NULL DEFAULT '[]',
        sheets_json TEXT NOT NULL DEFAULT '[]',
        context_keys_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await this.prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS msb_definitions (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT 'OTHER',
        version INTEGER NOT NULL DEFAULT 1,
        groups_config TEXT NOT NULL DEFAULT '[]',
        sheets_config TEXT NOT NULL DEFAULT '[]',
        context_keys TEXT NOT NULL DEFAULT '[]',
        sample_file TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    // Legacy tables kept for backward compat
    await this.prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS manual_schema_sessions (
        id TEXT PRIMARY KEY,
        file_name TEXT NOT NULL,
        file_path TEXT NOT NULL,
        schema_id TEXT,
        status TEXT NOT NULL DEFAULT 'extracted',
        blocks_json TEXT NOT NULL DEFAULT '[]',
        groups_json TEXT NOT NULL DEFAULT '[]',
        detected_context_keys_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await this.prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS manual_schema_definitions (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT 'OTHER',
        output_columns_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
  }

  // ─── V2 API ───────────────────────────────────────────────────────────────

  async extractV2(filePath: string) {
    const extracted = await this.runBlockExtractor(filePath);
    const blocks = extracted.blocks || [];
    const result = this.groupTablesV2(blocks);
    const id = uuid();
    const fileName = filePath.split(/[/\\]/).pop() || filePath;

    const sheets: SheetConfig[] = result.groups.map((g, i) => ({
      name: `Sheet ${i + 1}`,
      groupIds: [g.id],
      includeContext: false,
    }));

    await this.prisma.$executeRawUnsafe(
      `INSERT INTO msb_sessions (id, file_name, file_path, status, raw_tables_json, groups_json, sheets_json, context_keys_json)
       VALUES (?, ?, ?, 'extracted', ?, ?, ?, ?)`,
      id, fileName, filePath,
      JSON.stringify(result.rawTables),
      JSON.stringify(result.groups),
      JSON.stringify(sheets),
      JSON.stringify(result.detectedContextKeys),
    );

    return {
      sessionId: id,
      fileName,
      rawTables: result.rawTables,
      groups: result.groups,
      sheets,
      contextKeys: result.detectedContextKeys,
    };
  }

  async getSessionV2(sessionId: string) {
    const row = await this.getSessionRowV2(sessionId);
    if (!row) throw new NotFoundException(`Session ${sessionId} not found`);
    return this.mapSessionRowV2(row);
  }

  async updateGroupsV2(sessionId: string, dto: UpdateGroupsV2Dto) {
    if (!(await this.getSessionRowV2(sessionId)))
      throw new NotFoundException(`Session ${sessionId} not found`);
    await this.prisma.$executeRawUnsafe(
      `UPDATE msb_sessions SET groups_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      JSON.stringify(dto.groups), sessionId,
    );
    return this.getSessionV2(sessionId);
  }

  async updateSheetsV2(sessionId: string, dto: UpdateSheetsDto) {
    if (!(await this.getSessionRowV2(sessionId)))
      throw new NotFoundException(`Session ${sessionId} not found`);
    await this.prisma.$executeRawUnsafe(
      `UPDATE msb_sessions SET sheets_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      JSON.stringify(dto.sheets), sessionId,
    );
    return this.getSessionV2(sessionId);
  }

  async previewV2(sessionId: string) {
    const session = await this.getSessionV2(sessionId);
    const groups = session.groups as GroupV2[];
    const sheets = session.sheets as SheetConfig[];

    const result = sheets.map((sheet) => {
      const sheetGroups = groups.filter((g) => sheet.groupIds.includes(g.id));
      const { columns, rows, warnings } = this.computeSheetOutput(sheetGroups, sheet.includeContext);
      return { name: sheet.name, columns, rows, rowCount: rows.length, warnings };
    });
    return { sessionId, sheets: result };
  }

  async saveSchemaV2(sessionId: string, dto: SaveSchemaV2Dto) {
    const session = await this.getSessionV2(sessionId);
    const id = uuid();

    await this.prisma.$executeRawUnsafe(
      `INSERT INTO msb_definitions (id, name, category, groups_config, sheets_config, context_keys, sample_file)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      id, dto.name, dto.category || "OTHER",
      session.groupsJson, session.sheetsJson, session.contextKeysJson, session.filePath,
    );
    await this.prisma.$executeRawUnsafe(
      `UPDATE msb_sessions SET status = 'saved', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      sessionId,
    );
    return this.getDefinitionV2(id);
  }

  async listDefinitionsV2() {
    const rows = await this.prisma.$queryRawUnsafe<any[]>(`
      SELECT id, name, category, version, groups_config, sheets_config, context_keys, sample_file, created_at, updated_at
      FROM msb_definitions ORDER BY updated_at DESC
    `);
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      category: r.category,
      version: r.version,
      sheetCount: this.safeJson<SheetConfig[]>(r.sheets_config, []).length,
      groupCount: this.safeJson<GroupV2[]>(r.groups_config, []).length,
      sampleFile: r.sample_file,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  async getDefinitionV2(id: string) {
    const rows = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT id, name, category, version, groups_config, sheets_config, context_keys, sample_file, created_at, updated_at
       FROM msb_definitions WHERE id = ? LIMIT 1`,
      id,
    );
    if (!rows.length) throw new NotFoundException(`Schema definition ${id} not found`);
    const r = rows[0];
    return {
      id: r.id, name: r.name, category: r.category, version: r.version,
      groups: this.safeJson<GroupV2[]>(r.groups_config, []),
      sheets: this.safeJson<SheetConfig[]>(r.sheets_config, []),
      contextKeys: this.safeJson<string[]>(r.context_keys, []),
      sampleFile: r.sample_file, createdAt: r.created_at, updatedAt: r.updated_at,
    };
  }

  async deleteDefinitionV2(id: string) {
    const rows = await this.prisma.$queryRawUnsafe<any[]>(`SELECT id FROM msb_definitions WHERE id = ? LIMIT 1`, id);
    if (!rows.length) throw new NotFoundException(`Schema definition ${id} not found`);
    await this.prisma.$executeRawUnsafe(`DELETE FROM msb_definitions WHERE id = ?`, id);
    return { deleted: id };
  }

  async exportV2(sessionId: string) {
    const preview = await this.previewV2(sessionId);
    const session = await this.getSessionV2(sessionId);
    const workbook = new ExcelJS.Workbook();

    for (const sheet of preview.sheets) {
      if (!sheet.columns.length) continue;
      const ws = workbook.addWorksheet(sheet.name || "Sheet");
      ws.addRow(sheet.columns);
      for (const row of sheet.rows) ws.addRow(sheet.columns.map((c: string) => row[c] ?? ""));
      sheet.columns.forEach((header: string, idx: number) => {
        const col = ws.getColumn(idx + 1);
        let max = String(header).length;
        for (let r = 2; r <= Math.min(ws.rowCount, 1000); r++) {
          const v = String(ws.getRow(r).getCell(idx + 1).value ?? "");
          if (v.length > max) max = v.length;
        }
        col.width = Math.min(80, Math.max(12, max + 2));
      });
    }

    const safeName = session.fileName
      .replace(/\.pdf$/i, "")
      .replace(/[^a-z0-9_\-]+/gi, "_")
      .replace(/^_+|_+$/g, "")
      .toLowerCase();
    const exportPath = getDataPath("exports", `${safeName || "manual"}_${Date.now()}.xlsx`);
    await workbook.xlsx.writeFile(exportPath);
    await this.prisma.$executeRawUnsafe(
      `UPDATE msb_sessions SET status = 'exported', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      sessionId,
    );
    return { sessionId, sheetCount: preview.sheets.length, exportPath };
  }

  // ─── Legacy API ───────────────────────────────────────────────────────────

  async extractBlocks(filePath: string) {
    const extracted = await this.runBlockExtractor(filePath);
    const blocks = extracted.blocks || [];
    const grouped = this.groupTablesLegacy(blocks);
    const id = uuid();
    const fileName = filePath.split(/[/\\]/).pop() || filePath;
    await this.prisma.$executeRawUnsafe(
      `INSERT INTO manual_schema_sessions (id, file_name, file_path, status, blocks_json, groups_json, detected_context_keys_json)
       VALUES (?, ?, ?, 'extracted', ?, ?, ?)`,
      id, fileName, filePath, JSON.stringify(blocks),
      JSON.stringify(grouped.groups), JSON.stringify(grouped.detectedContextKeys),
    );
    return { sessionId: id, fileName, blocks, groups: grouped.groups, detectedContextKeys: grouped.detectedContextKeys };
  }

  async getSession(sessionId: string) {
    const rows = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT * FROM manual_schema_sessions WHERE id = ? LIMIT 1`, sessionId,
    );
    if (!rows.length) throw new NotFoundException(`Session ${sessionId} not found`);
    const row = rows[0];
    return {
      id: row.id, fileName: row.file_name, filePath: row.file_path,
      schemaId: row.schema_id, status: row.status,
      blocks: this.safeJson(row.blocks_json, []),
      groups: this.safeJson(row.groups_json, []),
      detectedContextKeys: this.safeJson(row.detected_context_keys_json, []),
      createdAt: row.created_at, updatedAt: row.updated_at,
    };
  }

  async updateSessionGroups(sessionId: string, groups: ManualGroupDto[]) {
    await this.getSession(sessionId);
    await this.prisma.$executeRawUnsafe(
      `UPDATE manual_schema_sessions SET groups_json = ?, updated_at = CURRENT_TIMESTAMP, status = 'preview' WHERE id = ?`,
      JSON.stringify(groups), sessionId,
    );
    return this.getSession(sessionId);
  }

  async listDefinitions() {
    const rows = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT id, name, category, output_columns_json, created_at, updated_at FROM manual_schema_definitions ORDER BY updated_at DESC`,
    );
    return rows.map((row) => ({
      id: row.id, name: row.name, category: row.category,
      outputColumns: this.safeJson<ManualOutputColumnDto[]>(row.output_columns_json, []),
      createdAt: row.created_at, updatedAt: row.updated_at,
    }));
  }

  async saveDefinition(dto: CreateManualSchemaDefinitionDto) {
    const id = uuid();
    await this.prisma.$executeRawUnsafe(
      `INSERT INTO manual_schema_definitions (id, name, category, output_columns_json) VALUES (?, ?, ?, ?)`,
      id, dto.name, dto.category || "OTHER", JSON.stringify(dto.outputColumns || []),
    );
    const rows = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT * FROM manual_schema_definitions WHERE id = ? LIMIT 1`, id,
    );
    const row = rows[0];
    return {
      id: row.id, name: row.name, category: row.category,
      outputColumns: this.safeJson<ManualOutputColumnDto[]>(row.output_columns_json, []),
      createdAt: row.created_at, updatedAt: row.updated_at,
    };
  }

  async attachSchema(sessionId: string, schemaId: string) {
    await this.getSession(sessionId);
    await this.prisma.$executeRawUnsafe(
      `UPDATE manual_schema_sessions SET schema_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      schemaId, sessionId,
    );
    return this.getSession(sessionId);
  }

  async preview(sessionId: string, dto: PreviewManualSchemaDto) {
    const session = await this.getSession(sessionId);
    const groups = (dto.editedGroups?.length ? dto.editedGroups : session.groups as ManualGroupDto[]) as ManualGroupDto[];
    const blocks = session.blocks as RawBlock[];
    const flatRows: Record<string, string>[] = [];
    for (const group of groups) {
      for (const row of (group.rows || [])) {
        const outputRow: Record<string, string> = {};
        for (const col of dto.outputColumns) outputRow[col.name] = this.computeLegacyColumn(col, row, group, blocks);
        flatRows.push(outputRow);
      }
    }
    return { sessionId, rowCount: flatRows.length, columns: dto.outputColumns.map((c) => c.name), rows: flatRows };
  }

  async exportSession(sessionId: string, explicitSchemaId?: string) {
    const session = await this.getSession(sessionId);
    const schemaId = explicitSchemaId || session.schemaId;
    if (!schemaId) throw new NotFoundException(`No schema attached to session ${sessionId}`);
    const schemaRows = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT id, name, output_columns_json FROM manual_schema_definitions WHERE id = ? LIMIT 1`, schemaId,
    );
    if (!schemaRows.length) throw new NotFoundException(`Schema ${schemaId} not found`);
    const outputColumns = this.safeJson<ManualOutputColumnDto[]>(schemaRows[0].output_columns_json, []);
    const previewResult = await this.preview(sessionId, { outputColumns, editedGroups: session.groups as ManualGroupDto[] });
    const workbook = new ExcelJS.Workbook();
    const ws = workbook.addWorksheet("Manual Schema Export");
    const headers = previewResult.columns;
    ws.addRow(headers);
    for (const row of previewResult.rows) ws.addRow(headers.map((h) => row[h] ?? ""));
    headers.forEach((header, idx) => {
      const col = ws.getColumn(idx + 1);
      let max = String(header).length;
      for (let r = 2; r <= Math.min(ws.rowCount, 1000); r++) {
        const v = String(ws.getRow(r).getCell(idx + 1).value ?? "");
        if (v.length > max) max = v.length;
      }
      col.width = Math.min(80, Math.max(12, max + 2));
    });
    const safeName = (schemaRows[0].name || "manual").replace(/[^a-z0-9_\-]+/gi, "_").toLowerCase();
    const exportPath = getDataPath("exports", `${safeName}_${Date.now()}.xlsx`);
    await workbook.xlsx.writeFile(exportPath);
    await this.prisma.$executeRawUnsafe(
      `UPDATE manual_schema_sessions SET status = 'exported', updated_at = CURRENT_TIMESTAMP WHERE id = ?`, sessionId,
    );
    return { sessionId, schemaId, rowCount: previewResult.rowCount, exportPath };
  }

  // ─── groupTablesV2: Jaccard similarity clustering ─────────────────────────

  private groupTablesV2(blocks: RawBlock[]): { rawTables: RawTableInfo[]; groups: GroupV2[]; detectedContextKeys: string[] } {
    const sorted = [...blocks].sort((a, b) => (a.page - b.page) || (a.y - b.y));
    const detectedContextKeys = new Set<string>();
    let currentContext: Record<string, string> = {};
    const rawTables: RawTableInfo[] = [];
    type RichTable = { id: string; rawIndex: number; page: number; y: number; headers: string[]; rows: Record<string, string>[]; sampleRows: Record<string, string>[]; context: Record<string, string> };
    const richTables: RichTable[] = [];

    for (const block of sorted) {
      if (block.type === "kv_pair") {
        const key = (block.key || "").trim();
        const value = (block.value || "").trim();
        if (!key) continue;
        if (currentContext[key] !== undefined) currentContext = {};
        currentContext[key] = value;
        detectedContextKeys.add(key);
        continue;
      }
      if (block.type !== "table") continue;
      const headers = block.headers || [];
      if (!headers.length) continue;
      const rows = block.rows || [];
      const sampleRows = block.sampleRows || rows.slice(0, 3);
      richTables.push({ id: block.id, rawIndex: block.rawTableIndex ?? rawTables.length, page: block.page, y: block.y, headers, rows, sampleRows, context: { ...currentContext } });
      rawTables.push({ id: block.id, rawIndex: block.rawTableIndex ?? rawTables.length, page: block.page, y: block.y, headers, rowCount: rows.length, sampleRows });
    }

    const THRESHOLD = 0.85;
    const groups: GroupV2[] = [];

    for (const rt of richTables) {
      let bestMatch: { group: GroupV2; score: number } | null = null;
      for (const g of groups) {
        const score = this.jaccardSimilarity(rt.headers, g.headers);
        if (score >= THRESHOLD && (!bestMatch || score > bestMatch.score)) bestMatch = { group: g, score };
      }

      if (bestMatch) {
        const g = bestMatch.group;
        g.rawTableIds.push(rt.id);
        g.rows.push(...rt.rows);
        g.pageStart = Math.min(g.pageStart, rt.page);
        g.pageEnd = Math.max(g.pageEnd, rt.page);
        for (const [k, v] of Object.entries(rt.context)) { if (!g.context[k]) g.context[k] = v; }
        if (bestMatch.score < 1.0) g.mergeConfidence = "similar";
      } else {
        const columns: ColumnConfig[] = rt.headers.map((h) => ({
          key: this.normalizeKey(h), label: h, source: "detected", included: true, format: "text", sampleValue: "",
        }));
        groups.push({
          id: uuid(),
          name: `Table Group ${String.fromCharCode(65 + groups.length)}`,
          rawTableIds: [rt.id], headers: rt.headers, rows: rt.rows,
          context: { ...rt.context }, pageStart: rt.page, pageEnd: rt.page,
          mergeConfidence: "exact", columns,
        });
      }
    }

    groups.forEach((g) => {
      if (g.rawTableIds.length > 1) g.name += ` (${g.rawTableIds.length} merged)`;
    });
    return { rawTables, groups, detectedContextKeys: Array.from(detectedContextKeys) };
  }

  // ─── Sheet / column compute ───────────────────────────────────────────────

  private computeSheetOutput(groups: GroupV2[], includeContext: boolean): { columns: string[]; rows: Record<string, string>[]; warnings: string[] } {
    const columnSet = new Set<string>();
    for (const g of groups) for (const c of (g.columns || [])) { if (c.included) columnSet.add(c.label); }
    const columns = Array.from(columnSet);
    const allRows: Record<string, string>[] = [];

    for (const g of groups) {
      if (includeContext && Object.keys(g.context || {}).length > 0) {
        const ctxRow: Record<string, string> = {};
        for (const c of columns) ctxRow[c] = "";
        if (columns[0]) ctxRow[columns[0]] = Object.entries(g.context).map(([k, v]) => `${k}: ${v}`).join(" | ");
        allRows.push(ctxRow);
      }
      for (const srcRow of (g.rows || [])) {
        const out: Record<string, string> = {};
        for (const c of columns) out[c] = "";
        for (const col of (g.columns || [])) {
          if (col.included) out[col.label] = this.computeV2Column(col, srcRow, g.context || {});
        }
        allRows.push(out);
      }
    }
    return { columns, rows: allRows, warnings: [] };
  }

  private computeV2Column(col: ColumnConfig, row: Record<string, string>, context: Record<string, string>): string {
    if (col.source === "detected") return String(row[col.key] ?? row[col.label] ?? "");
    const cfg = (col.computeConfig || {}) as Record<string, any>;
    switch (col.computeType) {
      case "copy": return String(row[cfg.sourceKey] ?? "");
      case "fixed": return String(cfg.value ?? "");
      case "conditional": {
        const left = cfg.sourceType === "context" ? String(context[cfg.sourceKey] ?? "") : String(row[cfg.sourceKey] ?? "");
        return this.evalOperator(left, String(cfg.compareValue ?? ""), cfg.operator || "equals")
          ? String(cfg.thenValue ?? "") : String(cfg.elseValue ?? "");
      }
      case "extract": {
        const src = String(row[cfg.sourceKey] ?? "");
        const pat = cfg.preset === "custom" ? (cfg.customPattern || "") : (EXTRACT_PRESETS[cfg.preset as string] || "");
        if (!pat) return src;
        try { const m = new RegExp(pat, "i").exec(src); return m?.[1] ?? m?.[0] ?? ""; } catch { return ""; }
      }
      case "combine": {
        const keys: string[] = Array.isArray(cfg.sourceKeys) ? cfg.sourceKeys : [];
        return keys.map((k) => String(row[k] ?? "")).filter(Boolean).join(String(cfg.separator ?? " "));
      }
      default: return "";
    }
  }

  private evalOperator(left: string, right: string, op: string): boolean {
    if (op === "equals") return left === right;
    if (op === "notEquals") return left !== right;
    if (op === "contains") return left.toLowerCase().includes(right.toLowerCase());
    const a = Number(left); const b = Number(right);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
    if (op === "gt") return a > b;
    if (op === "lt") return a < b;
    return false;
  }

  // ─── Similarity helpers ───────────────────────────────────────────────────

  private jaccardSimilarity(a: string[], b: string[]): number {
    const setA = new Set(a.map((h) => this.normalizeHeader(h)));
    const setB = new Set(b.map((h) => this.normalizeHeader(h)));
    const intersection = [...setA].filter((x) => setB.has(x)).length;
    const union = new Set([...setA, ...setB]).size;
    return union === 0 ? 1.0 : intersection / union;
  }

  private normalizeHeader(h: string): string {
    return h.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
  }

  private normalizeKey(h: string): string {
    return h.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "column";
  }

  private async getSessionRowV2(id: string) {
    const rows = await this.prisma.$queryRawUnsafe<any[]>(`SELECT * FROM msb_sessions WHERE id = ? LIMIT 1`, id);
    return rows.length ? rows[0] : null;
  }

  private mapSessionRowV2(row: any) {
    return {
      id: row.id,
      fileName: row.file_name,
      filePath: row.file_path,
      status: row.status,
      rawTables: this.safeJson<RawTableInfo[]>(row.raw_tables_json, []),
      groups: this.safeJson<GroupV2[]>(row.groups_json, []),
      sheets: this.safeJson<SheetConfig[]>(row.sheets_json, []),
      contextKeys: this.safeJson<string[]>(row.context_keys_json, []),
      groupsJson: row.groups_json,
      sheetsJson: row.sheets_json,
      contextKeysJson: row.context_keys_json,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  // ─── Legacy helpers ───────────────────────────────────────────────────────

  private groupTablesLegacy(blocks: RawBlock[]): { groups: any[]; detectedContextKeys: string[] } {
    const sorted = [...blocks].sort((a, b) => (a.page - b.page) || (a.y - b.y));
    const groups: any[] = [];
    const openGroups: { sig: string; group: any }[] = [];
    const detectedContextKeys = new Set<string>();
    let ctx: Record<string, string> = {};
    for (const block of sorted) {
      if (block.type === "kv_pair") {
        const k = (block.key || "").trim(); const v = (block.value || "").trim();
        if (!k) continue;
        if (ctx[k] !== undefined) ctx = {};
        ctx[k] = v;
        detectedContextKeys.add(k);
        continue;
      }
      if (block.type !== "table") continue;
      const headers = block.headers || []; const rows = block.rows || [];
      const sig = headers.map((h) => h.trim().toLowerCase()).join("|");
      const existing = openGroups.find((g) => g.sig === sig);
      if (existing) {
        existing.group.rows.push(...rows);
        existing.group.pageStart = Math.min(existing.group.pageStart, block.page);
        existing.group.pageEnd = Math.max(existing.group.pageEnd, block.page);
      } else {
        const g = { id: uuid(), headers, rows: [...rows], context: { ...ctx }, pageStart: block.page, pageEnd: block.page };
        groups.push(g);
        openGroups.push({ sig, group: g });
      }
    }
    return { groups, detectedContextKeys: Array.from(detectedContextKeys) };
  }

  private computeLegacyColumn(col: ManualOutputColumnDto, row: Record<string, string>, group: ManualGroupDto, blocks: RawBlock[]): string {
    switch (col.sourceType) {
      case "column": return String(row[col.sourceKey || ""] ?? "");
      case "context": return String(group.context?.[col.sourceKey || ""] ?? "");
      case "static": return String(col.staticValue ?? "");
      case "conditional": {
        const cond = col.condition; if (!cond) return "";
        const resolveOperand = (o: { type: string; value: string }) =>
          o.type === "column" ? String(row[o.value] ?? "") : o.type === "context" ? String(group.context?.[o.value] ?? "") : String(o.value);
        const left = resolveOperand(cond.left); const right = resolveOperand(cond.right);
        return this.evalOperator(left, right, cond.operator) ? String(cond.thenValue || "") : String(cond.elseValue || "");
      }
      case "regex": {
        const pat = col.regexPattern || ""; if (!pat) return "";
        const target = col.regexTarget || "blocks";
        const haystack = target === "row" ? Object.values(row || {}).join(" ")
          : target === "context" ? Object.values(group.context || {}).join(" ")
          : blocks.map((b) => b.type === "kv_pair" ? `${b.key}: ${b.value}` : b.type === "table" ? JSON.stringify(b.rows || []) : (b.text || "")).join("\n");
        try { const m = new RegExp(pat, "i").exec(haystack); return m?.[1] ?? m?.[0] ?? ""; } catch { return ""; }
      }
      default: return "";
    }
  }

  // ─── Block extractor ──────────────────────────────────────────────────────

  private async runBlockExtractor(filePath: string): Promise<{ blocks: RawBlock[] }> {
    const pythonExe = this.resolvePythonExe();
    const script = join(process.cwd(), "src", "main", "python", "manual_schema_blocks.py");
    if (!existsSync(script)) throw new Error(`manual_schema_blocks.py not found at ${script}`);

    return new Promise((resolve, reject) => {
      const child = spawn(pythonExe, [script, "--input", filePath], {
        cwd: process.cwd(),
        env: { ...process.env, PYTHONIOENCODING: "utf-8" },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = ""; let stderr = "";
      child.stdout.on("data", (c) => { stdout += c.toString(); });
      child.stderr.on("data", (c) => { stderr += c.toString(); });
      child.on("error", (err) => reject(err));
      child.on("close", (code) => {
        const trimmed = stdout.trim();
        if (code !== 0) {
          let detail = "";
          try { const p = JSON.parse(trimmed); if (p.error) detail = p.error; } catch { /* ignore */ }
          reject(new Error(`Block extractor failed (${code}): ${detail || stderr || "Unknown error"}`));
          return;
        }
        try {
          const parsed = JSON.parse(trimmed || "{}");
          if (parsed.error) { reject(new Error(String(parsed.error))); return; }
          resolve({ blocks: Array.isArray(parsed.blocks) ? parsed.blocks : [] });
        } catch (err: any) {
          reject(new Error(`Failed to parse extractor output: ${String(err?.message || err)}`));
        }
      });
    });
  }

  private resolvePythonExe(): string {
    const venvPy = join(process.cwd(), ".venv", "Scripts", "python.exe");
    if (existsSync(venvPy)) return venvPy;
    const envPy = join(process.cwd(), "env", "Scripts", "python.exe");
    if (existsSync(envPy)) return envPy;
    return "python";
  }

  private safeJson<T>(value: string, fallback: T): T {
    try { return JSON.parse(value || "") as T; } catch { return fallback; }
  }
}
