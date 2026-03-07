import {
  IsString,
  IsEnum,
  IsOptional,
  IsArray,
  ValidateNested,
  IsNotEmpty,
} from "class-validator";
import { Type } from "class-transformer";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class SessionColumnDto {
  @ApiProperty({ example: "company_name" })
  @IsString()
  @IsNotEmpty()
  key: string;

  @ApiProperty({ example: "Company Name" })
  @IsString()
  @IsNotEmpty()
  label: string;

  @ApiProperty({ example: "What is the company or organization name?" })
  @IsString()
  @IsNotEmpty()
  question: string;
}

export class CreateSessionDto {
  @ApiProperty({ example: "Court Orders Batch 1" })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ enum: ["OCR_EXTRACT", "TABLE_EXTRACT"] })
  @IsEnum(["OCR_EXTRACT", "TABLE_EXTRACT"])
  mode: "OCR_EXTRACT" | "TABLE_EXTRACT";

  @ApiPropertyOptional({ type: [SessionColumnDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SessionColumnDto)
  columns?: SessionColumnDto[];

  @ApiProperty({ enum: ["FILES", "FOLDER"] })
  @IsEnum(["FILES", "FOLDER"])
  sourceType: "FILES" | "FOLDER";

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sourcePath?: string;
}

export class UpdateColumnsDto {
  @ApiProperty({ type: [SessionColumnDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SessionColumnDto)
  columns: SessionColumnDto[];
}

export class RenameSessionDto {
  @ApiProperty({ example: "Court Orders Batch 2" })
  @IsString()
  @IsNotEmpty()
  name: string;
}

export class IngestFilesDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @IsString({ each: true })
  filePaths: string[];
}

export class IngestFolderDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  folderPath: string;
}

export class DuplicateSessionDto {
  @ApiProperty({ enum: ["FULL", "COLUMNS_ONLY"] })
  @IsEnum(["FULL", "COLUMNS_ONLY"])
  strategy: "FULL" | "COLUMNS_ONLY";

  @ApiPropertyOptional({
    description: "Optional target session name. Defaults to '<source> (Copy)'",
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;
}
