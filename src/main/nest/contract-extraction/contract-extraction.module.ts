import { Module } from "@nestjs/common";
import { ContractExtractionService } from "./contract-extraction.service";
import { DocumentsModule } from "../documents/documents.module";

// SettingsModule is @Global so no explicit import needed.
@Module({
  imports: [DocumentsModule],
  providers: [ContractExtractionService],
  exports: [ContractExtractionService],
})
export class ContractExtractionModule {}
