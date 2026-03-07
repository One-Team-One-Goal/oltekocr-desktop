import { Module } from "@nestjs/common";
import { SessionPresetsController } from "./session-presets.controller";
import { SessionPresetsService } from "./session-presets.service";

@Module({
  controllers: [SessionPresetsController],
  providers: [SessionPresetsService],
  exports: [SessionPresetsService],
})
export class SessionPresetsModule {}
