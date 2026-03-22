import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { ManualSchemasController } from "./manual-schemas.controller";
import { ManualSchemasService } from "./manual-schemas.service";

@Module({
  imports: [PrismaModule],
  controllers: [ManualSchemasController],
  providers: [ManualSchemasService],
  exports: [ManualSchemasService],
})
export class ManualSchemasModule {}
