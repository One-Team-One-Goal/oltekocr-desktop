import { Injectable, Logger } from "@nestjs/common";
import * as chokidar from "chokidar";
import { extname } from "path";
import { DocumentsService } from "../documents/documents.service";
import { DocumentsGateway } from "../documents/documents.gateway";
import { SettingsService } from "../settings/settings.service";

@Injectable()
export class ScannerService {
  private readonly logger = new Logger(ScannerService.name);
  private watcher: chokidar.FSWatcher | null = null;
  private isWatching = false;

  constructor(
    private readonly documentsService: DocumentsService,
    private readonly gateway: DocumentsGateway,
    private readonly settingsService: SettingsService,
  ) {}

  /** List available scanners — stub for now */
  listScanners(): { id: string; name: string }[] {
    this.logger.warn("Scanner listing is a stub — implement WIA/TWAIN later");
    return [];
  }

  /** Trigger a scan — stub */
  async scanNow(): Promise<string> {
    this.logger.warn("Scan is a stub — implement WIA/TWAIN later");
    throw new Error("Scanner not implemented yet");
  }

  /** Start watching a folder for incoming files */
  async startWatch(): Promise<void> {
    if (this.isWatching) {
      this.logger.warn("Folder watcher already running");
      return;
    }

    const settings = this.settingsService.getAll();
    const watchFolder = settings.scanner.watchFolder || "./data/scans/incoming";
    const supportedExts = new Set(settings.scanner.supportedFormats);

    this.watcher = chokidar.watch(watchFolder, {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 1000, pollInterval: 200 },
    });

    this.watcher.on("add", async (filePath: string) => {
      const ext = extname(filePath).toLowerCase();
      if (!supportedExts.has(ext)) return;

      this.logger.log(`New file detected: ${filePath}`);
      try {
        const created = await this.documentsService.loadFiles([filePath]);
        if (created.length > 0) {
          this.gateway.sendQueueUpdate(created.length, null);
        }
      } catch (err) {
        this.logger.error(`Failed to load watched file: ${filePath}`, err);
      }
    });

    this.isWatching = true;
    this.logger.log(`Folder watcher started: ${watchFolder}`);
  }

  /** Stop the folder watcher */
  async stopWatch(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
    this.isWatching = false;
    this.logger.log("Folder watcher stopped");
  }

  /** Check watcher status */
  getWatchStatus(): { watching: boolean; folder: string } {
    const settings = this.settingsService.getAll();
    return {
      watching: this.isWatching,
      folder: settings.scanner.watchFolder || "./data/scans/incoming",
    };
  }
}
