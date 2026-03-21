import {
  IsString,
  IsEnum,
  IsOptional,
  IsArray,
  ValidateNested,
  IsNotEmpty,
  IsBoolean,
  IsNumber,
} from "class-validator";
import { Type } from "class-transformer";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class SessionColumnDto {
  @ApiProperty({ example: "company_name" })
  @IsString()
  @IsNotEmpty()
  key!: string;

  @ApiProperty({ example: "Company Name" })
  @IsString()
  @IsNotEmpty()
  label!: string;

  @ApiProperty({ example: "What is the company or organization name?" })
  @IsString()
  @IsNotEmpty()
  question!: string;
}

export class CreateSessionDto {
  @ApiProperty({ example: "Court Orders Batch 1" })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiProperty({ enum: ["OCR_EXTRACT", "TABLE_EXTRACT", "PDF_EXTRACT", "JSON_EXTRACT"] })
  @IsEnum(["OCR_EXTRACT", "TABLE_EXTRACT", "PDF_EXTRACT", "JSON_EXTRACT"])
  mode!: "OCR_EXTRACT" | "TABLE_EXTRACT" | "PDF_EXTRACT" | "JSON_EXTRACT";

  @ApiPropertyOptional({ type: [SessionColumnDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SessionColumnDto)
  columns?: SessionColumnDto[];

  @ApiProperty({ enum: ["FILES", "FOLDER"] })
  @IsEnum(["FILES", "FOLDER"])
  sourceType!: "FILES" | "FOLDER";

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sourcePath?: string;

  @ApiPropertyOptional({ example: "INVOICE" })
  @IsOptional()
  @IsString()
  documentType?: string;
}

export class UpdateColumnsDto {
  @ApiProperty({ type: [SessionColumnDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SessionColumnDto)
  columns!: SessionColumnDto[];
}

export class RenameSessionDto {
  @ApiProperty({ example: "Court Orders Batch 2" })
  @IsString()
  @IsNotEmpty()
  name!: string;
}

export class IngestFilesDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @IsString({ each: true })
  filePaths!: string[];
}

export class IngestFolderDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  folderPath!: string;
}

export class DuplicateSessionDto {
  @ApiProperty({ enum: ["FULL", "COLUMNS_ONLY"] })
  @IsEnum(["FULL", "COLUMNS_ONLY"])
  strategy!: "FULL" | "COLUMNS_ONLY";

  @ApiPropertyOptional({
    description: "Optional target session name. Defaults to '<source> (Copy)'",
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;
}

export class UpdateExtractionModelDto {
  @ApiProperty({
    example: "docling",
    description:
      'Extraction model ID: "docling" | "pdfplumber" | "pymupdf" | "unstructured"',
  })
  @IsString()
  @IsNotEmpty()
  extractionModel!: string;
}

export class SessionSchemaFieldDto {
  @ApiProperty({ example: "Destination" })
  @IsString()
  @IsNotEmpty()
  label!: string;

  @ApiProperty({ example: "destinationCity" })
  @IsString()
  @IsNotEmpty()
  fieldKey!: string;

  @ApiPropertyOptional({ example: "New York" })
  @IsOptional()
  @IsString()
  usualValue?: string;

  @ApiPropertyOptional({ example: "[A-Za-z]+\\s+[A-Za-z]+" })
  @IsOptional()
  @IsString()
  regexRule?: string;
}

export class UpdateSessionSchemaFieldsDto {
  @ApiProperty({ type: [SessionSchemaFieldDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SessionSchemaFieldDto)
  fields!: SessionSchemaFieldDto[];
}

export class SchemaPresetFieldDto {
  @ApiProperty({ example: "Destination" })
  @IsString()
  @IsNotEmpty()
  label!: string;

  @ApiProperty({ example: "destinationCity" })
  @IsString()
  @IsNotEmpty()
  fieldKey!: string;

  @ApiPropertyOptional({ example: "[A-Za-z]+" })
  @IsOptional()
  @IsString()
  regexRule?: string;

  @ApiPropertyOptional({ enum: ["regex", "table_column", "header_field", "page_region"], example: "regex" })
  @IsOptional()
  @IsEnum(["regex", "table_column", "header_field", "page_region"])
  extractionStrategy?: string;

  @ApiPropertyOptional({ enum: ["string", "currency", "number", "date", "percentage"], example: "string" })
  @IsOptional()
  @IsEnum(["string", "currency", "number", "date", "percentage"])
  dataType?: string;

  @ApiPropertyOptional({ example: "1", description: "Page range e.g. '1', '1-3', '1,5,7'" })
  @IsOptional()
  @IsString()
  pageRange?: string;

  @ApiPropertyOptional({ type: [String], example: ["trim", "uppercase"], description: "Post-processing rules" })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  postProcessing?: string[];

  @ApiPropertyOptional({ type: [String], description: "Alternative regex patterns to try" })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  altRegexRules?: string[];

  @ApiPropertyOptional({ enum: ["RATES", "ORIGIN_ARB", "DEST_ARB", "HEADER"], example: "RATES" })
  @IsOptional()
  @IsEnum(["RATES", "ORIGIN_ARB", "DEST_ARB", "HEADER"])
  sectionHint?: string;

  @ApiPropertyOptional({ enum: ["same_line_after_label", "next_line_after_label", "table_cell"], example: "same_line_after_label" })
  @IsOptional()
  @IsEnum(["same_line_after_label", "next_line_after_label", "table_cell"])
  contextHint?: string;

  @ApiPropertyOptional({ example: "Effective Date:", description: "Label to look for before extracting value" })
  @IsOptional()
  @IsString()
  contextLabel?: string;

  @ApiPropertyOptional({ type: Boolean, example: false })
  @IsOptional()
  @IsBoolean()
  mandatory?: boolean;

  @ApiPropertyOptional({ example: "DD/MM/YYYY", description: "Expected format hint" })
  @IsOptional()
  @IsString()
  expectedFormat?: string;

  @ApiPropertyOptional({ example: 5, description: "Minimum length after extraction" })
  @IsOptional()
  @IsNumber()
  minLength?: number;

  @ApiPropertyOptional({ example: 100, description: "Maximum length after extraction" })
  @IsOptional()
  @IsNumber()
  maxLength?: number;

  @ApiPropertyOptional({ type: [String], example: ["option1", "option2"], description: "Allowed values for enum validation" })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  allowedValues?: string[];
}

export class SchemaPresetTabDto {
  @ApiProperty({ example: "Rates" })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiProperty({ type: [SchemaPresetFieldDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SchemaPresetFieldDto)
  fields!: SchemaPresetFieldDto[];
}

export class UpsertSchemaPresetDto {
  @ApiProperty({ example: "Contracts" })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiProperty({ type: [SchemaPresetTabDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SchemaPresetTabDto)
  tabs!: SchemaPresetTabDto[];
}

export class AssignSessionSchemaPresetDto {
  @ApiPropertyOptional({ example: "preset-id" })
  @IsOptional()
  @IsString()
  schemaPresetId?: string | null;
}
