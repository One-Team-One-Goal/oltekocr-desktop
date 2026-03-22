import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import {
  CreateContractSchemaDto,
  UpdateContractSchemaDto,
} from "./contract-schemas.dto";

export interface ContractSchemaRecord {
  id: string;
  name: string;
  documentType: string;
  isActive: boolean;
  definitions: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

@Injectable()
export class ContractSchemasService {
  constructor(private readonly prisma: PrismaService) {}

  private get delegate(): any {
    return (this.prisma as any).contractExtractionSchema;
  }

  async create(dto: CreateContractSchemaDto): Promise<ContractSchemaRecord> {
    const documentType = (dto.documentType || "CONTRACT").trim();
    const definitions = dto.definitions ?? {};
    const isActive = Boolean(dto.isActive);

    if (isActive) {
      await this.delegate.updateMany({
        where: { documentType, isActive: true },
        data: { isActive: false },
      });
    }

    const row = await this.delegate.create({
      data: {
        name: dto.name.trim(),
        documentType,
        isActive,
        definitionsJson: JSON.stringify(definitions),
      },
    });

    return this.toRecord(row);
  }

  async findAll(documentType?: string, active?: boolean): Promise<ContractSchemaRecord[]> {
    const rows = await this.delegate.findMany({
      where: {
        ...(documentType ? { documentType } : {}),
        ...(active !== undefined ? { isActive: active } : {}),
      },
      orderBy: [{ isActive: "desc" }, { updatedAt: "desc" }],
    });

    return rows.map((row: any) => this.toRecord(row));
  }

  async findOne(id: string): Promise<ContractSchemaRecord> {
    const row = await this.delegate.findUnique({ where: { id } });
    if (!row) throw new NotFoundException(`Contract schema ${id} not found`);
    return this.toRecord(row);
  }

  async findActive(documentType: string): Promise<ContractSchemaRecord | null> {
    const row = await this.delegate.findFirst({
      where: { documentType, isActive: true },
      orderBy: { updatedAt: "desc" },
    });
    return row ? this.toRecord(row) : null;
  }

  async update(id: string, dto: UpdateContractSchemaDto): Promise<ContractSchemaRecord> {
    const current = await this.delegate.findUnique({ where: { id } });
    if (!current) throw new NotFoundException(`Contract schema ${id} not found`);

    const nextDocumentType = (dto.documentType ?? current.documentType).trim();
    const nextIsActive = dto.isActive ?? current.isActive;

    if (nextIsActive) {
      await this.delegate.updateMany({
        where: {
          documentType: nextDocumentType,
          isActive: true,
          NOT: { id },
        },
        data: { isActive: false },
      });
    }

    const row = await this.delegate.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.documentType !== undefined ? { documentType: nextDocumentType } : {}),
        ...(dto.isActive !== undefined ? { isActive: nextIsActive } : {}),
        ...(dto.definitions !== undefined
          ? { definitionsJson: JSON.stringify(dto.definitions) }
          : {}),
      },
    });

    return this.toRecord(row);
  }

  async activate(id: string): Promise<ContractSchemaRecord> {
    const row = await this.delegate.findUnique({ where: { id } });
    if (!row) throw new NotFoundException(`Contract schema ${id} not found`);

    await this.delegate.updateMany({
      where: { documentType: row.documentType, isActive: true, NOT: { id } },
      data: { isActive: false },
    });

    const activated = await this.delegate.update({
      where: { id },
      data: { isActive: true },
    });

    return this.toRecord(activated);
  }

  async remove(id: string): Promise<void> {
    const count = await this.delegate.count({ where: { id } });
    if (count === 0) throw new NotFoundException(`Contract schema ${id} not found`);
    await this.delegate.delete({ where: { id } });
  }

  private toRecord(row: any): ContractSchemaRecord {
    let definitions: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(row.definitionsJson || "{}");
      if (parsed && typeof parsed === "object") {
        definitions = parsed;
      }
    } catch {
      definitions = {};
    }

    return {
      id: row.id,
      name: row.name,
      documentType: row.documentType,
      isActive: row.isActive,
      definitions,
      createdAt: row.createdAt?.toISOString?.() ?? row.createdAt,
      updatedAt: row.updatedAt?.toISOString?.() ?? row.updatedAt,
    };
  }
}
