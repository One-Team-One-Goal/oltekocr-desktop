import {
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { SessionColumnDto } from "../sessions/sessions.dto";

export class CreateSessionPresetDto {
  @ApiProperty({ example: "Court Orders Template" })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiProperty({ enum: ["OCR_EXTRACT", "TABLE_EXTRACT"], default: "TABLE_EXTRACT" })
  @IsEnum(["OCR_EXTRACT", "TABLE_EXTRACT"])
  mode!: "OCR_EXTRACT" | "TABLE_EXTRACT";

  @ApiPropertyOptional({ type: [SessionColumnDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SessionColumnDto)
  columns?: SessionColumnDto[];
}

export class UpdateSessionPresetDto {
  @ApiPropertyOptional({ example: "Court Orders Template v2" })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @ApiPropertyOptional({ enum: ["OCR_EXTRACT", "TABLE_EXTRACT"] })
  @IsOptional()
  @IsEnum(["OCR_EXTRACT", "TABLE_EXTRACT"])
  mode?: "OCR_EXTRACT" | "TABLE_EXTRACT";

  @ApiPropertyOptional({ type: [SessionColumnDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SessionColumnDto)
  columns?: SessionColumnDto[];
}
