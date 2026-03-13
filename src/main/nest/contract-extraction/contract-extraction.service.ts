import { Injectable, Logger } from "@nestjs/common";
import { spawn } from "child_process";
import { join } from "path";
import { existsSync } from "fs";
import { PrismaService } from "../prisma/prisma.service";
import { SettingsService } from "../settings/settings.service";

export interface ContractHeader {
  carrier: string;
  contractId: string;
  effectiveDate: string;
  expirationDate: string;
}

export interface ContractExtractionResult {
  header: ContractHeader;
  rates: Record<string, string>[];
  originArbs: Record<string, string>[];
  destArbs: Record<string, string>[];
  rawPages: { page: number; text: string }[];
  pageCount: number;
  processingTime: number;
  warnings: string[];
}

@Injectable()
export class ContractExtractionService {
  private readonly logger = new Logger(ContractExtractionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  private get scriptPath(): string {
    return join(
      process.cwd(),
      "src",
      "main",
      "python",
      "pdf_contract_extract.py",
    );
  }

  private resolvePythonExe(): string {
    const cfg = this.settings.getAll().ocr;
    const configured = cfg.pythonPath || "python";

    if (configured && configured !== "python" && configured !== "python3") {
      return configured;
    }

    const root = process.cwd();
    const candidates = [
      join(root, ".venv", "Scripts", "python.exe"),
      join(root, ".venv", "bin", "python"),
    ];
    for (const candidate of candidates) {
      if (existsSync(candidate)) {
        return candidate;
      }
    }

    return configured;
  }

  /** Process a PDF_EXTRACT document through the Python sidecar */
  async process(documentId: string): Promise<ContractExtractionResult> {
    const doc = await this.prisma.document.findUnique({
      where: { id: documentId },
    });

    if (!doc) {
      this.logger.warn(`Document ${documentId} no longer exists — skipping`);
      return this.emptyResult();
    }

    await this.prisma.document.updateMany({
      where: { id: documentId },
      data: { status: "PROCESSING" },
    });

    let result: ContractExtractionResult;
    try {
      result = await this.runPythonExtractor(doc.imagePath);
    } catch (err: any) {
      await this.prisma.document.updateMany({
        where: { id: documentId },
        data: {
          status: "ERROR",
          ocrWarnings: JSON.stringify([String(err?.message ?? err)]),
        },
      });
      throw err;
    }

    await this.prisma.document.updateMany({
      where: { id: documentId },
      data: {
        status: "REVIEW",
        processedAt: new Date(),
        ocrPageCount: result.pageCount,
        ocrProcessingTime: result.processingTime,
        ocrWarnings: JSON.stringify(result.warnings),
        // Store the structured contract data in extractedJson
        extractedJson: JSON.stringify({
          type: "CONTRACT",
          header: result.header,
          rates: result.rates,
          originArbs: result.originArbs,
          destArbs: result.destArbs,
          rawPages: result.rawPages ?? [],
        }),
      },
    });

    return result;
  }

  private runPythonExtractor(pdfPath: string): Promise<ContractExtractionResult> {
    const pythonExe = this.resolvePythonExe();
    const script = this.scriptPath;
    const cfg = this.settings.getAll().ocr;
    // Contract PDFs can be 100+ pages of dense tables; use a dedicated
    // minimum of 600 s regardless of the OCR timeout setting.
    const CONTRACT_TIMEOUT_S = Math.max(cfg.timeout ?? 180, 600);
    const timeoutMs = CONTRACT_TIMEOUT_S * 1000;

    if (!existsSync(script)) {
      return Promise.reject(
        new Error(`Contract extraction script not found: ${script}`),
      );
    }

    return new Promise((resolve, reject) => {
      this.logger.log(
        `Spawning: ${pythonExe} ${script} --pdf "${pdfPath}"`,
      );

      const child = spawn(pythonExe, ["-u", script, "--pdf", pdfPath], {
        windowsHide: true,
        env: { ...process.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" },
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
        reject(new Error(`Contract extraction timed out after ${CONTRACT_TIMEOUT_S}s`));
      }, timeoutMs);

      child.on("close", (code) => {
        clearTimeout(timer);
        if (stderr) {
          this.logger.warn(`[contract-extract stderr] ${stderr.trim()}`);
        }

        // PyMuPDF may print informational lines to stdout before the JSON
        // (e.g. "Consider using the pymupdf_layout package…").
        // Find the first '{' to locate the start of our JSON payload.
        const jsonStart = stdout.indexOf('{');
        try {
          if (jsonStart < 0) {
            throw new Error('No JSON object found in output');
          }
          const parsed = JSON.parse(stdout.slice(jsonStart));
          if (parsed.error) {
            reject(new Error(parsed.error));
          } else {
            resolve(parsed as ContractExtractionResult);
          }
        } catch {
          reject(
            new Error(
              `Contract extractor exited with code ${code}.\nstderr: ${stderr.slice(0, 500)}\nstdout: ${stdout.slice(0, 500)}`,
            ),
          );
        }
      });
    });
  }

  private emptyResult(): ContractExtractionResult {
    return {
      header: { carrier: "", contractId: "", effectiveDate: "", expirationDate: "" },
      rates: [],
      originArbs: [],
      destArbs: [],
      rawPages: [],
      pageCount: 0,
      processingTime: 0,
      warnings: [],
    };
  }
}
