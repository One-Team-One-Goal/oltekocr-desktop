import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { SettingsModule } from "../settings/settings.module";
import { ManualSchemasController } from "./manual-schemas.controller";
import { ManualSchemasService } from "./manual-schemas.service";

@Module({
  imports: [PrismaModule, SettingsModule],
  controllers: [ManualSchemasController],
  providers: [ManualSchemasService],
})
export class ManualSchemasModule {}
