import { Injectable, Logger } from "@nestjs/common";
import { spawn } from "child_process";
import { join } from "path";
import { existsSync, statSync } from "fs";
import { PrismaService } from "../prisma/prisma.service";
import { ExtractionService } from "../extraction/extraction.service";
import { DocumentsService } from "../documents/documents.service";
import { DocumentsGateway } from "../documents/documents.gateway";
import { SettingsService } from "../settings/settings.service";
import type { OcrResult, SessionColumn } from "@shared/types";
import type { PdfTextExtractionResult } from "../documents/documents.service";

interface ProcessingMeta {
  scanTime: number;
  llmTime: number;
  totalTime: number;
  scanModel: string;
  llmModel: string | null;
}

@Injectable()
export class OcrService {
  private readonly logger = new Logger(OcrService.name);
  private readonly allowedPdfModels = new Set([
    "docling",
    "pdfplumber",
    "pymupdf",
    "unstructured",
  ]);

  /** The document ID currently being processed (for log routing). */
  private activeDocId: string | null = null;
  /** Active child process per document ID for immediate cancellation. */
  private activeChildren = new Map<string, ReturnType<typeof spawn>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly extractionService: ExtractionService,
    private readonly documentsService: DocumentsService,
    private readonly gateway: DocumentsGateway,
    private readonly settings: SettingsService,
  ) {}

  /** Return the absolute path to the Python OCR script */
  private get scriptPath(): string {
    return join(process.cwd(), "src", "main", "python", "ocr_rapidocr.py");
  }

  /** Try to cancel a currently running OCR sidecar for a document. */
  cancelActive(documentId: string): boolean {
    const child = this.activeChildren.get(documentId);
    if (!child || child.killed) return false;
    try {
      child.kill();
      this.emitLog(`Cancellation requested — stopped active OCR process`);
      this.logger.warn(`Killed active OCR child for document ${documentId}`);
      return true;
    } catch (err: any) {
      this.logger.warn(
        `Failed to kill active OCR child for ${documentId}: ${String(err?.message ?? err)}`,
      );
      return false;
    }
  }

  /** Track a spawned child for the active document and auto-cleanup on exit. */
  private trackActiveChild(child: ReturnType<typeof spawn>): void {
    const docId = this.activeDocId;
    if (!docId) return;
    this.activeChildren.set(docId, child);
    const clear = () => {
      if (this.activeChildren.get(docId) === child) {
        this.activeChildren.delete(docId);
      }
    };
    child.once("close", clear);
    child.once("error", clear);
    child.once("exit", clear);
  }

  /** Return the absolute path to the unified extraction sidecar */
  private get extractScriptPath(): string {
    return join(process.cwd(), "src", "main", "python", "pdf_extract.py");
  }

  /** Check if an OCR engine is available */
  getStatus(): { available: boolean; engine: string; message: string } {
    const pythonPath = this.settings.getAll().ocr.pythonPath || "python";
    const scriptExists = existsSync(this.scriptPath);
    return {
      available: scriptExists,
      engine: "rapidocr",
      message: scriptExists
        ? `RapidOCR sidecar ready (python: ${pythonPath})`
        : `OCR script not found at ${this.scriptPath}`,
    };
  }

  /** Process a document via the RapidOCR Python sidecar */
  async process(documentId: string): Promise<OcrResult> {
    const startedAt = Date.now();
    const doc = await this.prisma.document.findUnique({
      where: { id: documentId },
    });
    // Document was deleted (e.g. session cascade) before processing started
    if (!doc) {
      this.logger.warn(`Document ${documentId} no longer exists — skipping`);
      return {
        fullText: "",
        markdown: "",
        textBlocks: [],
        tables: [],
        avgConfidence: 0,
        processingTime: 0,
        pageCount: 0,
        warnings: [],
      } as OcrResult;
    }

    // Always re-detect PDF extraction type on processing (fast text/font check).
    // For non-PDFs, only detect if AUTO or not set.
    let detected:
      | "IMAGE"
      | "PDF_TEXT"
      | "PDF_IMAGE"
      | "EXCEL"
      | "UNKNOWN"
      | undefined;
    if (doc.imagePath.toLowerCase().endsWith(".pdf")) {
      // PDFs: always re-detect to ensure correct routing even on reprocess
      detected = this.documentsService.detectExtractionType(doc.imagePath);
      await this.prisma.document.updateMany({
        where: { id: documentId },
        data: { extractionType: detected },
      });
      this.logger.log(
        `Re-detected PDF extractionType=${detected} for ${documentId}`,
      );
    } else if (!doc.extractionType || doc.extractionType === "AUTO") {
      // Non-PDFs: detect only if not already set
      detected = this.documentsService.detectExtractionType(doc.imagePath);
      await this.prisma.document.updateMany({
        where: { id: documentId },
        data: { extractionType: detected },
      });
      this.logger.log(
        `AUTO -> resolved extractionType=${detected} for ${documentId}`,
      );
    }

    // Mark as PROCESSING — use updateMany so a mid-flight delete doesn't throw
    await this.prisma.document.updateMany({
      where: { id: documentId },
      data: { status: "PROCESSING" },
    });

    // Re-read the document to get the resolved extractionType
    const freshDoc = await this.prisma.document.findUnique({
      where: { id: documentId },
      select: {
        extractionType: true,
        imagePath: true,
        sessionId: true,
        session: {
          select: {
            mode: true,
            extractionModel: true,
          },
        },
      },
    });
    const resolvedType = freshDoc?.extractionType ?? "IMAGE";
    const sessionMode = freshDoc?.session?.mode ?? null;

    if (
      doc.imagePath.toLowerCase().endsWith(".pdf") &&
      resolvedType === "UNKNOWN"
    ) {
      const unknownTypeError =
        "PDF content analysis is UNKNOWN. The file was not auto-routed to scanned OCR. Set extraction type to PDF_TEXT or PDF_IMAGE and reprocess.";
      this.emitLog(unknownTypeError);
      await this.prisma.document.updateMany({
        where: { id: documentId },
        data: {
          status: "ERROR",
          ocrWarnings: JSON.stringify([unknownTypeError]),
        },
      });
      throw new Error(unknownTypeError);
    }

    // Default to global settings model; PDF_EXTRACT sessions can override per session.
    const globalPdfModel = this.settings.getAll().ocr?.pdfModel || "pdfplumber";
    let extractionModel = globalPdfModel;
    if (freshDoc?.session?.extractionModel) {
      extractionModel = freshDoc.session.extractionModel;
    }

    if (!this.allowedPdfModels.has(extractionModel)) {
      this.logger.warn(
        `Unsupported extractionModel=${extractionModel}; falling back to pdfplumber`,
      );
      extractionModel = "pdfplumber";
    }

    let ocrResult: OcrResult;
    let scanModel = "rapidocr";
    this.activeDocId = documentId;
    try {
      // TABLE_EXTRACT-only routing strategy:
      // PDF_TEXT -> pdfplumber
      // PDF_IMAGE -> Docling text-only extractor (fallback rapidocr)
      // IMAGE -> Docling (fallback rapidocr)
      if (sessionMode === "TABLE_EXTRACT") {
        if (resolvedType === "PDF_TEXT" || resolvedType === "PDF_IMAGE") {
          try {
            const textExtraction = this.documentsService.extractPdfText([
              doc.imagePath,
            ])[0] as PdfTextExtractionResult | undefined;

            if (!textExtraction || textExtraction.error) {
              throw new Error(
                textExtraction?.error ||
                  "Plain-text PDF extraction failed with unknown error",
              );
            }

            scanModel = textExtraction.modelUsed;
            ocrResult = this.toOcrResultFromPdfTextExtraction(textExtraction);
          } catch (textErr: any) {
            const fallbackMsg = `${resolvedType} text extraction failed; falling back to RapidOCR. Reason: ${String(
              textErr?.message ?? textErr,
            )}`;
            this.emitLog(fallbackMsg);
            this.logger.warn(fallbackMsg);
            scanModel = "rapidocr(fallback)";
            ocrResult = await this.runPythonOcr(doc.imagePath);
            ocrResult.warnings = [...(ocrResult.warnings || []), fallbackMsg];
          }
        } else if (resolvedType === "IMAGE") {
          // Use Docling for images (ocr mode) → RapidOCR fallback
          try {
            scanModel = "docling";
            ocrResult = await this.runPdfExtractor(
              doc.imagePath,
              "docling",
              "ocr",
            );
          } catch (doclingErr: any) {
            const fallbackMsg = `Docling failed for IMAGE; falling back to RapidOCR. Reason: ${String(
              doclingErr?.message ?? doclingErr,
            )}`;
            this.emitLog(fallbackMsg);
            this.logger.warn(fallbackMsg);
            scanModel = "rapidocr(fallback)";
            ocrResult = await this.runPythonOcr(doc.imagePath);
            ocrResult.warnings = [...(ocrResult.warnings || []), fallbackMsg];
          }
        } else if (
          resolvedType === "PDF_TEXT" ||
          resolvedType === "PDF_IMAGE"
        ) {
          // Defensive fallback path, should already be covered above.
          const mode = resolvedType === "PDF_IMAGE" ? "ocr" : "text";
          scanModel = extractionModel;
          ocrResult = await this.runPdfExtractor(
            doc.imagePath,
            extractionModel,
            mode,
          );
        } else {
          ocrResult = await this.runPythonOcr(doc.imagePath);
        }
      } else if (resolvedType === "PDF_TEXT" || resolvedType === "PDF_IMAGE") {
        const mode = resolvedType === "PDF_IMAGE" ? "ocr" : "text";
        scanModel = extractionModel;
        ocrResult = await this.runPdfExtractor(
          doc.imagePath,
          extractionModel,
          mode,
        );
      } else {
        // IMAGE or any other type — use RapidOCR
        ocrResult = await this.runPythonOcr(doc.imagePath);
      }
    } catch (err: any) {
      // Store error state and re-throw so the queue marks it ERROR
      await this.prisma.document.updateMany({
        where: { id: documentId },
        data: {
          status: "ERROR",
          ocrWarnings: JSON.stringify([String(err?.message ?? err)]),
        },
      });
      throw err;
    } finally {
      this.activeDocId = null;
    }

    // Persist OCR result but keep status PROCESSING until field extraction completes
    await this.prisma.document.updateMany({
      where: { id: documentId },
      data: {
        status: "PROCESSING", // Keep processing until LLM is done
        processedAt: new Date(),
        ocrFullText: ocrResult.fullText,
        ocrMarkdown: ocrResult.markdown,
        ocrTextBlocks: JSON.stringify(ocrResult.textBlocks),
        ocrTables: JSON.stringify(ocrResult.tables),
        ocrAvgConfidence: ocrResult.avgConfidence,
        ocrProcessingTime: ocrResult.processingTime,
        ocrPageCount: ocrResult.pageCount,
        ocrWarnings: JSON.stringify(ocrResult.warnings),
      },
    });

    // Run field extraction for TABLE_EXTRACT sessions
    // Use the markdown representation which has properly formatted tables
    const llmMeta = await this.runFieldExtraction(
      documentId,
      ocrResult.markdown || ocrResult.fullText,
    );

    // Now mark REVIEW only after field extraction completes
    await this.prisma.document.updateMany({
      where: { id: documentId },
      data: { status: "REVIEW" },
    });

    const scanTime = Number(ocrResult.processingTime ?? 0);
    const llmTime = Number(llmMeta.durationSec ?? 0);
    const totalTime = Number((scanTime + llmTime).toFixed(3));

    // Persist the row/display time as total processing time (scan + llm).
    await this.prisma.document.updateMany({
      where: { id: documentId },
      data: { ocrProcessingTime: totalTime },
    });

    ocrResult.processingTime = totalTime;

    (
      ocrResult as OcrResult & { processingMeta?: ProcessingMeta }
    ).processingMeta = {
      scanTime: Number(scanTime.toFixed(3)),
      llmTime: Number(llmTime.toFixed(3)),
      totalTime,
      scanModel,
      llmModel: llmMeta.model,
    };

    // Fallback: if sidecar time is unavailable, use wall-clock processing time.
    if (!scanTime && !llmTime) {
      const wallClockSec = Number(((Date.now() - startedAt) / 1000).toFixed(3));
      (
        ocrResult as OcrResult & { processingMeta?: ProcessingMeta }
      ).processingMeta = {
        scanTime: 0,
        llmTime: 0,
        totalTime: wallClockSec,
        scanModel,
        llmModel: llmMeta.model,
      };
    }

    return ocrResult;
  }

  /**
   * Spawn the Marker sidecar for image-heavy PDFs and standalone images.
   */

  /**
   * Resolve the Python executable: prefer the local .venv, then the configured
   * path, then fall back to the system "python" / "python3".
   */
  private resolvePythonExe(configured: string): string {
    // If the user explicitly set a non-default path, honour it
    if (configured && configured !== "python" && configured !== "python3") {
      return configured;
    }

    // Auto-detect .venv inside the project root
    const root = process.cwd();
    const candidates = [
      join(root, ".venv", "Scripts", "python.exe"), // Windows venv
      join(root, ".venv", "bin", "python"), // macOS / Linux venv
    ];
    for (const candidate of candidates) {
      if (existsSync(candidate)) {
        this.logger.log(`Using venv Python: ${candidate}`);
        return candidate;
      }
    }

    return configured || "python";
  }

  /**
   * Emit a log line to the WebSocket for the currently active document.
   */
  private emitLog(line: string): void {
    if (this.activeDocId) {
      this.gateway.sendProcessingLog(this.activeDocId, line);
    }
  }

  /**
   * Process buffered stderr, extract complete lines, and stream progress
   * lines via WebSocket. Returns leftover (incomplete last line).
   */
  private flushStderrLines(buffer: string): string {
    const lines = buffer.split("\n");
    // The last element is either empty or an incomplete line
    const leftover = lines.pop() ?? "";
    for (const raw of lines) {
      // Remove ANSI escape codes so log panel stays readable.
      const trimmed = raw
        .replace(/\x1B\[[0-9;]*m/g, "")
        .replace(/\u001b\[[0-9;]*m/g, "")
        .trim();
      if (!trimmed) continue;
      // Forward [progress] lines as-is, others as debug
      const display = trimmed.startsWith("[progress]")
        ? trimmed.slice("[progress] ".length)
        : trimmed;
      this.emitLog(display);
    }
    return leftover;
  }

  /**
   * Spawn the Python OCR sidecar and resolve with the parsed OcrResult.
   */
  private runPythonOcr(imagePath: string): Promise<OcrResult> {
    const cfg = this.settings.getAll().ocr;
    const pythonExe = this.resolvePythonExe(cfg.pythonPath || "python");
    const timeoutMs = (cfg.timeout ?? 120) * 1000;
    const script = this.scriptPath;

    if (!existsSync(script)) {
      return Promise.reject(new Error(`RapidOCR script not found: ${script}`));
    }

    return new Promise((resolve, reject) => {
      this.emitLog("Spawning RapidOCR sidecar...");
      this.logger.log(
        `Spawning: ${pythonExe} ${script} --image "${imagePath}"`,
      );

      const child = spawn(pythonExe, [script, "--image", imagePath], {
        windowsHide: true,
      });
      this.trackActiveChild(child);

      let stdout = "";
      let stderrBuf = "";
      let stderrAll = "";

      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      child.stderr.on("data", (chunk: Buffer) => {
        const text = chunk.toString();
        stderrAll += text;
        stderrBuf += text;
        stderrBuf = this.flushStderrLines(stderrBuf);
      });

      const timer = setTimeout(() => {
        child.kill();
        this.emitLog(`ERROR: OCR timed out after ${cfg.timeout}s`);
        reject(new Error(`OCR timed out after ${cfg.timeout}s`));
      }, timeoutMs);

      child.on("close", (code) => {
        clearTimeout(timer);
        if (stderrBuf.trim()) this.emitLog(stderrBuf.trim());
        if (stderrAll)
          this.logger.warn(`[ocr-sidecar stderr] ${stderrAll.trim()}`);

        try {
          const parsed = JSON.parse(stdout.trim());
          if (parsed.error) {
            this.emitLog(`ERROR: ${parsed.error}`);
            reject(new Error(parsed.error));
          } else {
            this.emitLog("RapidOCR completed successfully");
            resolve(parsed as OcrResult);
          }
        } catch {
          this.emitLog(`ERROR: sidecar exited with code ${code}`);
          reject(
            new Error(
              `OCR sidecar exited with code ${code}. stderr: ${stderrAll.slice(0, 300)}`,
            ),
          );
        }
      });

      child.on("error", (err) => {
        clearTimeout(timer);
        this.emitLog(`ERROR: Failed to start Python — ${err.message}`);
        reject(new Error(`Failed to start Python: ${err.message}`));
      });
    });
  }

  /**
   * Spawn the unified pdf_extract.py sidecar with the chosen model.
   */
  private runPdfExtractor(
    pdfPath: string,
    model: string,
    mode: "text" | "ocr",
  ): Promise<OcrResult> {
    const cfg = this.settings.getAll().ocr;
    const pythonExe = this.resolvePythonExe(cfg.pythonPath || "python");
    const script = this.extractScriptPath;

    let fileSizeMb = 0;
    try {
      fileSizeMb = statSync(pdfPath).size / (1024 * 1024);
    } catch {}
    const baseTimeout = cfg.timeout ?? 600;
    const dynamicTimeout = Math.max(
      baseTimeout,
      120 + Math.ceil(fileSizeMb * 30),
    );
    const timeoutMs = dynamicTimeout * 1000;

    if (!existsSync(script)) {
      return Promise.reject(
        new Error(`Extraction script not found: ${script}`),
      );
    }

    return new Promise((resolve, reject) => {
      const args = [
        script,
        "--input",
        pdfPath,
        "--model",
        model,
        "--chunk-size",
        "25",
        "--mode",
        mode,
      ];
      this.emitLog(
        `Spawning extraction sidecar [${model}] (timeout: ${dynamicTimeout}s)...`,
      );
      this.emitLog(`Extract args: ${args.join(" ")}`);
      this.logger.log(`Spawning: ${pythonExe} ${args.join(" ")}`);

      const child = spawn(pythonExe, args, {
        windowsHide: true,
      });
      this.trackActiveChild(child);

      let stdout = "";
      let stderrBuf = "";
      let stderrAll = "";
      let lastActivityAt = Date.now();

      const markActivity = () => {
        lastActivityAt = Date.now();
      };

      child.stdout.on("data", (chunk: Buffer) => {
        markActivity();
        stdout += chunk.toString();
      });
      child.stderr.on("data", (chunk: Buffer) => {
        markActivity();
        const text = chunk.toString();
        stderrAll += text;
        stderrBuf += text;
        stderrBuf = this.flushStderrLines(stderrBuf);
      });

      const timer = setTimeout(() => {
        child.kill();
        this.emitLog(`ERROR: Extraction timed out after ${dynamicTimeout}s`);
        reject(new Error(`Extraction timed out after ${dynamicTimeout}s`));
      }, timeoutMs);

      // Some models can spend long stretches in import / first-run setup
      // without writing output. Give them a wider idle budget.
      const idleBudgetMs =
        model === "unstructured" || model === "marker" ? 240_000 : 60_000;

      const idleWatchdog = setInterval(() => {
        const idleForMs = Date.now() - lastActivityAt;
        if (idleForMs > idleBudgetMs) {
          this.emitLog(
            `ERROR: Extraction produced no output for ${Math.round(idleBudgetMs / 1000)}s; aborting.`,
          );
          this.logger.error(
            `Extraction stalled with no output for ${Math.round(idleForMs / 1000)}s`,
          );
          child.kill();
        }
      }, 5_000);

      child.on("close", (code) => {
        clearTimeout(timer);
        clearInterval(idleWatchdog);
        this.emitLog(`Extraction process closed (code=${code})`);
        if (stderrBuf.trim()) this.emitLog(stderrBuf.trim());
        if (stderrAll)
          this.logger.warn(`[extract-sidecar stderr] ${stderrAll.trim()}`);

        try {
          const parsed = JSON.parse(stdout.trim());
          if (parsed.error) {
            this.emitLog(`ERROR: ${parsed.error}`);
            reject(new Error(parsed.error));
          } else {
            this.emitLog(`Extraction [${model}] completed successfully`);
            resolve(parsed as OcrResult);
          }
        } catch {
          this.emitLog(`ERROR: Extraction sidecar exited with code ${code}`);
          reject(
            new Error(
              `Extraction sidecar exited with code ${code}. stderr: ${stderrAll.slice(0, 300)}`,
            ),
          );
        }
      });

      child.on("error", (err) => {
        clearTimeout(timer);
        clearInterval(idleWatchdog);
        this.emitLog(`ERROR: Failed to start Python — ${err.message}`);
        reject(new Error(`Failed to start Python: ${err.message}`));
      });

      child.on("exit", (code, signal) => {
        this.emitLog(
          `Extraction process exit observed (code=${code ?? "null"}, signal=${signal ?? "null"})`,
        );
      });
    });
  }

  private toOcrResultFromPdfTextExtraction(
    extracted: PdfTextExtractionResult,
  ): OcrResult {
    const fullText = extracted.fullText || "";
    return {
      fullText,
      markdown: fullText,
      textBlocks: [],
      tables: [],
      avgConfidence: fullText.trim().length > 0 ? 100 : 0,
      processingTime: Number(extracted.processingTime ?? 0),
      pageCount: Number(extracted.pageCount ?? extracted.rawPages.length ?? 0),
      warnings: Array.isArray(extracted.warnings) ? extracted.warnings : [],
    };
  }

  /**
   * If the document belongs to a TABLE_EXTRACT session, run local QA extraction
   * over all session columns and persist the results in extractedRow.
   */
  private async runFieldExtraction(
    documentId: string,
    ocrText: string,
  ): Promise<{ durationSec: number; model: string | null }> {
    try {
      const doc = await this.prisma.document.findUnique({
        where: { id: documentId },
        include: { session: true },
      });

      if (!doc?.session || doc.session.mode !== "TABLE_EXTRACT") {
        return { durationSec: 0, model: null };
      }

      const columns: SessionColumn[] = JSON.parse(doc.session.columns || "[]");
      if (columns.length === 0) {
        return { durationSec: 0, model: null };
      }

      this.logger.log(
        `Running TABLE_EXTRACT for "${doc.filename}" (${columns.length} fields)`,
      );
      const selectedModel = this.extractionService.getSelectedModelId();
      const llmStartedAt = Date.now();
      const results = await this.extractionService.extractFields(
        columns,
        ocrText,
      );
      const llmDurationSec = Number(
        ((Date.now() - llmStartedAt) / 1000).toFixed(3),
      );

      await this.prisma.document.update({
        where: { id: documentId },
        data: { extractedRow: JSON.stringify(results) },
      });

      this.logger.log(`Field extraction complete for "${doc.filename}"`);
      return { durationSec: llmDurationSec, model: selectedModel };
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : `Unknown field extraction error: ${String(err)}`;

      this.logger.error(
        `Field extraction failed for ${documentId}: ${message}`,
      );

      try {
        const current = await this.prisma.document.findUnique({
          where: { id: documentId },
          select: { ocrWarnings: true },
        });

        const warnings = (() => {
          try {
            const parsed = JSON.parse(current?.ocrWarnings || "[]");
            return Array.isArray(parsed) ? parsed : [];
          } catch {
            return [] as string[];
          }
        })();

        warnings.push(`TABLE_EXTRACT failed: ${message}`);

        await this.prisma.document.update({
          where: { id: documentId },
          data: { ocrWarnings: JSON.stringify(warnings) },
        });
      } catch (warningErr) {
        this.logger.warn(
          `Failed to persist TABLE_EXTRACT warning for ${documentId}: ${String(warningErr)}`,
        );
      }

      return {
        durationSec: 0,
        model: this.extractionService.getSelectedModelId(),
      };
    }
  }
}
