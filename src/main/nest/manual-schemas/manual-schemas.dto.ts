import {
  IsArray,
  IsIn,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";

export class ExtractBlocksDto {
  @IsString()
  @IsNotEmpty()
  filePath!: string;
}

export class ConditionOperandDto {
  @IsIn(["column", "context", "static"])
  type!: "column" | "context" | "static";

  @IsString()
  @IsNotEmpty()
  value!: string;
}

export class ConditionRuleDto {
  @ValidateNested()
  @Type(() => ConditionOperandDto)
  left!: ConditionOperandDto;

  @IsIn(["equals", "notEquals", "contains", "gt", "lt"])
  operator!: "equals" | "notEquals" | "contains" | "gt" | "lt";

  @ValidateNested()
  @Type(() => ConditionOperandDto)
  right!: ConditionOperandDto;

  @IsString()
  thenValue!: string;

  @IsString()
  elseValue!: string;
}

export class ManualOutputColumnDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsIn(["column", "context", "conditional", "static", "regex"])
  sourceType!: "column" | "context" | "conditional" | "static" | "regex";

  @IsOptional()
  @IsString()
  sourceKey?: string;

  @IsOptional()
  @IsString()
  staticValue?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => ConditionRuleDto)
  condition?: ConditionRuleDto;

  @IsOptional()
  @IsString()
  regexPattern?: string;

  @IsOptional()
  @IsString()
  regexTarget?: "blocks" | "row" | "context";
}

export class ManualGroupDto {
  @IsString()
  @IsNotEmpty()
  id!: string;

  @IsObject()
  context!: Record<string, string>;

  @IsOptional()
  @IsArray()
  rows?: Record<string, string>[];
}

export class PreviewManualSchemaDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ManualOutputColumnDto)
  outputColumns!: ManualOutputColumnDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ManualGroupDto)
  editedGroups?: ManualGroupDto[];
}

export class SaveManualSchemaDefinitionDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ManualOutputColumnDto)
  outputColumns!: ManualOutputColumnDto[];
}

export class AttachManualSchemaDto {
  @IsString()
  @IsNotEmpty()
  schemaId!: string;
}

export class UpdateManualGroupsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ManualGroupDto)
  groups!: ManualGroupDto[];
}

export class ExportManualSessionDto {
  @IsOptional()
  @IsString()
  schemaId?: string;
}
