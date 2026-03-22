import {
  IsArray,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";

// ─── Extract ────────────────────────────────────────────────────────────────
export class ExtractManualBlocksDto {
  @IsString()
  @IsNotEmpty()
  filePath!: string;
}

// ─── Column Config ──────────────────────────────────────────────────────────
export class ColumnComputeConfigDto {
  // copy
  @IsOptional() @IsString() sourceKey?: string;
  // fixed
  @IsOptional() @IsString() value?: string;
  // conditional
  @IsOptional() @IsIn(["column", "context"]) sourceType?: "column" | "context";
  @IsOptional() @IsIn(["equals", "notEquals", "contains", "gt", "lt"]) operator?: string;
  @IsOptional() @IsString() compareValue?: string;
  @IsOptional() @IsString() thenValue?: string;
  @IsOptional() @IsString() elseValue?: string;
  // extract
  @IsOptional() @IsString() preset?: string;
  @IsOptional() @IsString() customPattern?: string;
  // combine
  @IsOptional() @IsArray() sourceKeys?: string[];
  @IsOptional() @IsString() separator?: string;
}

export class ColumnConfigDto {
  @IsString() @IsNotEmpty() key!: string;
  @IsString() label!: string;
  @IsIn(["detected", "computed"]) source!: "detected" | "computed";
  @IsBoolean() included!: boolean;
  @IsIn(["text", "number", "currency", "date_mdy", "date_dmy", "percentage"]) format!: string;
  @IsOptional() @IsString() sampleValue?: string;
  @IsOptional() @IsIn(["copy", "fixed", "conditional", "extract", "combine"]) computeType?: string;
  @IsOptional() @ValidateNested() @Type(() => ColumnComputeConfigDto) computeConfig?: ColumnComputeConfigDto;
}

// ─── Group V2 ───────────────────────────────────────────────────────────────
export class GroupV2Dto {
  @IsString() @IsNotEmpty() id!: string;
  @IsString() name!: string;
  @IsArray() rawTableIds!: string[];
  @IsArray() headers!: string[];
  @IsArray() rows!: Record<string, string>[];
  @IsObject() context!: Record<string, string>;
  @IsNumber() pageStart!: number;
  @IsNumber() pageEnd!: number;
  @IsIn(["exact", "similar", "manual"]) mergeConfidence!: "exact" | "similar" | "manual";
  @IsArray() @ValidateNested({ each: true }) @Type(() => ColumnConfigDto) columns!: ColumnConfigDto[];
}

export class UpdateGroupsV2Dto {
  @IsArray() @ValidateNested({ each: true }) @Type(() => GroupV2Dto) groups!: GroupV2Dto[];
}

// ─── Sheet Config ────────────────────────────────────────────────────────────
export class SheetConfigDto {
  @IsString() @IsNotEmpty() name!: string;
  @IsArray() groupIds!: string[];
  @IsBoolean() includeContext!: boolean;
}

export class UpdateSheetsDto {
  @IsArray() @ValidateNested({ each: true }) @Type(() => SheetConfigDto) sheets!: SheetConfigDto[];
}

// ─── Save Schema ─────────────────────────────────────────────────────────────
export class SaveSchemaV2Dto {
  @IsString() @IsNotEmpty() name!: string;
  @IsOptional() @IsString() category?: string;
}

// ─── Legacy DTOs (kept for backward compat) ──────────────────────────────────
export class ManualGroupDto {
  @IsString() @IsNotEmpty() id!: string;
  @IsArray() headers!: string[];
  @IsArray() rows!: Record<string, string>[];
  @IsObject() context!: Record<string, string>;
  pageStart!: number;
  pageEnd!: number;
}

class ManualConditionOperandDto {
  @IsIn(["column", "context", "static"]) type!: "column" | "context" | "static";
  @IsString() value!: string;
}

class ManualConditionDto {
  @ValidateNested() @Type(() => ManualConditionOperandDto) left!: ManualConditionOperandDto;
  @IsIn(["equals", "notEquals", "contains", "gt", "lt"]) operator!: string;
  @ValidateNested() @Type(() => ManualConditionOperandDto) right!: ManualConditionOperandDto;
  @IsString() thenValue!: string;
  @IsString() elseValue!: string;
}

export class ManualOutputColumnDto {
  @IsString() @IsNotEmpty() name!: string;
  @IsIn(["column", "context", "conditional", "static", "regex"]) sourceType!: string;
  @IsOptional() @IsString() sourceKey?: string;
  @IsOptional() @IsString() staticValue?: string;
  @IsOptional() @ValidateNested() @Type(() => ManualConditionDto) condition?: ManualConditionDto;
  @IsOptional() @IsString() regexPattern?: string;
  @IsOptional() @IsIn(["blocks", "row", "context"]) regexTarget?: string;
}

export class PreviewManualSchemaDto {
  @IsArray() @ValidateNested({ each: true }) @Type(() => ManualOutputColumnDto) outputColumns!: ManualOutputColumnDto[];
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => ManualGroupDto) editedGroups?: ManualGroupDto[];
}

export class UpdateManualGroupsDto {
  @IsArray() @ValidateNested({ each: true }) @Type(() => ManualGroupDto) groups!: ManualGroupDto[];
}

export class CreateManualSchemaDefinitionDto {
  @IsString() @IsNotEmpty() name!: string;
  @IsOptional() @IsString() category?: string;
  @IsOptional() @IsArray() outputColumns?: ManualOutputColumnDto[];
}

export class AttachManualSchemaDto {
  @IsOptional() @IsString() schemaId?: string;
}
