import { Body, Controller, Get, Param, Patch, Post } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import {
  AttachManualSchemaDto,
  ExportManualSessionDto,
  ExtractBlocksDto,
  PreviewManualSchemaDto,
  SaveManualSchemaDefinitionDto,
  UpdateManualGroupsDto,
} from "./manual-schemas.dto";
import { ManualSchemasService } from "./manual-schemas.service";

@ApiTags("manual-schemas")
@Controller("manual-schemas")
export class ManualSchemasController {
  constructor(private readonly manualSchemasService: ManualSchemasService) {}

  @Post("extract-blocks")
  @ApiOperation({ summary: "Extract ordered blocks and table groups from PDF" })
  extractBlocks(@Body() dto: ExtractBlocksDto): Promise<any> {
    return this.manualSchemasService.extractBlocks(dto.filePath);
  }

  @Get("sessions/:id")
  @ApiOperation({ summary: "Get a manual schema session" })
  getSession(@Param("id") id: string): Promise<any> {
    return this.manualSchemasService.getSession(id);
  }

  @Patch("sessions/:id/groups")
  @ApiOperation({ summary: "Update manual session groups/context" })
  updateGroups(
    @Param("id") id: string,
    @Body() dto: UpdateManualGroupsDto,
  ): Promise<any> {
    return this.manualSchemasService.updateSessionGroups(id, dto.groups);
  }

  @Post("sessions/:id/preview")
  @ApiOperation({ summary: "Compute preview rows for manual schema session" })
  preview(@Param("id") id: string, @Body() dto: PreviewManualSchemaDto): Promise<any> {
    return this.manualSchemasService.preview(id, dto);
  }

  @Patch("sessions/:id/schema")
  @ApiOperation({ summary: "Attach reusable schema definition to a manual session" })
  attachSchema(
    @Param("id") id: string,
    @Body() dto: AttachManualSchemaDto,
  ): Promise<any> {
    return this.manualSchemasService.attachSchema(id, dto.schemaId);
  }

  @Post("sessions/:id/export")
  @ApiOperation({ summary: "Export manual schema session preview rows to Excel" })
  exportSession(
    @Param("id") id: string,
    @Body() dto: ExportManualSessionDto,
  ): Promise<any> {
    return this.manualSchemasService.exportSession(id, dto.schemaId);
  }

  @Get("definitions")
  @ApiOperation({ summary: "List manual schema definitions" })
  listDefinitions(): Promise<any> {
    return this.manualSchemasService.listSchemaDefinitions();
  }

  @Post("definitions")
  @ApiOperation({ summary: "Save reusable manual schema definition" })
  saveDefinition(@Body() dto: SaveManualSchemaDefinitionDto): Promise<any> {
    return this.manualSchemasService.saveSchemaDefinition(dto);
  }
}
