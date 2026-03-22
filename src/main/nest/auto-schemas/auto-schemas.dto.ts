import { IsNotEmpty, IsObject, IsOptional, IsString } from "class-validator";

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
}
