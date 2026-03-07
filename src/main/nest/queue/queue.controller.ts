import { Controller, Get, Post, Body, Delete } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiResponse } from "@nestjs/swagger";
import { QueueService } from "./queue.service";

@ApiTags("queue")
@Controller("queue")
export class QueueController {
  constructor(private readonly queueService: QueueService) {}

  @Get("status")
  @ApiOperation({ summary: "Get queue status" })
  @ApiResponse({ status: 200, description: "Current queue status." })
  getStatus() {
    return this.queueService.getStatus();
  }

  @Post("add")
  @ApiOperation({ summary: "Add documents to processing queue" })
  @ApiResponse({ status: 201, description: "Documents added to queue." })
  addToQueue(@Body() body: { documentIds: string[] }) {
    this.queueService.addMany(body.documentIds);
    return { queued: body.documentIds.length };
  }

  @Post("pause")
  @ApiOperation({ summary: "Pause queue processing" })
  pause() {
    this.queueService.pause();
    return { paused: true };
  }

  @Post("resume")
  @ApiOperation({ summary: "Resume queue processing" })
  resume() {
    this.queueService.resume();
    return { resumed: true };
  }

  @Post("cancel")
  @ApiOperation({ summary: "Cancel specific documents from queue" })
  async cancel(@Body() body: { documentIds: string[] }) {
    await this.queueService.cancel(body.documentIds);
    return { cancelled: body.documentIds.length };
  }

  @Delete()
  @ApiOperation({ summary: "Clear the queue" })
  clear() {
    this.queueService.clear();
    return { cleared: true };
  }
}
