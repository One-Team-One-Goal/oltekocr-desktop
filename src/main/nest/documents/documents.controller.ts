import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Query,
  Body,
  Res,
  NotFoundException,
} from "@nestjs/common";
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiQuery,
} from "@nestjs/swagger";
import { Response } from "express";
import { DocumentsService } from "./documents.service";
import {
  ListDocumentsQueryDto,
  LoadFilesDto,
  LoadFolderDto,
  UpdateDocumentDto,
  RejectDocumentDto,
} from "./documents.dto";
import { existsSync } from "fs";

@ApiTags("documents")
@Controller("documents")
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  @Get()
  @ApiOperation({
    summary: "List all documents",
    description:
      "Retrieve documents with optional filtering, searching, and sorting.",
  })
  @ApiResponse({ status: 200, description: "List of documents." })
  async findAll(@Query() query: ListDocumentsQueryDto) {
    return this.documentsService.findAll(query);
  }

  @Get("stats")
  @ApiOperation({ summary: "Get dashboard statistics" })
  @ApiResponse({ status: 200, description: "Dashboard statistics." })
  async getStats() {
    return this.documentsService.getStats();
  }

  @Get(":id")
  @ApiOperation({ summary: "Get a single document by ID" })
  @ApiParam({ name: "id", description: "Document UUID" })
  @ApiResponse({ status: 200, description: "Full document record." })
  @ApiResponse({ status: 404, description: "Document not found." })
  async findOne(@Param("id") id: string) {
    return this.documentsService.findOne(id);
  }

  @Get(":id/image")
  @ApiOperation({ summary: "Serve the original scan image" })
  @ApiParam({ name: "id", description: "Document UUID" })
  @ApiResponse({ status: 200, description: "Image file." })
  @ApiResponse({ status: 404, description: "Image not found." })
  async getImage(@Param("id") id: string, @Res() res: Response) {
    const doc = await this.documentsService.findOne(id);
    if (!doc.imagePath || !existsSync(doc.imagePath)) {
      throw new NotFoundException("Image file not found");
    }
    res.sendFile(doc.imagePath);
  }

  @Get(":id/thumbnail")
  @ApiOperation({ summary: "Serve the document thumbnail" })
  @ApiParam({ name: "id", description: "Document UUID" })
  @ApiResponse({ status: 200, description: "Thumbnail image." })
  @ApiResponse({ status: 404, description: "Thumbnail not found." })
  async getThumbnail(@Param("id") id: string, @Res() res: Response) {
    const doc = await this.documentsService.findOne(id);
    if (!doc.thumbnailPath || !existsSync(doc.thumbnailPath)) {
      throw new NotFoundException("Thumbnail not found");
    }
    res.sendFile(doc.thumbnailPath);
  }

  @Post("load")
  @ApiOperation({
    summary: "Load files from paths",
    description: "Copy files to scans folder and create QUEUED documents.",
  })
  @ApiResponse({ status: 201, description: "Created document list items." })
  async loadFiles(@Body() dto: LoadFilesDto) {
    return this.documentsService.loadFiles(dto.filePaths);
  }

  @Post("load-folder")
  @ApiOperation({ summary: "Load all supported files from a folder" })
  @ApiResponse({ status: 201, description: "Created document list items." })
  async loadFolder(@Body() dto: LoadFolderDto) {
    return this.documentsService.loadFolder(dto.folderPath);
  }

  @Patch(":id")
  @ApiOperation({
    summary: "Update document fields",
    description: "Update notes, tags, OCR text, or user edits.",
  })
  @ApiParam({ name: "id", description: "Document UUID" })
  @ApiResponse({ status: 200, description: "Updated document record." })
  async update(@Param("id") id: string, @Body() dto: UpdateDocumentDto) {
    return this.documentsService.update(id, dto);
  }

  @Patch(":id/approve")
  @ApiOperation({ summary: "Approve a document" })
  @ApiParam({ name: "id", description: "Document UUID" })
  @ApiResponse({ status: 200, description: "Approved document." })
  async approve(@Param("id") id: string) {
    return this.documentsService.approve(id);
  }

  @Patch(":id/reject")
  @ApiOperation({ summary: "Reject a document" })
  @ApiParam({ name: "id", description: "Document UUID" })
  @ApiResponse({ status: 200, description: "Rejected document." })
  async reject(@Param("id") id: string, @Body() dto: RejectDocumentDto) {
    return this.documentsService.reject(id, dto.reason);
  }

  @Patch(":id/reprocess")
  @ApiOperation({ summary: "Re-queue a document for OCR processing" })
  @ApiParam({ name: "id", description: "Document UUID" })
  @ApiResponse({ status: 200, description: "Re-queued document." })
  async reprocess(@Param("id") id: string) {
    return this.documentsService.reprocess(id);
  }

  @Delete(":id")
  @ApiOperation({ summary: "Delete a document and its files" })
  @ApiParam({ name: "id", description: "Document UUID" })
  @ApiResponse({ status: 200, description: "Document deleted." })
  async remove(@Param("id") id: string) {
    await this.documentsService.remove(id);
    return { deleted: true };
  }
}
