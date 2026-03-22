import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { AutoSchemasController } from "./auto-schemas.controller";
import { AutoSchemasService } from "./auto-schemas.service";
import { AutoSchemaLlmService } from "./auto-schema-llm.service";

@Module({
  imports: [PrismaModule],
  controllers: [AutoSchemasController],
  providers: [AutoSchemasService, AutoSchemaLlmService],
})
export class AutoSchemasModule {}
