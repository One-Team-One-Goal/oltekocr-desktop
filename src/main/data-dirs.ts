import { existsSync, mkdirSync } from "fs";
import { join } from "path";

/**
 * Ensure all required data directories exist.
 * These are relative to the working directory (project root).
 */
export function ensureDataDirs(): void {
  const dirs = [
    join(process.cwd(), "data"),
    join(process.cwd(), "data", "scans"),
    join(process.cwd(), "data", "scans", "thumbnails"),
    join(process.cwd(), "data", "exports"),
    join(process.cwd(), "data", "scans", "incoming"),
  ];

  for (const dir of dirs) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }
}

export function getDataPath(...segments: string[]): string {
  return join(process.cwd(), "data", ...segments);
}
