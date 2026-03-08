import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from "@nestjs/swagger";
import { ModelsService } from "./models.service";

@ApiTags("models")
@Controller("models")
export class ModelsController {
  constructor(private readonly modelsService: ModelsService) {}

  @Get()
  @ApiOperation({ summary: "List all extraction models with install status" })
  @ApiResponse({ status: 200, description: "Array of model status objects." })
  listModels() {
    return this.modelsService.listModels();
  }

  @Post(":id/install")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Install (download) a model via pip" })
  @ApiParam({ name: "id", description: "Model identifier" })
  @ApiResponse({ status: 200, description: "Install result." })
  async installModel(@Param("id") id: string) {
    return this.modelsService.installModel(id);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Uninstall (delete) a model via pip" })
  @ApiParam({ name: "id", description: "Model identifier" })
  @ApiResponse({ status: 200, description: "Uninstall result." })
  async uninstallModel(@Param("id") id: string) {
    return this.modelsService.uninstallModel(id);
  }
}
