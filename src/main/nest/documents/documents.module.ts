import { Module } from "@nestjs/common";
import { DocumentsController } from "./documents.controller";
import { DocumentsService } from "./documents.service";
import { DocumentsGateway } from "./documents.gateway";

@Module({
  controllers: [DocumentsController],
  providers: [DocumentsService, DocumentsGateway],
  exports: [DocumentsService, DocumentsGateway],
})
export class DocumentsModule {}
