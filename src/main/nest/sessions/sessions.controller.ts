import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import { ApiTags, ApiOperation } from "@nestjs/swagger";
import { SessionsService } from "./sessions.service";
import {
  AssignSessionSchemaPresetDto,
  CreateSessionDto,
  DuplicateSessionDto,
  IngestFilesDto,
  IngestFolderDto,
  UpsertSchemaPresetDto,
  UpdateColumnsDto,
  RenameSessionDto,
  UpdateExtractionModelDto,
  UpdateSessionSchemaFieldsDto,
} from "./sessions.dto";

@ApiTags("sessions")
@Controller("sessions")
export class SessionsController {
  constructor(private readonly sessionsService: SessionsService) {}

  @Post()
  @ApiOperation({ summary: "Create a new session" })
  create(@Body() dto: CreateSessionDto) {
    return this.sessionsService.create(dto);
  }

  @Get()
  @ApiOperation({ summary: "List all sessions" })
  findAll() {
    return this.sessionsService.findAll();
  }

  @Get("schema-presets")
  @ApiOperation({ summary: "List all global schema presets" })
  listSchemaPresets() {
    return this.sessionsService.listSchemaPresets();
  }

  @Get("schema-presets/:presetId")
  @ApiOperation({ summary: "Get a global schema preset" })
  getSchemaPreset(@Param("presetId") presetId: string) {
    return this.sessionsService.getSchemaPreset(presetId);
  }

  @Post("schema-presets")
  @ApiOperation({ summary: "Create a global schema preset" })
  createSchemaPreset(@Body() dto: UpsertSchemaPresetDto) {
    return this.sessionsService.createSchemaPreset(dto);
  }

  @Patch("schema-presets/:presetId")
  @ApiOperation({ summary: "Update a global schema preset" })
  updateSchemaPreset(
    @Param("presetId") presetId: string,
    @Body() dto: UpsertSchemaPresetDto,
  ) {
    return this.sessionsService.updateSchemaPreset(presetId, dto);
  }

  @Delete("schema-presets/:presetId")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Delete a global schema preset" })
  deleteSchemaPreset(@Param("presetId") presetId: string) {
    return this.sessionsService.deleteSchemaPreset(presetId);
  }

  @Get(":id")
  @ApiOperation({ summary: "Get a session by ID" })
  findOne(@Param("id") id: string) {
    return this.sessionsService.findOne(id);
  }

  @Post(":id/duplicate")
  @ApiOperation({
    summary:
      "Duplicate a session: columns only, or full duplicate including current files",
  })
  duplicate(@Param("id") id: string, @Body() dto: DuplicateSessionDto) {
    return this.sessionsService.duplicate(id, dto);
  }

  @Patch(":id/columns")
  @ApiOperation({
    summary:
      "Update session columns (TABLE_EXTRACT only) and clear extracted data",
  })
  updateColumns(@Param("id") id: string, @Body() dto: UpdateColumnsDto) {
    return this.sessionsService.updateColumns(id, dto);
  }

  @Patch(":id/rename")
  @ApiOperation({ summary: "Rename a session" })
  rename(@Param("id") id: string, @Body() dto: RenameSessionDto) {
    return this.sessionsService.rename(id, dto.name);
  }

  @Patch(":id/extraction-model")
  @ApiOperation({ summary: "Change the extraction model for a session" })
  updateExtractionModel(
    @Param("id") id: string,
    @Body() dto: UpdateExtractionModelDto,
  ) {
    return this.sessionsService.updateExtractionModel(id, dto.extractionModel);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Delete a session and all its documents" })
  remove(@Param("id") id: string) {
    return this.sessionsService.remove(id);
  }

  @Post(":id/ingest/files")
  @ApiOperation({ summary: "Add files to a session" })
  ingestFiles(@Param("id") id: string, @Body() dto: IngestFilesDto) {
    return this.sessionsService.ingestFiles(id, dto);
  }

  @Post(":id/ingest/folder")
  @ApiOperation({ summary: "Add a folder of files to a session" })
  ingestFolder(@Param("id") id: string, @Body() dto: IngestFolderDto) {
    return this.sessionsService.ingestFolder(id, dto);
  }

  @Get(":id/documents")
  @ApiOperation({ summary: "List documents in a session" })
  getDocuments(@Param("id") id: string) {
    return this.sessionsService.getDocuments(id);
  }

  @Get(":id/stats")
  @ApiOperation({ summary: "Get stats for a session" })
  getStats(@Param("id") id: string) {
    return this.sessionsService.getStats(id);
  }

  @Get(":id/schema-fields")
  @ApiOperation({ summary: "Get PDF schema fields for a session" })
  getSchemaFields(@Param("id") id: string) {
    return this.sessionsService.getSchemaFields(id);
  }

  @Patch(":id/schema-fields")
  @ApiOperation({ summary: "Replace PDF schema fields for a session" })
  updateSchemaFields(
    @Param("id") id: string,
    @Body() dto: UpdateSessionSchemaFieldsDto,
  ) {
    return this.sessionsService.updateSchemaFields(id, dto);
  }

  @Get(":id/schema-preset")
  @ApiOperation({ summary: "Get assigned schema preset for a session" })
  getSessionSchemaPreset(@Param("id") id: string) {
    return this.sessionsService.getSessionSchemaPreset(id);
  }

  @Patch(":id/schema-preset")
  @ApiOperation({ summary: "Assign global schema preset to session" })
  assignSessionSchemaPreset(
    @Param("id") id: string,
    @Body() dto: AssignSessionSchemaPresetDto,
  ) {
    return this.sessionsService.assignSessionSchemaPreset(id, dto);
  }
}
