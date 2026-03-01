import { Controller, Get, Post } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiResponse } from "@nestjs/swagger";
import { ScannerService } from "./scanner.service";

@ApiTags("scanner")
@Controller("scanner")
export class ScannerController {
  constructor(private readonly scannerService: ScannerService) {}

  @Get("list")
  @ApiOperation({ summary: "List available scanners (stub)" })
  @ApiResponse({ status: 200, description: "Array of scanner devices." })
  listScanners() {
    return this.scannerService.listScanners();
  }

  @Post("scan")
  @ApiOperation({ summary: "Trigger a scan (stub)" })
  @ApiResponse({ status: 201, description: "Scanned document." })
  async scanNow() {
    return this.scannerService.scanNow();
  }

  @Post("watch/start")
  @ApiOperation({ summary: "Start folder watcher" })
  @ApiResponse({ status: 201, description: "Watcher started." })
  async startWatch() {
    await this.scannerService.startWatch();
    return { started: true };
  }

  @Post("watch/stop")
  @ApiOperation({ summary: "Stop folder watcher" })
  @ApiResponse({ status: 201, description: "Watcher stopped." })
  async stopWatch() {
    await this.scannerService.stopWatch();
    return { stopped: true };
  }

  @Get("watch/status")
  @ApiOperation({ summary: "Check watcher status" })
  @ApiResponse({ status: 200, description: "Watcher running status." })
  getWatchStatus() {
    return this.scannerService.getWatchStatus();
  }
}
