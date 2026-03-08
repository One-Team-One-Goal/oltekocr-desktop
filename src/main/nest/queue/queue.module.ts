import { Module } from "@nestjs/common";
import { QueueController } from "./queue.controller";
import { QueueService } from "./queue.service";
import { OcrModule } from "../ocr/ocr.module";
import { DocumentsModule } from "../documents/documents.module";
import { ContractExtractionModule } from "../contract-extraction/contract-extraction.module";

@Module({
  imports: [OcrModule, DocumentsModule, ContractExtractionModule],
  controllers: [QueueController],
  providers: [QueueService],
  exports: [QueueService],
})
export class QueueModule {}
