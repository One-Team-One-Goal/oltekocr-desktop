import {
  IsBoolean,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
} from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class CreateContractSchemaDto {
  @ApiProperty({ example: "Default Contract Schema" })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiPropertyOptional({ example: "CONTRACT", default: "CONTRACT" })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  documentType?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({
    description: "Extraction schema definition object used by pdf_contract_extract.py",
    type: Object,
  })
  @IsOptional()
  @IsObject()
  definitions?: Record<string, unknown>;
}

export class UpdateContractSchemaDto {
  @ApiPropertyOptional({ example: "Carrier X Contract Schema v2" })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @ApiPropertyOptional({ example: "CONTRACT" })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  documentType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  definitions?: Record<string, unknown>;
}
