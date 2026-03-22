import {
	BadRequestException,
	Injectable,
	Logger,
	NotFoundException,
} from "@nestjs/common";
import { basename, join } from "path";
import { randomUUID } from "crypto";
import { spawn } from "child_process";
import { existsSync } from "fs";
import type {
	ManualGroupDto,
	ManualOutputColumnDto,
	PreviewManualSchemaDto,
	SaveManualSchemaDefinitionDto,
} from "./manual-schemas.dto";
import { SettingsService } from "../settings/settings.service";

type ManualSchemaBlock = {
	id: string;
	page: number;
	y: number;
	type: "text" | "kv_pair" | "table";
	text?: string;
	key?: string;
	value?: string;
	headers?: string[];
	rows?: Record<string, string>[];
};

type ManualSessionRecord = {
	id: string;
	fileName: string;
	filePath: string;
	schemaId: string | null;
	status: "DRAFT" | "READY";
	blocks: ManualSchemaBlock[];
	groups: ManualGroupDto[];
	detectedContextKeys: string[];
	createdAt: string;
	updatedAt: string;
};

type ManualSchemaDefinitionRecord = {
	id: string;
	name: string;
	category: string;
	outputColumns: ManualOutputColumnDto[];
	createdAt: string;
	updatedAt: string;
};

@Injectable()
export class ManualSchemasService {
	private readonly logger = new Logger(ManualSchemasService.name);
	private readonly sessions = new Map<string, ManualSessionRecord>();
	private readonly definitions = new Map<string, ManualSchemaDefinitionRecord>();

	constructor(private readonly settings: SettingsService) {}

	private get scriptPath(): string {
		return join(process.cwd(), "src", "main", "python", "pdf_extract.py");
	}

	private resolvePythonExe(): string {
		const root = process.cwd();
		const localCandidates = [
			join(root, ".venv", "Scripts", "python.exe"),
			join(root, ".venv", "bin", "python"),
		];
		for (const candidate of localCandidates) {
			if (existsSync(candidate)) return candidate;
		}
		const configured = this.settings.getAll().ocr.pythonPath || "python";
		return configured;
	}

	async extractBlocks(filePath: string): Promise<{
		sessionId: string;
		fileName: string;
		blocks: ManualSchemaBlock[];
		groups: ManualGroupDto[];
		detectedContextKeys: string[];
	}> {
		if (!filePath?.trim()) {
			throw new BadRequestException("filePath is required");
		}

		const now = new Date().toISOString();
		const sessionId = randomUUID();
		
		// Extract PDF content using pdf_extract.py
		let blocks: ManualSchemaBlock[] = [];
		
		try {
			const extracted = await this.extractPdfBlocks(filePath);
			blocks = extracted;
		} catch (err: any) {
			this.logger.error(`Failed to extract PDF: ${err?.message || "unknown error"}`);
			throw new BadRequestException(err?.message || "Failed to extract PDF blocks");
		}

		const record: ManualSessionRecord = {
			id: sessionId,
			fileName: basename(filePath),
			filePath,
			schemaId: null,
			status: "READY",
			blocks,
			groups: [],
			detectedContextKeys: [],
			createdAt: now,
			updatedAt: now,
		};
		this.sessions.set(sessionId, record);

		return {
			sessionId,
			fileName: record.fileName,
			blocks: record.blocks,
			groups: record.groups,
			detectedContextKeys: record.detectedContextKeys,
		};
	}

	private extractPdfBlocks(filePath: string): Promise<ManualSchemaBlock[]> {
		return new Promise((resolve, reject) => {
			try {
				const script = this.scriptPath;
				if (!existsSync(script)) {
					reject(new BadRequestException(`PDF extract script not found: ${script}`));
					return;
				}

				const pythonExe = this.resolvePythonExe();
				const timeoutSec = Math.max(this.settings.getAll().ocr.timeout ?? 120, 180);
				this.logger.log(`Extracting PDF blocks from: ${filePath}`);
				
				const child = spawn(pythonExe, [script, "--input", filePath, "--model", "docling"], {
					timeout: timeoutSec * 1000,
					stdio: ["ignore", "pipe", "pipe"],
					windowsHide: true,
				});

				let stdout = "";
				let stderr = "";
				let settled = false;

				child.stdout.on("data", (chunk: Buffer) => {
					stdout += chunk.toString();
				});

				child.stderr.on("data", (chunk: Buffer) => {
					stderr += chunk.toString();
				});

				child.on("error", (err) => {
					if (settled) return;
					settled = true;
					this.logger.error(`Failed to spawn pdf_extract: ${err.message}`);
					reject(new BadRequestException(`Failed to extract PDF: ${err.message}`));
				});

				child.on("close", (code, signal) => {
					if (settled) return;
					settled = true;
					if (code !== 0) {
						this.logger.warn(`pdf_extract exited with code ${String(code)} signal ${String(signal)}`);
						if (stderr) this.logger.debug(`stderr: ${stderr}`);
						if (signal) {
							reject(
								new BadRequestException(
									`PDF extraction terminated by signal ${signal}. The file may be too heavy for current resources or timed out after ${timeoutSec}s.`,
								),
							);
							return;
						}
						reject(new BadRequestException(`PDF extraction failed (exit code ${String(code)})`));
						return;
					}

					try {
						const result = JSON.parse(stdout.trim());
						if (result.error) {
							reject(new BadRequestException(`PDF extraction error: ${result.error}`));
							return;
						}

						const blocks = this.convertExtractedToBlocks(result);
						resolve(blocks);
					} catch (err: any) {
						this.logger.error(`Failed to parse PDF extraction result: ${err.message}`);
						reject(new BadRequestException(`Failed to parse PDF extraction result`));
					}
				});
			} catch (err: any) {
				reject(new BadRequestException(`Failed to extract PDF: ${err.message}`));
			}
		});
	}

