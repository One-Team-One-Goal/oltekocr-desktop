import { Injectable, Logger } from "@nestjs/common";
import { ChildProcess, spawn } from "child_process";
import { existsSync } from "fs";
import os from "os";
import { join } from "path";
import { SettingsService } from "../settings/settings.service";

// ─── Model registry ──────────────────────────────────────
// Maps our UI model IDs → the pip package(s) to install and the
// canonical import name used to check whether a package is present.

export interface ModelDef {
  id: string;
  name: string;
  description: string;
  pipPackages: string[]; // `pip install --upgrade <these>`
  /** The package name as it appears in `pip list` (normalised lower-case). */
  pipListName: string;
  recommended?: boolean;
  size: string;
}

export const MODEL_REGISTRY: ModelDef[] = [
  {
    id: "pdfplumber",
    name: "pdfplumber",
    description:
      "Lightweight text and table extractor. Fast and precise for digitally-created PDFs with simple layouts.",
    pipPackages: ["pdfplumber"],
    pipListName: "pdfplumber",
    recommended: true,
    size: "8 MB",
  },
  {
    id: "pymupdf",
    name: "PyMuPDF (fitz)",
    description:
      "High-speed text extraction using the MuPDF engine. Excellent for clean text PDFs and image-heavy documents.",
    pipPackages: ["pymupdf"],
    pipListName: "pymupdf",
    size: "12 MB",
  },
  {
    id: "unstructured",
    name: "Unstructured.io",
    description:
      "Versatile document parser supporting PDF, DOCX, HTML, images, and more. Handles a wide range of real-world document layouts.",
    pipPackages: ["unstructured"],
    pipListName: "unstructured",
    size: "~400 MB",
  },
];

export interface ModelStatus {
  id: string;
  name: string;
  description: string;
  recommended: boolean;
  downloaded: boolean;
  size: string;
}

export interface LlmModelStatus {
  id: string;
  name: string;
  description: string;
  recommended: boolean;
  downloaded: boolean;
  size: string;
}

export interface LlmRecommendation {
  recommendedId: string;
  ramGb: number;
  logicalCores: number;
  reason: string;
}

type LlmCatalogDef = {
  id: string;
  name: string;
  description: string;
  recommended?: boolean;
  size?: string;
};

type OllamaTagModel = {
  name: string;
  size?: number;
  details?: {
    parameter_size?: string;
  };
};

function matchesOllamaModelName(
  installedName: string,
  catalogId: string,
): boolean {
  if (installedName === catalogId) return true;
  if (installedName === `${catalogId}:latest`) return true;
  if (catalogId.endsWith(":latest")) {
    return installedName === catalogId.replace(/:latest$/, "");
  }
  return false;
}

interface LlmInstallProgress {
  modelId: string;
  active: boolean;
  percent: number | null;
  downloadedMb: number | null;
  totalMb: number | null;
  speedMbps: number | null;
  eta: string | null;
  lastLine: string | null;
}

const LLM_CATALOG: LlmCatalogDef[] = [
  {
    id: "qwen3:30b",
    name: "qwen3:30b",
    description:
      "High-capacity Qwen model for stronger extraction quality on workstation-class systems.",
    size: "~18-20 GB",
  },
  {
    id: "qwen2.5:1.5b",
    name: "qwen2.5:1.5b",
    description:
      "Smallest practical Qwen option for low-memory systems and lightweight extraction.",
    size: "~1 GB",
  },
  {
    id: "qwen2.5:3b",
    name: "qwen2.5:3b",
    description:
      "Best default for i5 + 16GB RAM + integrated GPU. Strong extraction quality with stable latency.",
    size: "~2 GB",
  },
  {
    id: "qwen2.5:7b",
    name: "qwen2.5:7b",
    description:
      "Higher quality Qwen option for mid/high-tier desktops with more memory headroom.",
    size: "~4.7 GB",
  },
  {
    id: "qwen2.5:14b",
    name: "qwen2.5:14b",
    description:
      "Large Qwen model for stronger reasoning and extraction on high-memory systems.",
    size: "~9 GB",
  },
  {
    id: "qwen2.5:32b",
    name: "qwen2.5:32b",
    description: "Top-end Qwen option intended for workstation-class hardware.",
    size: "~20 GB",
  },
];

