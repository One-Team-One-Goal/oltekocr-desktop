import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { SessionPresetsService } from "./session-presets.service";
import {
  CreateSessionPresetDto,
  UpdateSessionPresetDto,
} from "./session-presets.dto";

@ApiTags("session-presets")
@Controller("session-presets")
export class SessionPresetsController {
  constructor(private readonly sessionPresetsService: SessionPresetsService) {}

  @Post()
  @ApiOperation({ summary: "Create a session preset" })
  create(@Body() dto: CreateSessionPresetDto) {
    return this.sessionPresetsService.create(dto);
  }

  @Get()
  @ApiOperation({ summary: "List session presets" })
  findAll() {
    return this.sessionPresetsService.findAll();
  }

  @Get(":id")
  @ApiOperation({ summary: "Get a session preset by ID" })
  findOne(@Param("id") id: string) {
    return this.sessionPresetsService.findOne(id);
  }

  @Patch(":id")
  @ApiOperation({ summary: "Update a session preset" })
  update(@Param("id") id: string, @Body() dto: UpdateSessionPresetDto) {
    return this.sessionPresetsService.update(id, dto);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Delete a session preset" })
  remove(@Param("id") id: string) {
    return this.sessionPresetsService.remove(id);
  }
}
