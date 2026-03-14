import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { OcrService } from "../ocr/ocr.service";
import { ContractExtractionService } from "../contract-extraction/contract-extraction.service";
import { DocumentsGateway } from "../documents/documents.gateway";
import { PrismaService } from "../prisma/prisma.service";
import { SessionsService } from "../sessions/sessions.service";

interface ProcessingMeta {
  scanTime: number;
  llmTime: number;
  totalTime: number;
  scanModel: string;
  llmModel: string | null;
}

/**
 * Processing queue — FIFO, sequential document processing.
 */
@Injectable()
export class QueueService {
  private readonly logger = new Logger(QueueService.name);
  private queue: string[] = [];
  private processing: string | null = null;
  private paused = false;
  private readonly cancelledDocs = new Set<string>();

  private formatSeconds(value: number): string {
    return Number(value ?? 0).toFixed(3);
  }

  private formatConfidenceValue(value: unknown): string {
    const n = Number(value);
    return Number.isFinite(n) ? `${n.toFixed(2)}%` : "n/a";
  }

  constructor(
    private readonly ocrService: OcrService,
    private readonly contractExtractionService: ContractExtractionService,
    private readonly gateway: DocumentsGateway,
    private readonly prisma: PrismaService,
    private readonly sessionsService: SessionsService,
  ) {}

  async onModuleInit(): Promise<void> {
    // Recover from previous app crashes/restarts so rows are not stuck forever.
    const recovered = await this.prisma.document.updateMany({
      where: { status: { in: ["CANCELLING", "SCANNING", "PROCESSING"] } },
      data: { status: "QUEUED" },
    });
    if (recovered.count > 0) {
      this.logger.log(
        `Recovered ${recovered.count} document(s) from transient statuses to QUEUED`,
      );
    }
  }

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

  /** Cancel specific documents — removes waiting ones and flags active docs to reset to QUEUED on finish */
  async cancel(documentIds: string[]): Promise<void> {
    // Remove any docs still waiting in the queue
    this.queue = this.queue.filter((id) => !documentIds.includes(id));

    // Track active cancellation for anything currently running
    const inFlightIds: string[] = [];
    if (this.processing && documentIds.includes(this.processing)) {
      this.cancelledDocs.add(this.processing);
      inFlightIds.push(this.processing);
    }

    const immediateResetIds = documentIds.filter(
      (id) => !inFlightIds.includes(id),
    );

    // Active docs go CANCELLING while worker winds down.
    if (inFlightIds.length > 0) {
      await this.prisma.document.updateMany({
        where: {
          id: { in: inFlightIds },
          status: { in: ["SCANNING", "PROCESSING"] },
        },
        data: { status: "CANCELLING" },
      });
    }

    // Non-active docs should not remain in transient state.
    if (immediateResetIds.length > 0) {
      await this.prisma.document.updateMany({
        where: {
          id: { in: immediateResetIds },
          status: { in: ["QUEUED", "SCANNING", "PROCESSING", "CANCELLING"] },
        },
        data: { status: "QUEUED" },
      });
    }

    const now = new Date().toISOString();
    for (const id of inFlightIds) {
      this.gateway.sendDocumentStatus(id, "CANCELLING", now);
    }
    for (const id of immediateResetIds) {
      this.gateway.sendDocumentStatus(id, "QUEUED", now);
    }

    this.gateway.sendQueueUpdate(this.queue.length, this.processing);
    this.logger.log(`Cancelled documents: ${documentIds.join(", ")}`);
  }

