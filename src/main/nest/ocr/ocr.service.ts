import { Injectable, Logger } from "@nestjs/common";
import { spawn } from "child_process";
import { join } from "path";
import { existsSync } from "fs";
import { PrismaService } from "../prisma/prisma.service";
import { ExtractionService } from "../extraction/extraction.service";
import { DocumentsService } from "../documents/documents.service";
import { SettingsService } from "../settings/settings.service";
import type { OcrResult, SessionColumn } from "@shared/types";

@Injectable()
export class OcrService {
  private readonly logger = new Logger(OcrService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly extractionService: ExtractionService,
    private readonly documentsService: DocumentsService,
    private readonly settings: SettingsService,
  ) {}

  /** Return the absolute path to the Python OCR script */
  private get scriptPath(): string {
    return join(process.cwd(), "src", "main", "python", "ocr_rapidocr.py");
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

    // If extractionType is AUTO, detect it now and persist so downstream
    // processors (PDF vs image vs excel) know which pipeline to run.
    if (!doc.extractionType || doc.extractionType === "AUTO") {
      const detected = this.documentsService.detectExtractionType(
        doc.imagePath,
      );
      await this.prisma.document.updateMany({
        where: { id: documentId },
        data: { extractionType: detected },
      });
      this.logger.log(
        `AUTO → resolved extractionType=${detected} for ${documentId}`,
      );
    }

    // Mark as PROCESSING — use updateMany so a mid-flight delete doesn't throw
    await this.prisma.document.updateMany({
      where: { id: documentId },
      data: { status: "PROCESSING" },
    });

    let ocrResult: OcrResult;
    try {
      ocrResult = await this.runPythonOcr(doc.imagePath);
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
    }

    // Persist OCR result — updateMany is a no-op if doc was deleted mid-flight
    await this.prisma.document.updateMany({
      where: { id: documentId },
      data: {
        status: "REVIEW",
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
    await this.runFieldExtraction(documentId, ocrResult.fullText);

    return ocrResult;
  }

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
      this.logger.log(
        `Spawning: ${pythonExe} ${script} --image "${imagePath}"`,
      );

      const child = spawn(pythonExe, [script, "--image", imagePath], {
        windowsHide: true,
      });

      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      const timer = setTimeout(() => {
        child.kill();
        reject(new Error(`OCR timed out after ${cfg.timeout}s`));
      }, timeoutMs);

      child.on("close", (code) => {
        clearTimeout(timer);
        if (stderr) this.logger.warn(`[ocr-sidecar stderr] ${stderr.trim()}`);

        try {
          const parsed = JSON.parse(stdout.trim());
          if (parsed.error) {
            reject(new Error(parsed.error));
          } else {
            resolve(parsed as OcrResult);
          }
        } catch {
          reject(
            new Error(
              `OCR sidecar exited with code ${code}. stderr: ${stderr.slice(0, 300)}`,
            ),
          );
        }
      });

      child.on("error", (err) => {
        clearTimeout(timer);
        reject(new Error(`Failed to start Python: ${err.message}`));
      });
    });
  }

  /**
   * If the document belongs to a TABLE_EXTRACT session, run local QA extraction
   * over all session columns and persist the results in extractedRow.
   */
  private async runFieldExtraction(
    documentId: string,
    ocrText: string,
  ): Promise<void> {
    try {
      const doc = await this.prisma.document.findUnique({
        where: { id: documentId },
        include: { session: true },
      });

      if (!doc?.session || doc.session.mode !== "TABLE_EXTRACT") return;

      const columns: SessionColumn[] = JSON.parse(doc.session.columns || "[]");
      if (columns.length === 0) return;

      this.logger.log(
        `Running TABLE_EXTRACT for "${doc.filename}" (${columns.length} fields)`,
      );
      const results = await this.extractionService.extractFields(
        columns,
        ocrText,
      );

      await this.prisma.document.update({
        where: { id: documentId },
        data: { extractedRow: JSON.stringify(results) },
      });

      this.logger.log(`Field extraction complete for "${doc.filename}"`);
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
    }
  }
}
