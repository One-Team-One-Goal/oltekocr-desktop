import { Module } from "@nestjs/common";
import { ModelsController } from "./models.controller";
import { ModelsService } from "./models.service";
import { SettingsModule } from "../settings/settings.module";

@Module({
  imports: [SettingsModule],
  controllers: [ModelsController],
  providers: [ModelsService],
  exports: [ModelsService],
})
export class ModelsModule {}
