import { Injectable, Logger } from "@nestjs/common";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { getDataPath } from "../../data-dirs";
import type { AppSettings } from "@shared/types";

const SETTINGS_FILE = () => getDataPath("settings.json");

const DEFAULT_SETTINGS: AppSettings = {
  app: {
    name: "OltekOCR",
    version: "1.0.0",
    theme: "dark",
  },
  scanner: {
    mode: "folder",
    dpi: 300,
    colorMode: "grayscale",
    autoCrop: true,
    watchFolder: "./data/scans/incoming",
    supportedFormats: [
      ".jpg",
      ".jpeg",
      ".png",
      ".tiff",
      ".tif",
      ".bmp",
      ".pdf",
    ],
  },
  ocr: {
    language: "en",
    engine: "rapidocr",
    pdfModel: "pdfplumber",
    confidenceThreshold: 85,
    extractTables: true,
    timeout: 120,
    autoEnhance: true,
    autoDeskew: true,
    minDpi: 150,
    blurThreshold: 100,
    pythonPath: "python",
  },
  storage: {
    databasePath: "./data/oltekocr.db",
    scansFolder: "./data/scans",
    exportsFolder: "./data/exports",
    maxStorageGb: 50,
  },
  export: {
    defaultFormat: "excel",
    includeImages: false,
    dateFormat: "yyyy-MM-dd",
  },
  llm: {
    provider: "groq",
    defaultModel: "qwen2.5:1.5b",
    temperature: 0.2,
  },
};

@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);
  private settings: AppSettings;

  constructor() {
    this.settings = this.loadFromDisk();
  }

  getAll(): AppSettings {
    return { ...this.settings };
  }

  getDefaults(): AppSettings {
    return { ...DEFAULT_SETTINGS };
  }

  update(partial: Partial<AppSettings>): AppSettings {
    this.settings = this.deepMerge(this.settings, partial);
    this.saveToDisk();
    this.logger.log("Settings updated");
    return { ...this.settings };
  }

  private loadFromDisk(): AppSettings {
    const path = SETTINGS_FILE();
    if (!existsSync(path)) {
      this.settings = { ...DEFAULT_SETTINGS };
      this.saveToDisk();
      return { ...DEFAULT_SETTINGS };
    }
    try {
      const raw = readFileSync(path, "utf-8");
      return this.deepMerge(DEFAULT_SETTINGS, JSON.parse(raw));
    } catch (err) {
      this.logger.warn("Failed to load settings, using defaults", err);
      return { ...DEFAULT_SETTINGS };
    }
  }

  private saveToDisk(): void {
    try {
      writeFileSync(
        SETTINGS_FILE(),
        JSON.stringify(this.settings, null, 2),
        "utf-8",
      );
    } catch (err) {
      this.logger.error("Failed to save settings", err);
    }
  }

  private deepMerge(target: any, source: any): any {
    const result = { ...target };
    for (const key of Object.keys(source)) {
      if (
        source[key] &&
        typeof source[key] === "object" &&
        !Array.isArray(source[key]) &&
        target[key] &&
        typeof target[key] === "object"
      ) {
        result[key] = this.deepMerge(target[key], source[key]);
      } else {
        result[key] = source[key];
      }
    }
    return result;
  }
}
