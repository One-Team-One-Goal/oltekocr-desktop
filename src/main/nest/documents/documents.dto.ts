import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsOptional, IsString, IsArray, IsEnum } from "class-validator";

const STATUSES = [
  "QUEUED",
  "SCANNING",
  "PROCESSING",
  "REVIEW",
  "APPROVED",
  "REJECTED",
  "EXPORTED",
  "ERROR",
] as const;

export class ListDocumentsQueryDto {
  @ApiPropertyOptional({ enum: STATUSES, description: "Filter by status" })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ description: "Search filename or notes" })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ description: "Sort field", default: "createdAt" })
  @IsOptional()
  @IsString()
  sortBy?: string;

  @ApiPropertyOptional({ enum: ["asc", "desc"], default: "desc" })
  @IsOptional()
  @IsString()
  sortOrder?: "asc" | "desc";
}

export class LoadFilesDto {
  @ApiProperty({
    description: "Array of absolute file paths to load",
    type: [String],
  })
  @IsArray()
  @IsString({ each: true })
  filePaths!: string[];
}

export class AnalyzePdfContentDto {
  @ApiProperty({
    description: "Array of absolute PDF file paths to analyze",
    type: [String],
  })
  @IsArray()
  @IsString({ each: true })
  filePaths!: string[];
}

export class ExtractPdfTextDto {
  @ApiProperty({
    description: "Array of absolute PDF file paths to extract text from",
    type: [String],
  })
  @IsArray()
  @IsString({ each: true })
  filePaths!: string[];
}

export class LoadFolderDto {
  @ApiProperty({ description: "Absolute path to folder" })
  @IsString()
  folderPath!: string;
}

export class UpdateDocumentDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  tags?: string[];

  @ApiPropertyOptional({ description: "Edited raw text" })
  @IsOptional()
  @IsString()
  ocrFullText?: string;

  @ApiPropertyOptional({ description: "Edited markdown" })
  @IsOptional()
  @IsString()
  ocrMarkdown?: string;

  @ApiPropertyOptional({ description: "User edits JSON" })
  @IsOptional()
  userEdits?: Record<string, unknown>;

  @ApiPropertyOptional({
    description: "Extracted row overrides (TABLE_EXTRACT)",
  })
  @IsOptional()
  extractedRow?: Record<string, unknown>;

  @ApiPropertyOptional({
    enum: ["IMAGE", "PDF_TEXT", "PDF_IMAGE", "EXCEL"],
    description: "How this file should be processed",
  })
  @IsOptional()
  @IsString()
  extractionType?: string;
}

export class RejectDocumentDto {
  @ApiPropertyOptional({ description: "Reason for rejection" })
  @IsOptional()
  @IsString()
  reason?: string;
}
