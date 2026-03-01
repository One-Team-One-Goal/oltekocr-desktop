import { Injectable, Logger } from "@nestjs/common";
import type { SessionColumn } from "@shared/types";

export interface ExtractionResult {
  answer: string;
  score: number;
}

/**
 * Local RoBERTa-based QA extraction service.
 * Uses @xenova/transformers to run Xenova/deepset-roberta-base-squad2
 * locally — no API key required after first model download (~500 MB).
 *
 * Falls back gracefully if the model fails to load (returns empty answers).
 */
@Injectable()
export class ExtractionService {
  private readonly logger = new Logger(ExtractionService.name);
  private readonly modelCandidates = [
    "Xenova/distilbert-base-cased-distilled-squad",
    "Xenova/bert-large-uncased-whole-word-masking-finetuned-squad",
    "Xenova/deepset-roberta-base-squad2",
  ];

  // Lazy-loaded QA pipeline
  private pipeline: any = null;
  private loading = false;
  private loadFailed = false;
  private loadError: string | null = null;

  /** Lazy-initialize the QA pipeline */
  private async getPipeline(): Promise<any | null> {
    if (this.pipeline) return this.pipeline;
    if (this.loadFailed) return null;
    if (this.loading) {
      while (this.loading) await new Promise((r) => setTimeout(r, 150));
      return this.pipeline;
    }

    this.loading = true;
    try {
      // Dynamic ESM import — works from CJS NestJS because Node.js supports it
      const { pipeline, env } = await (Function(
        'return import("@xenova/transformers")',
      )() as Promise<any>);

      // Cache models in app data dir to avoid re-downloading
      env.cacheDir = "./.model-cache";

      this.logger.log(
        "Loading QA model... (first run may take a few minutes to download)",
      );

      const loadErrors: string[] = [];
      for (const modelId of this.modelCandidates) {
        try {
          this.logger.log(`Trying QA model: ${modelId}`);
          this.pipeline = await pipeline("question-answering", modelId);
          this.logger.log(`QA pipeline ready (${modelId}).`);
          break;
        } catch (modelErr) {
          const modelDetails =
            modelErr instanceof Error
              ? (modelErr.stack ?? modelErr.message)
              : String(modelErr);
          loadErrors.push(`${modelId}: ${modelDetails}`);
          this.logger.warn(`Failed loading ${modelId}: ${modelDetails}`);
        }
      }

      if (!this.pipeline) {
        throw new Error(loadErrors.join("\n\n"));
      }

      this.loadError = null;
    } catch (err) {
      this.loadFailed = true;
      const details =
        err instanceof Error ? (err.stack ?? err.message) : String(err);
      const message =
        details.includes("Unauthorized access to file") &&
        details.includes("huggingface.co")
          ? "Failed to load QA model: Hugging Face returned 401 Unauthorized while downloading model files. TABLE_EXTRACT needs access to a public model repository (or a pre-populated local cache)."
          : "Failed to load QA model. TABLE_EXTRACT is unavailable.";
      this.loadError = message;
      this.logger.error(message, details);
    } finally {
      this.loading = false;
    }

    return this.pipeline;
  }

  /**
   * Extract a single field from document text using the QA model.
   */
  async extractField(
    question: string,
    context: string,
  ): Promise<ExtractionResult> {
    const qa = await this.getPipeline();
    if (!qa) {
      throw new Error(this.loadError ?? "TABLE_EXTRACT model is unavailable.");
    }

    try {
      const safeQuestion =
        typeof question === "string" ? question : String(question ?? "");
      const safeContext =
        typeof context === "string" ? context : String(context ?? "");
      const result = await qa(safeQuestion, safeContext);
      return {
        answer: (result.answer ?? "").trim(),
        score: result.score ?? 0,
      };
    } catch (err) {
      this.logger.warn(
        `Field extraction failed for question "${question}": ${err}`,
      );
      return { answer: "", score: 0 };
    }
  }

  /**
   * Extract all session columns from document OCR text.
   * Returns a map of column.key → { answer, score }.
   */
  async extractFields(
    columns: SessionColumn[],
    ocrText: string,
  ): Promise<Record<string, ExtractionResult>> {
    const results: Record<string, ExtractionResult> = {};

    // Run extractions sequentially (QA model can be memory-heavy; parallel risks OOM)
    for (const col of columns) {
      results[col.key] = await this.extractField(col.question, ocrText);
      this.logger.debug(
        `  ${col.label}: "${results[col.key].answer}" (score: ${results[col.key].score.toFixed(3)})`,
      );
    }

    return results;
  }

  /** Returns true if the model has been loaded successfully */
  isReady(): boolean {
    return this.pipeline !== null;
  }

  getLoadError(): string | null {
    return this.loadError;
  }
}
