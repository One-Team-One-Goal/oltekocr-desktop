import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsArray, IsString, IsEnum, IsOptional } from "class-validator";

export class ExportDocumentsDto {
  @ApiProperty({ description: "Document IDs to export", type: [String] })
  @IsArray()
  @IsString({ each: true })
  documentIds!: string[];

  @ApiProperty({ enum: ["excel", "json", "csv"], description: "Export format" })
  @IsString()
  format!: "excel" | "json" | "csv";
}
