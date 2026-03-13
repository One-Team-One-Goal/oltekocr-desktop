import { Module } from "@nestjs/common";
import { ContractExtractionService } from "./contract-extraction.service";

// SettingsModule is @Global so no explicit import needed.
@Module({
  providers: [ContractExtractionService],
  exports: [ContractExtractionService],
})
export class ContractExtractionModule {}