  // ─── Internal ──────────────────────────────────────────
  private async processNext(): Promise<void> {
    if (this.paused || this.processing || this.queue.length === 0) return;

    const documentId = this.queue.shift()!;
    this.processing = documentId;
    this.gateway.sendQueueUpdate(this.queue.length, this.processing);

    // Determine session mode to dispatch to the correct processor
    const docRecord = await this.prisma.document.findUnique({
      where: { id: documentId },
      select: { sessionId: true, session: { select: { mode: true } } },
    });
    const sessionId = docRecord?.sessionId ?? null;
    const sessionMode = docRecord?.session?.mode ?? "OCR_EXTRACT";
    const isPdfExtract = sessionMode === "PDF_EXTRACT";

    if (sessionId) {
      await this.sessionsService.syncStatus(sessionId);
    }

    try {
      this.logger.log(`Processing document: ${documentId} [${sessionMode}]`);
      this.gateway.sendProcessingProgress(
        documentId,
        0,
        isPdfExtract ? "Extracting contract data..." : "Starting OCR...",
      );
      this.gateway.sendProcessingLog(
        documentId,
        `Starting processing for ${documentId}...`,
      );

      const result = isPdfExtract
        ? await this.contractExtractionService.process(documentId)
        : await this.ocrService.process(documentId);

      this.gateway.sendProcessingProgress(documentId, 100, "Complete");

      if (this.cancelledDocs.has(documentId)) {
        // User cancelled mid-flight — reset status back to QUEUED
        this.cancelledDocs.delete(documentId);
        await this.prisma.document.updateMany({
          where: { id: documentId },
          data: { status: "QUEUED" },
        });
        this.gateway.sendDocumentStatus(
          documentId,
          "QUEUED",
          new Date().toISOString(),
        );
        this.gateway.sendProcessingLog(
          documentId,
          "Processing cancelled — reset to QUEUED",
        );
        this.logger.log(
          `Document ${documentId} was cancelled — reset to QUEUED`,
        );
      } else {
        this.gateway.sendDocumentStatus(
          documentId,
          "REVIEW",
          new Date().toISOString(),
        );
        const meta = ((result as any).processingMeta ??
          null) as ProcessingMeta | null;
        const scanTime = Number(
          meta?.scanTime ?? (result as any).processingTime ?? 0,
        );
        const llmTime = Number(meta?.llmTime ?? 0);
        const totalTime = Number(
          meta?.totalTime ?? Number((scanTime + llmTime).toFixed(3)),
        );
        const scanModel =
          meta?.scanModel ??
          (isPdfExtract ? "pdf_contract_extract" : "rapidocr");
        const llmModel = meta?.llmModel ?? null;
        const modelsLabel = llmModel
          ? `models: scan=${scanModel}, llm=${llmModel}`
          : `models: scan=${scanModel}`;

        this.gateway.sendProcessingLog(
          documentId,
          `Completed (conf: ${this.formatConfidenceValue((result as any).avgConfidence)}, time: ${this.formatSeconds(totalTime)}s, scan: ${this.formatSeconds(scanTime)}s, llm: ${this.formatSeconds(llmTime)}s, ${modelsLabel})`,
        );
        this.logger.log(
          `Completed: ${documentId} [${sessionMode}] (total: ${this.formatSeconds(totalTime)}s, scan: ${this.formatSeconds(scanTime)}s, llm: ${this.formatSeconds(llmTime)}s, ${modelsLabel})`,
        );
      }
    } catch (err: any) {
      // Cancelled docs should never stay in PROCESSING/ERROR; force back to QUEUED
      if (this.cancelledDocs.has(documentId)) {
        this.cancelledDocs.delete(documentId);
        await this.prisma.document.updateMany({
          where: { id: documentId },
          data: { status: "QUEUED" },
        });
        this.gateway.sendDocumentStatus(
          documentId,
          "QUEUED",
          new Date().toISOString(),
        );
        this.logger.warn(
          `Cancelled document ${documentId} failed during OCR but was reset to QUEUED`,
        );
        return;
      }

      // P2025 = record not found — document was deleted while queued, not a real error
      const isGone =
        err?.code === "P2025" ||
        (typeof err?.message === "string" && err.message.includes("not found"));
      if (isGone) {
        this.logger.warn(
          `Document ${documentId} was deleted before processing finished — skipping`,
        );
      } else {
        this.logger.error(`Failed to process document: ${documentId}`, err);
        this.gateway.sendProcessingLog(
          documentId,
          `ERROR: ${err?.message ?? String(err)}`,
        );
        this.gateway.sendDocumentStatus(
          documentId,
          "ERROR",
          new Date().toISOString(),
        );
      }
    } finally {
      if (sessionId) {
        await this.sessionsService.syncStatus(sessionId);
      }
      this.processing = null;
      this.gateway.sendQueueUpdate(this.queue.length, null);
      // Process next in queue
      this.processNext();
    }
  }
}
