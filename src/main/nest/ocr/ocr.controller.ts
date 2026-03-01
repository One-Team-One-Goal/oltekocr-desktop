import { Controller, Get, Post, Param } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from "@nestjs/swagger";
import { OcrService } from "./ocr.service";

@ApiTags("ocr")
@Controller("ocr")
export class OcrController {
  constructor(private readonly ocrService: OcrService) {}

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
    return this.ocrService.process(id);
  }
}
