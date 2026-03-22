import { Module } from "@nestjs/common";
import { ContractSchemasController } from "./contract-schemas.controller";
import { ContractSchemasService } from "./contract-schemas.service";

@Module({
  controllers: [ContractSchemasController],
  providers: [ContractSchemasService],
  exports: [ContractSchemasService],
})
export class ContractSchemasModule {}
