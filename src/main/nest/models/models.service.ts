import { Injectable, Logger } from "@nestjs/common";
import { spawn } from "child_process";
import { existsSync } from "fs";
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
    id: "docling",
    name: "Docling 2.x",
    description:
      "IBM open-source document parser. Handles multi-column layouts, tables, and mixed content. Best overall accuracy for logistics documents.",
    pipPackages: ["docling"],
    pipListName: "docling",
    recommended: true,
    size: "~600 MB",
  },
  {
    id: "pdfplumber",
    name: "pdfplumber",
    description:
      "Lightweight text and table extractor. Fast and precise for digitally-created PDFs with simple layouts.",
    pipPackages: ["pdfplumber"],
    pipListName: "pdfplumber",
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

@Injectable()
export class ModelsService {
  private readonly logger = new Logger(ModelsService.name);

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

    const py = this.resolvePythonExe();

    const args = ["-m", "pip", "install", "--upgrade", ...def.pipPackages];
    this.logger.log(`Installing model "${def.name}": ${py} ${args.join(" ")}`);

    return new Promise((resolve) => {
      const child = spawn(py, args, { windowsHide: true });
      let output = "";
      child.stdout.on("data", (d: Buffer) => (output += d.toString("utf-8")));
      child.stderr.on("data", (d: Buffer) => (output += d.toString("utf-8")));
      child.on("close", (code) => {
        this.logger.log(`pip install exited with code ${code}`);
        resolve({ ok: code === 0, log: output });
      });
      child.on("error", (err) => {
        resolve({ ok: false, log: `Failed to spawn pip: ${err.message}` });
      });
    });
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
}
