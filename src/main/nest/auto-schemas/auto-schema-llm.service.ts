import { Injectable, Logger } from "@nestjs/common";
import { spawn } from "child_process";
import { existsSync } from "fs";
import { join } from "path";
import { SettingsService } from "../settings/settings.service";

@Injectable()
export class AutoSchemaLlmService {
  private readonly logger = new Logger(AutoSchemaLlmService.name);
  private readonly fallbackModelId = "qwen3:30b";

  constructor(private readonly settings: SettingsService) {}

  private get scriptPath(): string {
    return join(process.cwd(), "src", "main", "python", "pdf_automatic_extractor_llm.py");
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

    return this.settings.getAll().ocr.pythonPath || "python";
  }

  private getSelectedModelId(): string {
    const selected = this.settings.getAll().llm?.defaultModel;
    return (selected && selected.trim()) || this.fallbackModelId;
  }

  async generateStructuredSchema(params: {
    doclingJson: Record<string, unknown>;
    model?: string;
    baseUrl?: string;
  }): Promise<Record<string, unknown>> {
    const script = this.scriptPath;
    if (!existsSync(script)) {
      throw new Error(`Auto schema LLM script not found: ${script}`);
    }

    const pythonExe = this.resolvePythonExe();
    const timeoutSec = Math.max((this.settings.getAll().ocr.timeout ?? 120) * 4, 480);
    const timeoutMs = timeoutSec * 1000;
    const modelId = params.model?.trim() || this.getSelectedModelId();
    const baseUrl = params.baseUrl?.trim() || "http://127.0.0.1:11434";

    return new Promise((resolve, reject) => {
      const child = spawn(pythonExe, [script, "--model", modelId, "--base-url", baseUrl], {
        windowsHide: true,
      });

      let stdout = "";
      let stderr = "";

      const timer = setTimeout(() => {
        child.kill();
        reject(new Error(`Auto schema LLM extraction timed out after ${timeoutSec}s`));
      }, timeoutMs);

      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
      });

      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      child.on("close", (code) => {
        clearTimeout(timer);

        if (stderr.trim()) {
          this.logger.warn(`[pdf_automatic_extractor_llm stderr] ${stderr.trim()}`);
        }

        if (code !== 0) {
          // If non-zero exit, include stderr and stdout in error
          const errorContext = stderr.trim() || stdout.trim().slice(0, 500);
          reject(
            new Error(
              `LLM schema sidecar exited with code ${code}. Details: ${errorContext || "(no output)"}`
            ),
          );
          return;
        }

        try {
          const parsed = JSON.parse(stdout.trim() || "{}");
          if (parsed.error) {
            reject(new Error(String(parsed.error)));
            return;
          }

          const result = parsed.result;
          if (!result || typeof result !== "object") {
            reject(
              new Error(`Invalid LLM schema response: ${stdout.slice(0, 500)}`),
            );
            return;
          }

          resolve(result as Record<string, unknown>);
        } catch (parseErr) {
          reject(
            new Error(
              `Failed to parse LLM response. stdout: ${stdout.slice(0, 500)}, stderr: ${stderr.slice(0, 500)}`
            ),
          );
        }
      });

      child.on("error", (err) => {
        clearTimeout(timer);
        reject(new Error(`Failed to start LLM schema sidecar: ${err.message}`));
      });

      this.logger.log(`Using LLM model for auto schema extraction: ${modelId}`);

      child.stdin.write(
        JSON.stringify({
          docling_json: params.doclingJson,
        }),
      );
      child.stdin.end();
    });
  }
}
