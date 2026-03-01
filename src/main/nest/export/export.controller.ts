import { Controller, Post, Get, Body } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiResponse } from "@nestjs/swagger";
import { ExportService } from "./export.service";
import { ExportDocumentsDto } from "./export.dto";

@ApiTags("export")
@Controller("export")
export class ExportController {
  constructor(private readonly exportService: ExportService) {}

  @Post()
  @ApiOperation({ summary: "Export selected documents" })
  @ApiResponse({ status: 201, description: "Export file path." })
  async exportDocuments(@Body() dto: ExportDocumentsDto) {
    const path = await this.exportService.exportDocuments(
      dto.documentIds,
      dto.format,
    );
    return { exportPath: path };
  }

  @Post("all-approved")
  @ApiOperation({ summary: "Export all approved documents" })
  @ApiResponse({ status: 201, description: "Export file path." })
  async exportAllApproved(@Body() dto: { format: "excel" | "json" | "csv" }) {
    const path = await this.exportService.exportAllApproved(
      dto.format || "excel",
    );
    return { exportPath: path };
  }

  @Get("history")
  @ApiOperation({ summary: "Get export history" })
  @ApiResponse({ status: 200, description: "List of export records." })
  async getHistory() {
    return this.exportService.getHistory();
  }
}