@Injectable()
export class ModelsService {
  private readonly logger = new Logger(ModelsService.name);
  private readonly ollamaBaseUrl = "http://127.0.0.1:11434";
  private readonly activePipInstalls = new Map<string, ChildProcess>();
  private readonly activeLlmInstalls = new Map<string, ChildProcess>();
  private readonly llmInstallProgress = new Map<string, LlmInstallProgress>();

  constructor(private readonly settings: SettingsService) {}

  // ── Python executable resolution ─────────────────────────
  private resolvePythonExe(): string {
    const configured = this.settings.getAll().ocr.pythonPath || "python";
    if (configured !== "python" && configured !== "python3") return configured;

    const root = process.cwd();
    const candidates = [
      join(root, ".venv", "Scripts", "python.exe"),
      join(root, ".venv", "bin", "python"),
    ];
    for (const c of candidates) {
      if (existsSync(c)) return c;
    }
    return configured;
  }

  /** Derive the pip executable from the python path */
  private resolvePipExe(): string {
    const py = this.resolvePythonExe();
    // In a venv: .venv/Scripts/python.exe → .venv/Scripts/pip.exe
    const dir = join(py, "..");
    const pipCandidate = join(
      dir,
      process.platform === "win32" ? "pip.exe" : "pip",
    );
    if (existsSync(pipCandidate)) return pipCandidate;
    // Fallback: run pip through the python interpreter
    return py;
  }

  // ── pip list ─────────────────────────────────────────────
  /** Return the set of installed package names (lower-cased). */
  private async getInstalledPackages(): Promise<Set<string>> {
    const py = this.resolvePythonExe();
    return new Promise((resolve) => {
      const child = spawn(py, ["-m", "pip", "list", "--format=json"], {
        windowsHide: true,
      });
      let stdout = "";
      child.stdout.on("data", (d: Buffer) => (stdout += d.toString("utf-8")));
      child.on("close", () => {
        try {
          const list: { name: string }[] = JSON.parse(stdout);
          resolve(new Set(list.map((p) => p.name.toLowerCase())));
        } catch {
          this.logger.warn("Failed to parse pip list output");
          resolve(new Set());
        }
      });
      child.on("error", () => resolve(new Set()));
    });
  }

  // ── Public API ───────────────────────────────────────────

  /** List all models with their download (installed) status. */
  async listModels(): Promise<ModelStatus[]> {
    const installed = await this.getInstalledPackages();
    return MODEL_REGISTRY.map((m) => ({
      id: m.id,
      name: m.name,
      description: m.description,
      recommended: !!m.recommended,
      downloaded: installed.has(m.pipListName.toLowerCase()),
      size: m.size,
    }));
  }

  /** Install (download) a model — runs `pip install --upgrade <packages>`. */
  async installModel(modelId: string): Promise<{ ok: boolean; log: string }> {
    const def = MODEL_REGISTRY.find((m) => m.id === modelId);
    if (!def) return { ok: false, log: `Unknown model: ${modelId}` };
    if (this.activePipInstalls.has(modelId)) {
      return { ok: false, log: `Install already in progress for ${modelId}` };
    }

    const py = this.resolvePythonExe();

    const args = ["-m", "pip", "install", "--upgrade", ...def.pipPackages];
    this.logger.log(`Installing model "${def.name}": ${py} ${args.join(" ")}`);

    return new Promise((resolve) => {
      const child = spawn(py, args, { windowsHide: true });
      this.activePipInstalls.set(modelId, child);
      let output = "";
      child.stdout.on("data", (d: Buffer) => (output += d.toString("utf-8")));
      child.stderr.on("data", (d: Buffer) => (output += d.toString("utf-8")));
      child.on("close", (code) => {
        this.activePipInstalls.delete(modelId);
        this.logger.log(`pip install exited with code ${code}`);
        resolve({ ok: code === 0, log: output });
      });
      child.on("error", (err) => {
        this.activePipInstalls.delete(modelId);
        resolve({ ok: false, log: `Failed to spawn pip: ${err.message}` });
      });
    });
  }

  async cancelInstallModel(
    modelId: string,
  ): Promise<{ ok: boolean; log: string }> {
    const child = this.activePipInstalls.get(modelId);
    if (!child) {
      return { ok: false, log: `No active install for ${modelId}` };
    }

    this.logger.warn(`Cancelling pip install for ${modelId}`);
    child.kill("SIGTERM");
    setTimeout(() => {
      if (!child.killed) child.kill("SIGKILL");
    }, 2500);

    return { ok: true, log: `Cancellation requested for ${modelId}` };
  }