	private convertExtractedToBlocks(extracted: any): ManualSchemaBlock[] {
		const blocks: ManualSchemaBlock[] = [];
		let blockIndex = 0;

		// Convert text blocks
		if (Array.isArray(extracted.textBlocks)) {
			for (const textBlock of extracted.textBlocks) {
				blocks.push({
					id: `block_${blockIndex++}`,
					page: textBlock.page || 1,
					y: textBlock.y || 0,
					type: "text",
					text: textBlock.text || "",
				});
			}
		}

		// Convert tables
		if (Array.isArray(extracted.tables)) {
			for (const table of extracted.tables) {
				const headers = this.extractTableHeaders(table);
				const rows = this.extractTableRows(table, headers);

				blocks.push({
					id: `block_${blockIndex++}`,
					page: table.page || 1,
					y: table.y || 0,
					type: "table",
					headers,
					rows,
				});
			}
		}

		// Sort by page then y coordinate
		blocks.sort((a, b) => {
			if (a.page !== b.page) return a.page - b.page;
			return a.y - b.y;
		});

		return blocks;
	}

	private extractTableHeaders(table: any): string[] {
		if (Array.isArray(table.headers)) {
			return table.headers.map((h: any) => String(h).trim()).filter((h: string) => h.length > 0);
		}

		// Fallback: try to parse table structure
		if (Array.isArray(table.cells) && table.cols) {
			const headerCells = table.cells.filter((cell: any) => cell.row === 0);
			const headers: string[] = [];
			for (let c = 0; c < table.cols; c++) {
				const cell = headerCells.find((cell: any) => cell.col === c);
				headers.push(String(cell?.text || `Col${c + 1}`).trim());
			}
			return headers;
		}

		return [];
	}

	private extractTableRows(table: any, headers: string[]): Record<string, string>[] {
		const rows: Record<string, string>[] = [];

		if (!Array.isArray(table.cells) || !table.rows) {
			return rows;
		}

		const rowCount = table.rows;
		const colCount = headers.length || table.cols || 1;

		for (let r = 1; r < rowCount; r++) {
			const row: Record<string, string> = {};
			for (let c = 0; c < colCount; c++) {
				const cell = table.cells.find((cell: any) => cell.row === r && cell.col === c);
				const headerKey = headers[c] || `Col${c + 1}`;
				row[headerKey] = String(cell?.text || "").trim();
			}
			rows.push(row);
		}

		return rows;
	}

	async getSession(id: string): Promise<ManualSessionRecord> {
		return this.requireSession(id);
	}

	async updateSessionGroups(
		id: string,
		groups: ManualGroupDto[],
	): Promise<ManualSessionRecord> {
		const session = this.requireSession(id);
		session.groups = Array.isArray(groups) ? groups : [];
		session.detectedContextKeys = this.collectContextKeys(session.groups);
		session.updatedAt = new Date().toISOString();
		this.sessions.set(id, session);
		return session;
	}

	async preview(
		id: string,
		dto: PreviewManualSchemaDto,
	): Promise<{
		sessionId: string;
		rowCount: number;
		columns: string[];
		rows: Record<string, string>[];
	}> {
		const session = this.requireSession(id);
		const groups = dto.editedGroups ?? session.groups;
		const outputColumns = dto.outputColumns ?? [];

		if (outputColumns.length === 0) {
			throw new BadRequestException("outputColumns is required");
		}

		const rows: Record<string, string>[] = [];

		for (const group of groups) {
			const sourceRows = group.rows && group.rows.length > 0 ? group.rows : [{}];
			for (const sourceRow of sourceRows) {
				const out: Record<string, string> = {};
				for (const col of outputColumns) {
					out[col.name] = this.resolveColumnValue(col, sourceRow, group.context || {}, session.blocks);
				}
				rows.push(out);
			}
		}

		return {
			sessionId: session.id,
			rowCount: rows.length,
			columns: outputColumns.map((c) => c.name),
			rows,
		};
	}

