import { Controller, Get, Post, Param } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from "@nestjs/swagger";
import { OcrService } from "./ocr.service";
import { PrismaService } from "../prisma/prisma.service";
import { ContractExtractionService } from "../contract-extraction/contract-extraction.service";
import { DocumentsGateway } from "../documents/documents.gateway";

@ApiTags("ocr")
@Controller("ocr")
export class OcrController {
  constructor(
    private readonly ocrService: OcrService,
    private readonly prisma: PrismaService,
    private readonly contractExtractionService: ContractExtractionService,
    private readonly gateway: DocumentsGateway,
  ) {}

  @Get("status")
  @ApiOperation({ summary: "Check OCR engine status" })
  @ApiResponse({ status: 200, description: "OCR engine availability." })
  getStatus() {
    return this.ocrService.getStatus();
  }

  @Post("process/:id")
  @ApiOperation({ summary: "Process a document with OCR (stub)" })
  @ApiParam({ name: "id", description: "Document UUID" })
  @ApiResponse({ status: 201, description: "OCR result." })
  async process(@Param("id") id: string) {
    const doc = await this.prisma.document.findUnique({
      where: { id },
      select: { session: { select: { mode: true } } },
    });

    if (doc?.session?.mode === "PDF_EXTRACT") {
      const result = await this.contractExtractionService.process(
        id,
        (progress, message) => {
          this.gateway.sendProcessingProgress(id, progress, message);
        },
      );
      this.gateway.sendDocumentStatus(id, "REVIEW", new Date().toISOString());
      return result;
    }

    return this.ocrService.process(id);
  }
}
