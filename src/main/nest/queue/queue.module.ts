import { Module } from "@nestjs/common";
import { QueueController } from "./queue.controller";
import { QueueService } from "./queue.service";
import { OcrModule } from "../ocr/ocr.module";
import { DocumentsModule } from "../documents/documents.module";

@Module({
  imports: [OcrModule, DocumentsModule],
  controllers: [QueueController],
  providers: [QueueService],
  exports: [QueueService],
})
export class QueueModule {}