	async attachSchema(
		id: string,
		schemaId: string,
	): Promise<{ sessionId: string; schemaId: string }> {
		const session = this.requireSession(id);
		if (!this.definitions.has(schemaId)) {
			throw new NotFoundException(`Manual schema definition not found: ${schemaId}`);
		}
		session.schemaId = schemaId;
		session.updatedAt = new Date().toISOString();
		this.sessions.set(id, session);
		return { sessionId: id, schemaId };
	}

	async exportSession(
		id: string,
		schemaId?: string,
	): Promise<{ sessionId: string; schemaId: string; rowCount: number; exportPath: string }> {
		const session = this.requireSession(id);
		const resolvedSchemaId = schemaId || session.schemaId;
		if (!resolvedSchemaId) {
			throw new BadRequestException("schemaId is required to export session");
		}
		if (!this.definitions.has(resolvedSchemaId)) {
			throw new NotFoundException(`Manual schema definition not found: ${resolvedSchemaId}`);
		}

		// Manual export persistence is not implemented yet in this in-memory service.
		// Return a stable shape so the API remains compatible until persistence is added.
		return {
			sessionId: session.id,
			schemaId: resolvedSchemaId,
			rowCount: 0,
			exportPath: "",
		};
	}

	async listSchemaDefinitions(): Promise<ManualSchemaDefinitionRecord[]> {
		return Array.from(this.definitions.values()).sort((a, b) =>
			a.name.localeCompare(b.name),
		);
	}

	async saveSchemaDefinition(
		dto: SaveManualSchemaDefinitionDto,
	): Promise<ManualSchemaDefinitionRecord> {
		const now = new Date().toISOString();
		const id = randomUUID();
		const record: ManualSchemaDefinitionRecord = {
			id,
			name: dto.name.trim(),
			category: dto.category?.trim() || "OTHER",
			outputColumns: dto.outputColumns,
			createdAt: now,
			updatedAt: now,
		};
		this.definitions.set(id, record);
		return record;
	}

	private requireSession(id: string): ManualSessionRecord {
		const session = this.sessions.get(id);
		if (!session) {
			throw new NotFoundException(`Manual schema session not found: ${id}`);
		}
		return session;
	}

	private collectContextKeys(groups: ManualGroupDto[]): string[] {
		const keys = new Set<string>();
		for (const group of groups) {
			for (const key of Object.keys(group.context || {})) {
				if (key.trim()) keys.add(key);
			}
		}
		return Array.from(keys).sort((a, b) => a.localeCompare(b));
	}

	private resolveColumnValue(
		col: ManualOutputColumnDto,
		row: Record<string, string>,
		context: Record<string, string>,
		blocks: ManualSchemaBlock[],
	): string {
		if (col.sourceType === "column") {
			return String(row[col.sourceKey || ""] || "");
		}
		if (col.sourceType === "context") {
			return String(context[col.sourceKey || ""] || "");
		}
		if (col.sourceType === "static") {
			return col.staticValue || "";
		}
		if (col.sourceType === "regex") {
			return this.resolveRegexValue(col, row, context, blocks);
		}
		if (col.sourceType === "conditional" && col.condition) {
			return this.evaluateCondition(col.condition, row, context)
				? col.condition.thenValue
				: col.condition.elseValue;
		}
		return "";
	}

	private resolveRegexValue(
		col: ManualOutputColumnDto,
		row: Record<string, string>,
		context: Record<string, string>,
		blocks: ManualSchemaBlock[],
	): string {
		if (!col.regexPattern) return "";

		let target = "";
		if (col.regexTarget === "row") {
			target = Object.values(row || {}).join(" ");
		} else if (col.regexTarget === "context") {
			target = Object.values(context || {}).join(" ");
		} else {
			target = blocks.map((b) => b.text || "").join("\n");
		}

		try {
			const re = new RegExp(col.regexPattern, "i");
			const match = target.match(re);
			if (!match) return "";
			return String(match[1] ?? match[0] ?? "").trim();
		} catch {
			return "";
		}
	}

	private evaluateCondition(
		condition: NonNullable<ManualOutputColumnDto["condition"]>,
		row: Record<string, string>,
		context: Record<string, string>,
	): boolean {
		const left = this.resolveOperand(condition.left, row, context);
		const right = this.resolveOperand(condition.right, row, context);

		if (condition.operator === "equals") return left === right;
		if (condition.operator === "notEquals") return left !== right;
		if (condition.operator === "contains") return left.includes(right);

		const l = Number(left);
		const r = Number(right);
		if (Number.isNaN(l) || Number.isNaN(r)) return false;
		if (condition.operator === "gt") return l > r;
		if (condition.operator === "lt") return l < r;
		return false;
	}

	private resolveOperand(
		operand: { type: "column" | "context" | "static"; value: string },
		row: Record<string, string>,
		context: Record<string, string>,
	): string {
		if (operand.type === "column") return String(row[operand.value] || "");
		if (operand.type === "context") {
			return String(context[operand.value] || "");
		}
		return String(operand.value || "");
	}
}