  /** Uninstall (delete) a model — runs `pip uninstall -y <packages>`. */
  async uninstallModel(modelId: string): Promise<{ ok: boolean; log: string }> {
    const def = MODEL_REGISTRY.find((m) => m.id === modelId);
    if (!def) return { ok: false, log: `Unknown model: ${modelId}` };

    const py = this.resolvePythonExe();
    const args = ["-m", "pip", "uninstall", "-y", ...def.pipPackages];
    this.logger.log(
      `Uninstalling model "${def.name}": ${py} ${args.join(" ")}`,
    );

    return new Promise((resolve) => {
      const child = spawn(py, args, { windowsHide: true });
      let output = "";
      child.stdout.on("data", (d: Buffer) => (output += d.toString("utf-8")));
      child.stderr.on("data", (d: Buffer) => (output += d.toString("utf-8")));
      child.on("close", (code) => {
        this.logger.log(`pip uninstall exited with code ${code}`);
        resolve({ ok: code === 0, log: output });
      });
      child.on("error", (err) => {
        resolve({ ok: false, log: `Failed to spawn pip: ${err.message}` });
      });
    });
  }

  // ── Ollama LLM models ──────────────────────────────────

  private formatBytes(bytes?: number): string {
    if (!bytes || bytes <= 0) return "Unknown";
    const units = ["B", "KB", "MB", "GB", "TB"];
    let value = bytes;
    let unitIndex = 0;
    while (value >= 1024 && unitIndex < units.length - 1) {
      value /= 1024;
      unitIndex += 1;
    }
    return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
  }

  private async fetchOllamaTags(): Promise<OllamaTagModel[]> {
    try {
      const res = await fetch(`${this.ollamaBaseUrl}/api/tags`);
      if (!res.ok) {
        this.logger.warn(`Ollama /api/tags failed: ${res.status}`);
        return [];
      }
      const json = (await res.json()) as { models?: OllamaTagModel[] };
      return Array.isArray(json.models) ? json.models : [];
    } catch (err: any) {
      this.logger.warn(`Unable to read Ollama tags: ${err?.message ?? err}`);
      return [];
    }
  }

  private getDeviceProfile(): { ramGb: number; logicalCores: number } {
    const ramGb = Math.max(1, Math.floor(os.totalmem() / 1024 ** 3));
    const logicalCores = Math.max(1, os.cpus()?.length ?? 1);
    return { ramGb, logicalCores };
  }

  private pickRecommendedLlmId(): string {
    const { ramGb, logicalCores } = this.getDeviceProfile();

    // Conservative CPU-first heuristic for typical local Ollama usage.
    let candidate = "qwen2.5:32b";
    if (ramGb < 10) candidate = "qwen2.5:1.5b";
    else if (ramGb < 18) candidate = "qwen2.5:3b";
    else if (ramGb < 30) candidate = "qwen2.5:7b";
    else if (ramGb < 50) candidate = "qwen2.5:14b";

    if (logicalCores <= 4) {
      if (candidate === "qwen2.5:32b") candidate = "qwen2.5:14b";
      else if (candidate === "qwen2.5:14b") candidate = "qwen2.5:7b";
      else if (candidate === "qwen2.5:7b") candidate = "qwen2.5:3b";
    }

    return candidate;
  }

  private buildRecommendationReason(
    recommendedId: string,
    ramGb: number,
    logicalCores: number,
  ): string {
    return `${recommendedId} selected from ${ramGb} GB RAM and ${logicalCores} CPU threads.`;
  }

  getLlmRecommendation(): LlmRecommendation {
    const { ramGb, logicalCores } = this.getDeviceProfile();
    const recommendedId = this.pickRecommendedLlmId();
    return {
      recommendedId,
      ramGb,
      logicalCores,
      reason: this.buildRecommendationReason(
        recommendedId,
        ramGb,
        logicalCores,
      ),
    };
  }

