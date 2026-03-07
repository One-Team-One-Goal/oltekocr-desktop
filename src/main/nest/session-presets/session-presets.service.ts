import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import {
  CreateSessionPresetDto,
  UpdateSessionPresetDto,
} from "./session-presets.dto";
import type { SessionPresetRecord } from "@shared/types";

@Injectable()
export class SessionPresetsService {
  constructor(private readonly prisma: PrismaService) {}

  private get presetDelegate(): any {
    return (this.prisma as any).sessionPreset;
  }

  async create(dto: CreateSessionPresetDto): Promise<SessionPresetRecord> {
    this.validateColumns(dto.mode, dto.columns);

    const preset = await this.presetDelegate.create({
      data: {
        name: dto.name.trim(),
        mode: dto.mode,
        columns: JSON.stringify(dto.columns ?? []),
      },
    });

    return this.toRecord(preset);
  }

  async findAll(): Promise<SessionPresetRecord[]> {
    const presets = await this.presetDelegate.findMany({
      orderBy: { createdAt: "desc" },
    });
    return presets.map((preset: any) => this.toRecord(preset));
  }

  async findOne(id: string): Promise<SessionPresetRecord> {
    const preset = await this.presetDelegate.findUnique({ where: { id } });
    if (!preset) throw new NotFoundException(`Session preset ${id} not found`);
    return this.toRecord(preset);
  }

  async update(
    id: string,
    dto: UpdateSessionPresetDto,
  ): Promise<SessionPresetRecord> {
    const current = await this.presetDelegate.findUnique({ where: { id } });
    if (!current) throw new NotFoundException(`Session preset ${id} not found`);

    const nextMode = dto.mode ?? (current.mode as "OCR_EXTRACT" | "TABLE_EXTRACT");
    const nextColumns =
      dto.columns ??
      (() => {
        try {
          return JSON.parse(current.columns || "[]");
        } catch {
          return [];
        }
      })();

    this.validateColumns(nextMode, nextColumns);

    const updated = await this.presetDelegate.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.mode !== undefined ? { mode: dto.mode } : {}),
        ...(dto.columns !== undefined
          ? { columns: JSON.stringify(dto.columns) }
          : {}),
      },
    });

    return this.toRecord(updated);
  }

  async remove(id: string): Promise<void> {
    const count = await this.presetDelegate.count({ where: { id } });
    if (count === 0) throw new NotFoundException(`Session preset ${id} not found`);
    await this.presetDelegate.delete({ where: { id } });
  }

  private validateColumns(
    mode: "OCR_EXTRACT" | "TABLE_EXTRACT",
    columns: Array<{ key: string; label: string; question: string }> | undefined,
  ): void {
    if (mode !== "TABLE_EXTRACT") return;
    if (!columns || columns.length === 0) {
      throw new BadRequestException(
        "TABLE_EXTRACT presets require at least one column definition.",
      );
    }
  }

  private toRecord(preset: any): SessionPresetRecord {
    return {
      id: preset.id,
      name: preset.name,
      mode: preset.mode,
      columns: (() => {
        try {
          return JSON.parse(preset.columns || "[]");
        } catch {
          return [];
        }
      })(),
      createdAt: preset.createdAt?.toISOString?.() ?? preset.createdAt,
      updatedAt: preset.updatedAt?.toISOString?.() ?? preset.updatedAt,
    };
  }
}
