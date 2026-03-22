import { Injectable, NotFoundException, OnModuleInit } from "@nestjs/common";
import { spawn } from "child_process";
import { existsSync } from "fs";
import { join } from "path";
import { v4 as uuid } from "uuid";
import ExcelJS from "exceljs";
import { PrismaService } from "../prisma/prisma.service";
import { getDataPath } from "../../data-dirs";
import {
  ManualGroupDto,
  ManualOutputColumnDto,
  PreviewManualSchemaDto,
  SaveManualSchemaDefinitionDto,
} from "./manual-schemas.dto";

interface ManualBlock {
  id: string;
  type: "kv_pair" | "table" | "paragraph";
  page: number;
  y: number;
  text?: string;
  key?: string;
  value?: string;
  headers?: string[];
  rows?: Record<string, string>[];
}

interface ManualGroup {
  id: string;
  headers: string[];
  rows: Record<string, string>[];
  context: Record<string, string>;
  pageStart: number;
  pageEnd: number;
}

@Injectable()
export class ManualSchemasService implements OnModuleInit {
  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    await this.prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS manual_schema_definitions (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        category TEXT,
        output_columns_json TEXT NOT NULL DEFAULT '[]',
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await this.prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS manual_schema_sessions (
        id TEXT PRIMARY KEY,
        file_name TEXT NOT NULL,
        file_path TEXT NOT NULL,
        schema_id TEXT,
        status TEXT NOT NULL DEFAULT 'building',
        blocks_json TEXT NOT NULL DEFAULT '[]',
        groups_json TEXT NOT NULL DEFAULT '[]',
        detected_context_keys_json TEXT NOT NULL DEFAULT '[]',
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
  }

  async extractBlocks(filePath: string) {
    const sidecar = await this.runBlockExtractor(filePath);
    const grouped = this.groupTables(sidecar.blocks || []);

    const sessionId = uuid();
    const fileName = filePath.split(/[\\/]/).pop() || "document.pdf";

    await this.prisma.$executeRawUnsafe(
      `
      INSERT INTO manual_schema_sessions (
        id,
        file_name,
        file_path,
        status,
        blocks_json,
        groups_json,
        detected_context_keys_json,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, 'building', ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `,
      sessionId,
      fileName,
      filePath,
      JSON.stringify(sidecar.blocks || []),
      JSON.stringify(grouped.groups),
      JSON.stringify(grouped.detectedContextKeys),
    );

    return {
      sessionId,
      fileName,
      blocks: sidecar.blocks || [],
      groups: grouped.groups,
      detectedContextKeys: grouped.detectedContextKeys,
    };
  }

  async getSession(sessionId: string) {
    const row = await this.getSessionRow(sessionId);
    if (!row) throw new NotFoundException(`Manual schema session ${sessionId} not found`);

    return {
      id: row.id,
      fileName: row.file_name,
      filePath: row.file_path,
      schemaId: row.schema_id,
      status: row.status,
      blocks: this.safeJson(row.blocks_json, []),
      groups: this.safeJson(row.groups_json, []),
      detectedContextKeys: this.safeJson(row.detected_context_keys_json, []),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  async updateSessionGroups(sessionId: string, groups: ManualGroupDto[]) {
    const row = await this.getSessionRow(sessionId);
    if (!row) throw new NotFoundException(`Manual schema session ${sessionId} not found`);

    await this.prisma.$executeRawUnsafe(
      `
      UPDATE manual_schema_sessions
      SET groups_json = ?, updated_at = CURRENT_TIMESTAMP, status = 'preview'
      WHERE id = ?
      `,
      JSON.stringify(groups),
      sessionId,
    );

    return this.getSession(sessionId);
  }

  async listSchemaDefinitions() {
    const rows = await this.prisma.$queryRawUnsafe<any[]>(`
      SELECT id, name, category, output_columns_json, created_at, updated_at
      FROM manual_schema_definitions
      ORDER BY created_at DESC
      LIMIT 200
    `);

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      category: row.category || "",
      outputColumns: this.safeJson(row.output_columns_json, []),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  async saveSchemaDefinition(dto: SaveManualSchemaDefinitionDto) {
    const id = uuid();
    await this.prisma.$executeRawUnsafe(
      `
      INSERT INTO manual_schema_definitions (
        id, name, category, output_columns_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `,
      id,
      dto.name,
      dto.category || "",
      JSON.stringify(dto.outputColumns || []),
    );

    return {
      id,
      name: dto.name,
      category: dto.category || "",
      outputColumns: dto.outputColumns,
    };
  }

  async attachSchema(sessionId: string, schemaId: string) {
    const session = await this.getSessionRow(sessionId);
    if (!session) throw new NotFoundException(`Manual schema session ${sessionId} not found`);

    const schemaRows = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT id FROM manual_schema_definitions WHERE id = ? LIMIT 1`,
      schemaId,
    );
    if (schemaRows.length === 0) {
      throw new NotFoundException(`Manual schema definition ${schemaId} not found`);
    }

    await this.prisma.$executeRawUnsafe(
      `UPDATE manual_schema_sessions SET schema_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      schemaId,
      sessionId,
    );

    return this.getSession(sessionId);
  }

  async preview(sessionId: string, dto: PreviewManualSchemaDto) {
    const session = await this.getSession(sessionId);

    const groups = (dto.editedGroups?.length
      ? dto.editedGroups
      : (session.groups as ManualGroup[])) as ManualGroup[];
    const blocks = session.blocks as ManualBlock[];

    const flatRows: Record<string, string>[] = [];

    for (const group of groups) {
      const sourceRows = group.rows || [];
      for (const row of sourceRows) {
        const outputRow: Record<string, string> = {};
        for (const col of dto.outputColumns) {
          outputRow[col.name] = this.computeColumnValue(col, row, group, blocks);
        }
        flatRows.push(outputRow);
      }
    }

    return {
      sessionId,
      rowCount: flatRows.length,
      columns: dto.outputColumns.map((c) => c.name),
      rows: flatRows,
    };
  }

  async exportSession(sessionId: string, explicitSchemaId?: string) {
    const session = await this.getSession(sessionId);
    const schemaId = explicitSchemaId || session.schemaId;
    if (!schemaId) {
      throw new NotFoundException(
        `No schema attached to manual session ${sessionId}`,
      );
    }

    const schemaRows = await this.prisma.$queryRawUnsafe<any[]>(
      `
      SELECT id, name, output_columns_json
      FROM manual_schema_definitions
      WHERE id = ?
      LIMIT 1
      `,
      schemaId,
    );
    if (schemaRows.length === 0) {
      throw new NotFoundException(`Manual schema definition ${schemaId} not found`);
    }

    const outputColumns = this.safeJson<ManualOutputColumnDto[]>(
      schemaRows[0].output_columns_json,
      [],
    );

    const preview = await this.preview(sessionId, {
      outputColumns,
      editedGroups: session.groups as ManualGroup[],
    });

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Manual Schema Export");

    const headers = preview.columns;
    sheet.addRow(headers);
    for (const row of preview.rows) {
      sheet.addRow(headers.map((h) => row[h] ?? ""));
    }

    // Auto-fit based on sampled text lengths.
    headers.forEach((header, idx) => {
      const col = sheet.getColumn(idx + 1);
      let max = String(header).length;
      for (let r = 2; r <= Math.min(sheet.rowCount, 1000); r++) {
        const value = sheet.getRow(r).getCell(idx + 1).value;
        const text = String(value ?? "");
        if (text.length > max) max = text.length;
      }
      col.width = Math.min(80, Math.max(12, max + 2));
    });

    const safeName = (schemaRows[0].name || "manual_schema")
      .replace(/[^a-z0-9_\-]+/gi, "_")
      .replace(/^_+|_+$/g, "")
      .toLowerCase();
    const exportPath = getDataPath(
      "exports",
      `${safeName || "manual_schema"}_${Date.now()}.xlsx`,
    );
    await workbook.xlsx.writeFile(exportPath);

    await this.prisma.$executeRawUnsafe(
      `
      UPDATE manual_schema_sessions
      SET status = 'exported', updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
      `,
      sessionId,
    );

    return {
      sessionId,
      schemaId,
      rowCount: preview.rowCount,
      exportPath,
    };
  }

  private computeColumnValue(
    column: ManualOutputColumnDto,
    row: Record<string, string>,
    group: ManualGroup,
    blocks: ManualBlock[],
  ): string {
    switch (column.sourceType) {
      case "column":
        return String(row[column.sourceKey || ""] ?? "");
      case "context":
        return String(group.context?.[column.sourceKey || ""] ?? "");
      case "static":
        return String(column.staticValue ?? "");
      case "conditional": {
        const condition = column.condition;
        if (!condition) return "";
        const left = this.resolveOperand(condition.left, row, group.context || {});
        const right = this.resolveOperand(condition.right, row, group.context || {});
        const passed = this.evaluateCondition(left, right, condition.operator);
        return passed ? String(condition.thenValue || "") : String(condition.elseValue || "");
      }
      case "regex": {
        const pattern = column.regexPattern || "";
        if (!pattern) return "";
        const target = column.regexTarget || "blocks";
        let haystack = "";
        if (target === "row") {
          haystack = Object.values(row || {}).join(" ");
        } else if (target === "context") {
          haystack = Object.values(group.context || {}).join(" ");
        } else {
          haystack = blocks.map((b) => b.text || "").join("\n");
        }
        try {
          const m = new RegExp(pattern, "i").exec(haystack);
          return m?.[1] ?? m?.[0] ?? "";
        } catch {
          return "";
        }
      }
      default:
        return "";
    }
  }

  private resolveOperand(
    operand: { type: "column" | "context" | "static"; value: string },
    row: Record<string, string>,
    context: Record<string, string>,
  ): string {
    if (operand.type === "column") return String(row[operand.value] ?? "");
    if (operand.type === "context") return String(context[operand.value] ?? "");
    return String(operand.value ?? "");
  }

  private evaluateCondition(left: string, right: string, operator: string): boolean {
    if (operator === "equals") return left === right;
    if (operator === "notEquals") return left !== right;
    if (operator === "contains") return left.toLowerCase().includes(right.toLowerCase());

    const a = Number(left);
    const b = Number(right);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
    if (operator === "gt") return a > b;
    if (operator === "lt") return a < b;
    return false;
  }

  private groupTables(blocks: ManualBlock[]): {
    groups: ManualGroup[];
    detectedContextKeys: string[];
  } {
    const sorted = [...blocks].sort((a, b) => (a.page - b.page) || (a.y - b.y));

    const groups: ManualGroup[] = [];
    const openGroups: Array<{
      signature: string;
      contextSignature: string;
      group: ManualGroup;
    }> = [];

    const detectedContextKeys = new Set<string>();
    let currentContext: Record<string, string> = {};

    for (const block of sorted) {
      if (block.type === "kv_pair") {
        const key = String(block.key || "").trim();
        const value = String(block.value || "").trim();
        if (!key) continue;

        // Reset context when the same key reappears (new logical section).
        if (currentContext[key] !== undefined) {
          currentContext = {};
        }
        currentContext[key] = value;
        detectedContextKeys.add(key);
        continue;
      }

      if (block.type !== "table") continue;

      const headers = block.headers || [];
      const rows = block.rows || [];
      const signature = headers.map((h) => h.trim().toLowerCase()).join("|");
      const contextSnapshot = { ...currentContext };
      const contextSignature = JSON.stringify(contextSnapshot);

      const existing = openGroups.find(
        (g) => g.signature === signature && g.contextSignature === contextSignature,
      );

      if (existing) {
        existing.group.rows.push(...rows);
        existing.group.pageStart = Math.min(existing.group.pageStart, block.page);
        existing.group.pageEnd = Math.max(existing.group.pageEnd, block.page);
      } else {
        const group: ManualGroup = {
          id: uuid(),
          headers,
          rows: [...rows],
          context: contextSnapshot,
          pageStart: block.page,
          pageEnd: block.page,
        };
        groups.push(group);
        openGroups.push({ signature, contextSignature, group });
      }
    }

    return {
      groups,
      detectedContextKeys: Array.from(detectedContextKeys),
    };
  }

  private async runBlockExtractor(filePath: string): Promise<{ blocks: ManualBlock[] }> {
    const pythonExe = this.resolvePythonExe();
    const script = join(process.cwd(), "src", "main", "python", "manual_schema_blocks.py");

    if (!existsSync(script)) {
      throw new NotFoundException(`Manual schema extractor script not found: ${script}`);
    }

    return new Promise((resolve, reject) => {
      const child = spawn(pythonExe, ["-u", script, "--pdf", filePath], {
        windowsHide: true,
        env: { ...process.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" },
      });

      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      child.on("close", () => {
        const jsonStart = stdout.indexOf("{");
        try {
          if (jsonStart < 0) {
            throw new Error("No JSON object in extractor output");
          }
          const parsed = JSON.parse(stdout.slice(jsonStart));
          if (parsed.error) {
            reject(new Error(parsed.error));
            return;
          }
          resolve(parsed);
        } catch (err) {
          reject(
            new Error(
              `Manual schema extractor failed. stderr: ${stderr.slice(0, 800)} stdout: ${stdout.slice(0, 800)}`,
            ),
          );
        }
      });
    });
  }

  private resolvePythonExe(): string {
    const candidates = [
      join(process.cwd(), ".venv", "Scripts", "python.exe"),
      join(process.cwd(), ".venv", "bin", "python"),
    ];

    for (const c of candidates) {
      if (existsSync(c)) return c;
    }

    return "python";
  }

  private safeJson<T>(value: string, fallback: T): T {
    try {
      return (JSON.parse(value || "") as T) ?? fallback;
    } catch {
      return fallback;
    }
  }

  private async getSessionRow(id: string) {
    const rows = await this.prisma.$queryRawUnsafe<any[]>(
      `
      SELECT
        id,
        file_name,
        file_path,
        schema_id,
        status,
        blocks_json,
        groups_json,
        detected_context_keys_json,
        created_at,
        updated_at
      FROM manual_schema_sessions
      WHERE id = ?
      LIMIT 1
      `,
      id,
    );
    return rows[0] ?? null;
  }
}
