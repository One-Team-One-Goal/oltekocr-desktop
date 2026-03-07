import { Injectable, Logger } from "@nestjs/common";
import { OcrService } from "../ocr/ocr.service";
import { DocumentsGateway } from "../documents/documents.gateway";

/**
 * Processing queue — FIFO, sequential document processing.
 */
@Injectable()
export class QueueService {
  private readonly logger = new Logger(QueueService.name);
  private queue: string[] = [];
  private processing: string | null = null;
  private paused = false;

  constructor(
    private readonly ocrService: OcrService,
    private readonly gateway: DocumentsGateway,
  ) {}

  /** Add a document ID to the queue */
  add(documentId: string): void {
    if (this.queue.includes(documentId)) return;
    this.queue.push(documentId);
    this.gateway.sendQueueUpdate(this.queue.length, this.processing);
    this.logger.log(
      `Queued document: ${documentId} (queue size: ${this.queue.length})`,
    );
    this.processNext();
  }

  /** Add multiple document IDs */
  addMany(documentIds: string[]): void {
    for (const id of documentIds) {
      if (!this.queue.includes(id)) {
        this.queue.push(id);
      }
    }
    this.gateway.sendQueueUpdate(this.queue.length, this.processing);
    this.processNext();
  }

  /** Pause processing */
  pause(): void {
    this.paused = true;
    this.logger.log("Queue paused");
  }

  /** Resume processing */
  resume(): void {
    this.paused = false;
    this.logger.log("Queue resumed");
    this.processNext();
  }

  /** Get queue status */
  getStatus(): { size: number; processing: string | null; paused: boolean } {
    return {
      size: this.queue.length,
      processing: this.processing,
      paused: this.paused,
    };
  }

  /** Clear the queue */
  clear(): void {
    this.queue = [];
    this.gateway.sendQueueUpdate(0, this.processing);
  }

  // ─── Internal ──────────────────────────────────────────
  private async processNext(): Promise<void> {
    if (this.paused || this.processing || this.queue.length === 0) return;

    const documentId = this.queue.shift()!;
    this.processing = documentId;
    this.gateway.sendQueueUpdate(this.queue.length, this.processing);

    try {
      this.logger.log(`Processing document: ${documentId}`);
      this.gateway.sendProcessingProgress(documentId, 0, "Starting OCR...");

      const result = await this.ocrService.process(documentId);

      this.gateway.sendProcessingProgress(documentId, 100, "Complete");
      this.gateway.sendDocumentStatus(
        documentId,
        "REVIEW",
        new Date().toISOString(),
      );

      this.logger.log(
        `Completed: ${documentId} (conf: ${result.avgConfidence}%, time: ${result.processingTime}s)`,
      );
    } catch (err: any) {
      // P2025 = record not found — document was deleted while queued, not a real error
      const isGone =
        err?.code === "P2025" ||
        (typeof err?.message === "string" && err.message.includes("not found"));
      if (isGone) {
        this.logger.warn(`Document ${documentId} was deleted before processing finished — skipping`);
      } else {
        this.logger.error(`Failed to process document: ${documentId}`, err);
        this.gateway.sendDocumentStatus(
          documentId,
          "ERROR",
          new Date().toISOString(),
        );
      }
    } finally {
      this.processing = null;
      this.gateway.sendQueueUpdate(this.queue.length, null);
      // Process next in queue
      this.processNext();
    }
  }
}
