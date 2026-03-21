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
  CreateSessionDto,
  DuplicateSessionDto,
  IngestFilesDto,
  IngestFolderDto,
  UpdateColumnsDto,
  RenameSessionDto,
  UpdateExtractionModelDto,
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
}