  async listLlmModels(): Promise<LlmModelStatus[]> {
    const recommendedId = this.getLlmRecommendation().recommendedId;
    const installed = await this.fetchOllamaTags();

    const catalogModels = LLM_CATALOG.map((model) => {
      const installedTag = installed.find((m) =>
        matchesOllamaModelName(m.name, model.id),
      );
      return {
        id: model.id,
        name: model.name,
        description: model.description,
        recommended: model.id === recommendedId,
        downloaded: !!installedTag,
        size:
          model.size ??
          installedTag?.details?.parameter_size ??
          this.formatBytes(installedTag?.size),
      };
    });

    const otherInstalled = installed
      .filter(
        (m) =>
          !LLM_CATALOG.some((catalog) =>
            matchesOllamaModelName(m.name, catalog.id),
          ),
      )
      .map((m) => ({
        id: m.name,
        name: m.name,
        description: "Installed local Ollama model",
        recommended: false,
        downloaded: true,
        size: m.details?.parameter_size ?? this.formatBytes(m.size),
      }));

    return [...catalogModels, ...otherInstalled];
  }

  private resolveOllamaExe(): string {
    return process.platform === "win32" ? "ollama.exe" : "ollama";
  }

  private bytesToMb(bytes: number): number {
    return bytes / (1024 * 1024);
  }

  private parseAmountToBytes(value: string, unit: string): number {
    const n = Number(value);
    if (!Number.isFinite(n)) return 0;
    const u = unit.toUpperCase();
    if (u === "B") return n;
    if (u === "KB") return n * 1024;
    if (u === "MB") return n * 1024 * 1024;
    if (u === "GB") return n * 1024 * 1024 * 1024;
    if (u === "TB") return n * 1024 * 1024 * 1024 * 1024;
    return 0;
  }

  private updateLlmProgress(modelId: string, line: string): void {
    const base: LlmInstallProgress = this.llmInstallProgress.get(modelId) ?? {
      modelId,
      active: true,
      percent: null,
      downloadedMb: null,
      totalMb: null,
      speedMbps: null,
      eta: null,
      lastLine: null,
    };

    const next: LlmInstallProgress = {
      ...base,
      active: true,
      lastLine: line,
    };

    const percentMatch = line.match(/(\d{1,3})%/);
    if (percentMatch) {
      const p = Number(percentMatch[1]);
      if (Number.isFinite(p)) next.percent = Math.max(0, Math.min(100, p));
    }

    const amountMatch = line.match(
      /(\d+(?:\.\d+)?)\s*(B|KB|MB|GB|TB)\s*\/\s*(\d+(?:\.\d+)?)\s*(B|KB|MB|GB|TB)/i,
    );
    if (amountMatch) {
      const downloadedBytes = this.parseAmountToBytes(
        amountMatch[1],
        amountMatch[2],
      );
      const totalBytes = this.parseAmountToBytes(
        amountMatch[3],
        amountMatch[4],
      );
      if (downloadedBytes > 0) {
        next.downloadedMb = Number(this.bytesToMb(downloadedBytes).toFixed(1));
      }
      if (totalBytes > 0) {
        next.totalMb = Number(this.bytesToMb(totalBytes).toFixed(1));
      }
      if (
        next.percent === null &&
        totalBytes > 0 &&
        Number.isFinite(downloadedBytes)
      ) {
        next.percent = Math.max(
          0,
          Math.min(100, Math.round((downloadedBytes / totalBytes) * 100)),
        );
      }
    }

    const speedMatch = line.match(
      /(\d+(?:\.\d+)?)\s*(B|KB|MB|GB|TB)\s*\/\s*s/i,
    );
    if (speedMatch) {
      const speedBytes = this.parseAmountToBytes(speedMatch[1], speedMatch[2]);
      if (speedBytes > 0) {
        next.speedMbps = Number(this.bytesToMb(speedBytes).toFixed(2));
      }
    }

    const etaMatch = line.match(/\b(\d+h\d+m\d+s|\d+m\d+s|\d+s)\b/i);
    if (etaMatch) {
      next.eta = etaMatch[1];
    }

    this.llmInstallProgress.set(modelId, next);
  }

  getLlmInstallProgress(modelId: string): LlmInstallProgress {
    const existing = this.llmInstallProgress.get(modelId);
    if (existing) return existing;
    return {
      modelId,
      active: this.activeLlmInstalls.has(modelId),
      percent: null,
      downloadedMb: null,
      totalMb: null,
      speedMbps: null,
      eta: null,
      lastLine: null,
    };
  }

