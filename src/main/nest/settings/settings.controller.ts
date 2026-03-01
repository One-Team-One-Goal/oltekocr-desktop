import { Controller, Get, Patch, Body } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiResponse } from "@nestjs/swagger";
import { SettingsService } from "./settings.service";

@ApiTags("settings")
@Controller("settings")
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get()
  @ApiOperation({ summary: "Get all settings" })
  @ApiResponse({ status: 200, description: "Current application settings." })
  getAll() {
    return this.settingsService.getAll();
  }

  @Get("defaults")
  @ApiOperation({ summary: "Get default settings" })
  @ApiResponse({ status: 200, description: "Default settings values." })
  getDefaults() {
    return this.settingsService.getDefaults();
  }

  @Patch()
  @ApiOperation({
    summary: "Update settings",
    description: "Merge partial settings update into current settings.",
  })
  @ApiResponse({ status: 200, description: "Updated settings." })
  update(@Body() body: Record<string, unknown>) {
    return this.settingsService.update(body as any);
  }
}
