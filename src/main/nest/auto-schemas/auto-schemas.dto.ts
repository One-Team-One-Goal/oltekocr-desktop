import {
  IsArray,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
} from "class-validator";

export class CreateAutoSchemaDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsNotEmpty()
  documentId!: string;

  @IsString()
  @IsNotEmpty()
  uploadedFileName!: string;

  @IsObject()
  rawJson!: Record<string, unknown>;

  @IsObject()
  @IsOptional()
  llmJson?: Record<string, unknown>;

  @IsObject()
  @IsOptional()
  schemaJson?: Record<string, unknown>;
}

export class GenerateAutoSchemaLlmDto {
  @IsString()
  @IsOptional()
  model?: string;

  @IsString()
  @IsOptional()
  baseUrl?: string;

  @IsArray()
  @IsOptional()
  selectedSections?: string[];

  @IsNumber()
  @Min(1)
  @Max(5)
  @IsOptional()
  sectionWindowPages?: number;
}

export class DetectAutoSchemaSectionsDto {
  @IsNumber()
  @Min(0)
  @Max(1)
  @IsOptional()
  minConfidence?: number;

  @IsNumber()
  @Min(1)
  @Max(500)
  @IsOptional()
  maxNodes?: number;
}

export class GenerateAutoSchemaSectionDraftDto {
  @IsString()
  @IsNotEmpty()
  sectionId!: string;

  @IsNumber()
  @Min(1)
  @Max(5)
  @IsOptional()
  sectionWindowPages?: number;

  @IsString()
  @IsOptional()
  model?: string;

  @IsString()
  @IsOptional()
  baseUrl?: string;
}