  async installLlmModel(
    modelId: string,
  ): Promise<{ ok: boolean; log: string }> {
    if (this.activeLlmInstalls.has(modelId)) {
      return { ok: false, log: `Install already in progress for ${modelId}` };
    }

    const ollamaExe = this.resolveOllamaExe();

    return new Promise((resolve) => {
      const child = spawn(ollamaExe, ["pull", modelId], {
        windowsHide: true,
      });
      this.activeLlmInstalls.set(modelId, child);
      this.llmInstallProgress.set(modelId, {
        modelId,
        active: true,
        percent: 0,
        downloadedMb: null,
        totalMb: null,
        speedMbps: null,
        eta: null,
        lastLine: "Starting download...",
      });

      let output = "";
      child.stdout.on("data", (d: Buffer) => {
        const text = d.toString("utf-8");
        output += text;
        for (const rawLine of text.split(/\r?\n/)) {
          const line = rawLine.trim();
          if (!line) continue;
          this.updateLlmProgress(modelId, line);
        }
      });
      child.stderr.on("data", (d: Buffer) => {
        const text = d.toString("utf-8");
        output += text;
        for (const rawLine of text.split(/\r?\n/)) {
          const line = rawLine.trim();
          if (!line) continue;
          this.updateLlmProgress(modelId, line);
        }
      });
      child.on("close", (code) => {
        this.activeLlmInstalls.delete(modelId);
        const prev = this.llmInstallProgress.get(modelId);
        this.llmInstallProgress.set(modelId, {
          ...(prev ?? {
            modelId,
            percent: null,
            downloadedMb: null,
            totalMb: null,
            speedMbps: null,
            eta: null,
            lastLine: null,
          }),
          active: false,
          percent: code === 0 ? 100 : (prev?.percent ?? null),
          lastLine:
            code === 0
              ? `Downloaded ${modelId}`
              : `Download failed (exit ${code})`,
        });
        resolve({
          ok: code === 0,
          log:
            output ||
            (code === 0
              ? `Pulled ${modelId}`
              : `ollama pull exited with code ${code}`),
        });
      });
      child.on("error", (err) => {
        this.activeLlmInstalls.delete(modelId);
        const prev = this.llmInstallProgress.get(modelId);
        this.llmInstallProgress.set(modelId, {
          ...(prev ?? {
            modelId,
            percent: null,
            downloadedMb: null,
            totalMb: null,
            speedMbps: null,
            eta: null,
            lastLine: null,
          }),
          active: false,
          lastLine: `Failed to start download: ${err.message}`,
        });
        resolve({
          ok: false,
          log: `Failed to run ollama pull for ${modelId}: ${err.message}`,
        });
      });
    });
  }

  async cancelInstallLlmModel(
    modelId: string,
  ): Promise<{ ok: boolean; log: string }> {
    const child = this.activeLlmInstalls.get(modelId);
    if (!child) {
      return { ok: false, log: `No active install for ${modelId}` };
    }

    this.logger.warn(`Cancelling ollama pull for ${modelId}`);
    child.kill("SIGTERM");
    const prev = this.llmInstallProgress.get(modelId);
    this.llmInstallProgress.set(modelId, {
      ...(prev ?? {
        modelId,
        percent: null,
        downloadedMb: null,
        totalMb: null,
        speedMbps: null,
        eta: null,
        lastLine: null,
      }),
      active: false,
      lastLine: "Cancellation requested",
    });
    setTimeout(() => {
      if (!child.killed) child.kill("SIGKILL");
    }, 2500);

    return { ok: true, log: `Cancellation requested for ${modelId}` };
  }

  async uninstallLlmModel(
    modelId: string,
  ): Promise<{ ok: boolean; log: string }> {
    try {
      const res = await fetch(`${this.ollamaBaseUrl}/api/delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: modelId }),
      });
      const text = await res.text();
      if (!res.ok) {
        return {
          ok: false,
          log: text || `Ollama delete failed with HTTP ${res.status}`,
        };
      }
      return { ok: true, log: text || `Deleted ${modelId}` };
    } catch (err: any) {
      return {
        ok: false,
        log: `Failed to delete model ${modelId}: ${err?.message ?? err}`,
      };
    }
  }
}
