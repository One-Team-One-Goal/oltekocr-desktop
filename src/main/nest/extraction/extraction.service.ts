import { Injectable, Logger } from "@nestjs/common";
import { spawn } from "child_process";
import { existsSync } from "fs";
import { join } from "path";
import type { SessionColumn } from "@shared/types";
import { SettingsService } from "../settings/settings.service";

export interface ExtractionResult {
  answer: string;
  score: number;
}

@Injectable()
export class ExtractionService {
  private readonly logger = new Logger(ExtractionService.name);
  private readonly fallbackModelId = "qwen3:30b";
  private ready = false;
  private loadError: string | null = null;

  constructor(private readonly settings: SettingsService) {}

  private get scriptPath(): string {
    return join(process.cwd(), "src", "main", "python", "qa_ollama.py");
  }

  private resolvePythonExe(): string {
    const root = process.cwd();
    const localCandidates = [
      join(root, ".venv", "Scripts", "python.exe"),
      join(root, ".venv", "bin", "python"),
    ];
    for (const candidate of localCandidates) {
      if (existsSync(candidate)) return candidate;
    }
    const configured = this.settings.getAll().ocr.pythonPath || "python";
    return configured;
  }

  getSelectedModelId(): string {
    const selected = this.settings.getAll().llm?.defaultModel;
    return (selected && selected.trim()) || this.fallbackModelId;
  }

  private runOllamaExtraction(
    columns: SessionColumn[],
    context: string,
  ): Promise<Record<string, ExtractionResult>> {
    const script = this.scriptPath;
    if (!existsSync(script)) {
      return Promise.reject(
        new Error(`Ollama QA sidecar script not found: ${script}`),
      );
    }

    const pythonExe = this.resolvePythonExe();
    const modelId = this.getSelectedModelId();
    // Ollama needs substantially more time than OCR — allow at least 600s
    const timeoutSec = Math.max(
      (this.settings.getAll().ocr.timeout ?? 120) * 5,
      600,
    );
    const timeoutMs = timeoutSec * 1000;

    return new Promise((resolve, reject) => {
      const child = spawn(pythonExe, [script, "--model", modelId], {
        windowsHide: true,
      });

      let stdout = "";
      let stderr = "";

      const payload = JSON.stringify({
        context,
        columns: columns.map((c) => ({
          key: c.key,
          question: c.question,
        })),
      });

      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      const timer = setTimeout(() => {
        child.kill();
        reject(new Error(`Ollama extraction timed out after ${timeoutSec}s`));
      }, timeoutMs);

      child.on("close", (code) => {
        clearTimeout(timer);
        if (stderr.trim()) {
          this.logger.warn(`[qa-sidecar stderr] ${stderr.trim()}`);
        }

        try {
          const parsed = JSON.parse(stdout.trim() || "{}");
          if (parsed.error) {
            reject(new Error(String(parsed.error)));
            return;
          }
          if (!parsed.results || typeof parsed.results !== "object") {
            reject(
              new Error(
                `Invalid QA sidecar response (exit ${code}): ${stdout.slice(0, 400)}`,
              ),
            );
            return;
          }
          resolve(parsed.results as Record<string, ExtractionResult>);
        } catch {
          reject(
            new Error(
              `QA sidecar exited with code ${code}. stderr: ${stderr.slice(0, 400)}`,
            ),
          );
        }
      });

      child.on("error", (err) => {
        clearTimeout(timer);
        reject(new Error(`Failed to start Ollama QA sidecar: ${err.message}`));
      });

      this.logger.log(`Using TABLE_EXTRACT LLM model: ${modelId}`);

      child.stdin.write(payload);
      child.stdin.end();
    });
  }

  async extractField(
    question: string,
    context: string,
  ): Promise<ExtractionResult> {
    const single: SessionColumn = {
      key: "__single__",
      label: "single",
      question,
    };

    const results = await this.runOllamaExtraction([single], context);
    return results.__single__ ?? { answer: "", score: 0 };
  }

  /**
   * Extract all session columns from document OCR text.
   * Returns a map of column.key → { answer, score }.
   */
  async extractFields(
    columns: SessionColumn[],
    ocrText: string,
  ): Promise<Record<string, ExtractionResult>> {
    this.logger.log(`Running Ollama QA sidecar (${columns.length} fields)`);

    const results = await this.runOllamaExtraction(columns, ocrText);
    this.ready = true;
    this.loadError = null;

    for (const col of columns) {
      if (!results[col.key]) {
        results[col.key] = { answer: "", score: 0 };
      }
      this.logger.debug(
        `  ${col.label}: "${results[col.key].answer}" (score: ${results[col.key].score.toFixed(3)})`,
      );
    }

    return results;
  }

  isReady(): boolean {
    return this.ready;
  }

  getLoadError(): string | null {
    return this.loadError;
  }
}
