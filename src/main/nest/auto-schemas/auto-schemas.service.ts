import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { CreateAutoSchemaDto, GenerateAutoSchemaLlmDto } from "./auto-schemas.dto";
import { AutoSchemaLlmService } from "./auto-schema-llm.service";
import { parsePdfAutomaticExtractorOutput } from "./pdf-automatic-extractor";

@Injectable()
export class AutoSchemasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly autoSchemaLlmService: AutoSchemaLlmService,
  ) {}

  async list() {
    const rows = await (this.prisma as any).autoSchema.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
    });

    return rows.map((row: any) => this.toResponse(row));
  }

  async getById(id: string) {
    const row = await (this.prisma as any).autoSchema.findUnique({
      where: { id },
    });

    if (!row) {
      throw new NotFoundException(`Auto schema ${id} not found`);
    }

    return this.toResponse(row);
  }

  async create(dto: CreateAutoSchemaDto) {
    const created = await (this.prisma as any).autoSchema.create({
      data: {
        name: dto.name,
        documentId: dto.documentId,
        uploadedFileName: dto.uploadedFileName,
        rawJson: JSON.stringify(dto.rawJson ?? {}),
      },
    });

    return this.toResponse(created);
  }

  async generateLlmFromAutoSchema(id: string, dto: GenerateAutoSchemaLlmDto) {
    const row = await (this.prisma as any).autoSchema.findUnique({
      where: { id },
    });

    if (!row) {
      throw new NotFoundException(`Auto schema ${id} not found`);
    }

    const doclingJson = this.tryParse(row.rawJson);
    const llmJson = await this.autoSchemaLlmService.generateStructuredSchema({
      doclingJson,
      model: dto.model,
      baseUrl: dto.baseUrl,
    });

    const parsed = parsePdfAutomaticExtractorOutput(llmJson);

    return {
      autoSchemaId: row.id,
      documentId: row.documentId,
      uploadedFileName: row.uploadedFileName,
      llmJson,
      parsed,
    };
  }

  private toResponse(row: any) {
    return {
      id: row.id,
      name: row.name,
      documentId: row.documentId,
      uploadedFileName: row.uploadedFileName,
      rawJson: this.tryParse(row.rawJson),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      source: "auto_schema",
      isAutoSchema: true,
    };
  }

  private tryParse(value: string) {
    try {
      return JSON.parse(value || "{}");
    } catch {
      return {};
    }
  }
}
