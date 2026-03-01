import { Module } from "@nestjs/common";
import { ScannerController } from "./scanner.controller";
import { ScannerService } from "./scanner.service";
import { DocumentsModule } from "../documents/documents.module";

@Module({
  imports: [DocumentsModule],
  controllers: [ScannerController],
  providers: [ScannerService],
  exports: [ScannerService],
})
export class ScannerModule {}
