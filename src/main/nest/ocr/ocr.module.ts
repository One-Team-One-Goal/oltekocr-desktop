import { Module } from "@nestjs/common";
import { OcrController } from "./ocr.controller";
import { OcrService } from "./ocr.service";
import { ExtractionModule } from "../extraction/extraction.module";
import { DocumentsModule } from "../documents/documents.module";
import { ContractExtractionModule } from "../contract-extraction/contract-extraction.module";

// SettingsModule is @Global so it doesn't need to be imported here explicitly.
@Module({
  imports: [ExtractionModule, DocumentsModule, ContractExtractionModule],
  controllers: [OcrController],
  providers: [OcrService],
  exports: [OcrService],
})
export class OcrModule {}
