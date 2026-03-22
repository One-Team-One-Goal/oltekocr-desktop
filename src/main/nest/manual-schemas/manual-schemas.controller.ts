import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import {
  AttachManualSchemaDto,
  CreateManualSchemaDefinitionDto,
  ExtractManualBlocksDto,
  PreviewManualSchemaDto,
  SaveSchemaV2Dto,
  UpdateGroupsV2Dto,
  UpdateManualGroupsDto,
  UpdateSheetsDto,
} from "./manual-schemas.dto";
import { ManualSchemasService } from "./manual-schemas.service";

@ApiTags("manual-schemas")
@Controller("manual-schemas")
export class ManualSchemasController {
  constructor(private readonly manualSchemasService: ManualSchemasService) {}

  // ─── V2 endpoints ────────────────────────────────────────────────────────

  @Post("extract")
  @ApiOperation({ summary: "V2: Extract tables from PDF and group by similarity" })
  extractV2(@Body() dto: ExtractManualBlocksDto) {
    if (!dto.filePath) throw new BadRequestException("filePath is required");
    return this.manualSchemasService.extractV2(dto.filePath);
  }

  @Get("v2/sessions/:id")
  @ApiOperation({ summary: "V2: Get extraction session" })
  getSessionV2(@Param("id") id: string) {
    return this.manualSchemasService.getSessionV2(id);
  }

  @Patch("v2/sessions/:id/groups")
  @ApiOperation({ summary: "V2: Update groups configuration" })
  updateGroupsV2(@Param("id") id: string, @Body() dto: UpdateGroupsV2Dto) {
    return this.manualSchemasService.updateGroupsV2(id, dto);
  }

  @Patch("v2/sessions/:id/sheets")
  @ApiOperation({ summary: "V2: Update sheet assignments" })
  updateSheetsV2(@Param("id") id: string, @Body() dto: UpdateSheetsDto) {
    return this.manualSchemasService.updateSheetsV2(id, dto);
  }

  @Post("v2/sessions/:id/preview")
  @ApiOperation({ summary: "V2: Compute multi-sheet preview" })
  previewV2(@Param("id") id: string) {
    return this.manualSchemasService.previewV2(id);
  }

  @Post("v2/sessions/:id/save")
  @ApiOperation({ summary: "V2: Save current config as a named schema definition" })
  saveSchemaV2(@Param("id") id: string, @Body() dto: SaveSchemaV2Dto) {
    return this.manualSchemasService.saveSchemaV2(id, dto);
  }

  @Post("v2/sessions/:id/export")
  @ApiOperation({ summary: "V2: Export session to Excel (multi-sheet)" })
  exportV2(@Param("id") id: string) {
    return this.manualSchemasService.exportV2(id);
  }

  @Get("v2/definitions")
  @ApiOperation({ summary: "V2: List saved schema definitions" })
  listDefinitionsV2() {
    return this.manualSchemasService.listDefinitionsV2();
  }

  @Get("v2/definitions/:id")
  @ApiOperation({ summary: "V2: Get a schema definition" })
  getDefinitionV2(@Param("id") id: string) {
    return this.manualSchemasService.getDefinitionV2(id);
  }

  @Delete("v2/definitions/:id")
  @ApiOperation({ summary: "V2: Delete a schema definition" })
  deleteDefinitionV2(@Param("id") id: string) {
    return this.manualSchemasService.deleteDefinitionV2(id);
  }

  // ─── Legacy endpoints ─────────────────────────────────────────────────────

  @Post("extract-blocks")
  @ApiOperation({ summary: "Legacy: Extract ordered blocks and table groups from PDF" })
  extractBlocks(@Body() dto: ExtractManualBlocksDto) {
    return this.manualSchemasService.extractBlocks(dto.filePath);
  }

  @Get("sessions/:id")
  @ApiOperation({ summary: "Legacy: Get manual schema session by id" })
  getSession(@Param("id") id: string) {
    return this.manualSchemasService.getSession(id);
  }

  @Patch("sessions/:id/groups")
  @ApiOperation({ summary: "Legacy: Update manual session groups/context" })
  updateGroups(@Param("id") id: string, @Body() dto: UpdateManualGroupsDto) {
    return this.manualSchemasService.updateSessionGroups(id, dto.groups);
  }

  @Post("sessions/:id/preview")
  @ApiOperation({ summary: "Legacy: Compute preview rows for manual schema session" })
  preview(@Param("id") id: string, @Body() dto: PreviewManualSchemaDto) {
    return this.manualSchemasService.preview(id, dto);
  }

  @Get("definitions")
  @ApiOperation({ summary: "Legacy: List manual schema definitions" })
  listDefinitions() {
    return this.manualSchemasService.listDefinitions();
  }

  @Post("definitions")
  @ApiOperation({ summary: "Legacy: Create manual schema definition" })
  saveDefinition(@Body() dto: CreateManualSchemaDefinitionDto) {
    return this.manualSchemasService.saveDefinition(dto);
  }

  @Patch("sessions/:id/schema")
  @ApiOperation({ summary: "Legacy: Attach schema definition to manual session" })
  attachSchema(@Param("id") id: string, @Body() dto: AttachManualSchemaDto) {
    if (!dto.schemaId) throw new BadRequestException("schemaId is required");
    return this.manualSchemasService.attachSchema(id, dto.schemaId);
  }

  @Post("sessions/:id/export")
  @ApiOperation({ summary: "Legacy: Export manual schema session to Excel" })
  exportSession(@Param("id") id: string, @Body() dto: AttachManualSchemaDto) {
    return this.manualSchemasService.exportSession(id, dto.schemaId);
  }
}
