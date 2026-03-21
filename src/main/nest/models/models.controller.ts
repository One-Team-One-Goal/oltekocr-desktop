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

  @Get("llm")
  @ApiOperation({ summary: "List local Ollama LLM models with install status" })
  @ApiResponse({
    status: 200,
    description: "Array of LLM model status objects.",
  })
  listLlmModels() {
    return this.modelsService.listLlmModels();
  }

  @Get("llm/recommendation")
  @ApiOperation({ summary: "Get hardware-based local LLM recommendation" })
  @ApiResponse({ status: 200, description: "LLM recommendation payload." })
  getLlmRecommendation() {
    return this.modelsService.getLlmRecommendation();
  }

  @Post("llm/:id/install")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Install (pull) an Ollama LLM model" })
  @ApiParam({ name: "id", description: "LLM model identifier" })
  @ApiResponse({ status: 200, description: "Install result." })
  async installLlmModel(@Param("id") id: string) {
    return this.modelsService.installLlmModel(id);
  }

  @Get("llm/:id/install/progress")
  @ApiOperation({ summary: "Get active Ollama LLM install progress" })
  @ApiParam({ name: "id", description: "LLM model identifier" })
  @ApiResponse({ status: 200, description: "Install progress payload." })
  getInstallLlmModelProgress(@Param("id") id: string) {
    return this.modelsService.getLlmInstallProgress(id);
  }

  @Post("llm/:id/install/cancel")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Cancel an active Ollama LLM model install" })
  @ApiParam({ name: "id", description: "LLM model identifier" })
  @ApiResponse({ status: 200, description: "Cancel result." })
  async cancelInstallLlmModel(@Param("id") id: string) {
    return this.modelsService.cancelInstallLlmModel(id);
  }

  @Delete("llm/:id")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Uninstall (delete) an Ollama LLM model" })
  @ApiParam({ name: "id", description: "LLM model identifier" })
  @ApiResponse({ status: 200, description: "Uninstall result." })
  async uninstallLlmModel(@Param("id") id: string) {
    return this.modelsService.uninstallLlmModel(id);
  }

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

  @Post(":id/install/cancel")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Cancel an active extraction model install" })
  @ApiParam({ name: "id", description: "Model identifier" })
  @ApiResponse({ status: 200, description: "Cancel result." })
  async cancelInstallModel(@Param("id") id: string) {
    return this.modelsService.cancelInstallModel(id);
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
