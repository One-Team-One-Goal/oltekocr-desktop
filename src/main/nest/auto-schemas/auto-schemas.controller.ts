import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { AutoSchemasService } from "./auto-schemas.service";
import {
  CreateAutoSchemaDto,
  DetectAutoSchemaSectionsDto,
  GenerateAutoSchemaLlmDto,
  GenerateAutoSchemaSectionDraftDto,
} from "./auto-schemas.dto";

@ApiTags("auto-schemas")
@Controller("auto-schemas")
export class AutoSchemasController {
  constructor(private readonly autoSchemasService: AutoSchemasService) {}

  @Get()
  @ApiOperation({ summary: "List auto-schema records" })
  list() {
    return this.autoSchemasService.list();
  }

  @Get(":id")
  @ApiOperation({ summary: "Get auto-schema record by id" })
  getById(@Param("id") id: string) {
    return this.autoSchemasService.getById(id);
  }

  @Post()
  @ApiOperation({ summary: "Store auto-schema output JSON" })
  create(@Body() dto: CreateAutoSchemaDto) {
    return this.autoSchemasService.create(dto);
  }

  @Post(":id/llm-extract")
  @ApiOperation({
    summary:
      "Generate structured schema JSON from stored Docling JSON using LLM",
  })
  generateLlm(@Param("id") id: string, @Body() dto: GenerateAutoSchemaLlmDto) {
    return this.autoSchemasService.generateLlmFromAutoSchema(id, dto);
  }

  @Post(":id/sections")
  @ApiOperation({
    summary: "Detect major section outline from extracted document text",
  })
  detectSections(
    @Param("id") id: string,
    @Body() dto: DetectAutoSchemaSectionsDto,
  ) {
    return this.autoSchemasService.detectSectionsFromAutoSchema(id, dto);
  }

  @Post(":id/section-draft")
  @ApiOperation({
    summary: "Generate schema draft for a single selected section",
  })
  generateSectionDraft(
    @Param("id") id: string,
    @Body() dto: GenerateAutoSchemaSectionDraftDto,
  ) {
    return this.autoSchemasService.generateSectionDraftFromAutoSchema(id, dto);
  }
}
