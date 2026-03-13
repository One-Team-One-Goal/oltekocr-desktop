/**
 * compact-json.ts — Reduce full Docling/OCR JSON to a token-efficient form
 * =========================================================================
 * The full OcrResult stored in the DB includes bboxes, per-block metadata,
 * and verbose table cell objects.  Before feeding text to an LLM we strip
 * everything the model doesn't need so a 94-page logistics PDF drops from
 * ~180k tokens (raw JSON) to ~60-70k.
 *
 * Usage:
 *   import { compactOcrForLlm } from "./compact-json";
 *   const compactText = compactOcrForLlm(ocrResult);
 */

import type { OcrResult, TextBlock, ExtractedTable } from "@shared/types";

export interface CompactBlock {
  text: string;
  type: string; // paragraph | heading | list | table
  page: number;
}

export interface CompactTable {
  caption: string;
  headers: string[];
  rows: string[][];
}

export interface CompactOcrJson {
  pageCount: number;
  blocks: CompactBlock[];
  tables: CompactTable[];
}

/**
 * Merge consecutive text blocks on the same page with the same type
 * into a single block to reduce repetition.
 */
function mergeConsecutiveBlocks(blocks: TextBlock[]): CompactBlock[] {
  const merged: CompactBlock[] = [];

  for (const block of blocks) {
    const text = block.text.trim();
    if (!text) continue;

    const last = merged[merged.length - 1];
    if (
      last &&
      last.page === block.page &&
      last.type === block.blockType &&
      block.blockType === "paragraph"
    ) {
      // Merge into previous block
      last.text += " " + text;
    } else {
      merged.push({
        text,
        type: block.blockType,
        page: block.page,
      });
    }
  }
  return merged;
}

/**
 * Convert an ExtractedTable into a compact header+rows form.
 * Strips bboxes, confidence, spans — just the text content.
 */
function compactTable(table: ExtractedTable): CompactTable | null {
  if (!table.cells || table.cells.length === 0) return null;

  // Build a 2D grid
  const grid: string[][] = Array.from({ length: table.rows }, () =>
    Array.from({ length: table.cols }, () => ""),
  );

  for (const cell of table.cells) {
    if (cell.row < table.rows && cell.col < table.cols) {
      grid[cell.row][cell.col] = cell.text.trim();
    }
  }

  // First row as headers, rest as data rows
  const headers = grid[0] ?? [];
  const rows = grid.slice(1).filter((row) => row.some((c) => c !== ""));

  if (headers.length === 0 && rows.length === 0) return null;

  return {
    caption: table.caption || "",
    headers,
    rows,
  };
}

/**
 * Transform a full OcrResult into a compact JSON structure for LLM consumption.
 * Strips: bboxes, confidence scores, rowSpan/colSpan, empty blocks.
 * Merges: consecutive same-type paragraphs on the same page.
 */
export function compactOcrJson(result: OcrResult): CompactOcrJson {
  const blocks = mergeConsecutiveBlocks(result.textBlocks);
  const tables = result.tables
    .map(compactTable)
    .filter((t): t is CompactTable => t !== null);

  return {
    pageCount: result.pageCount,
    blocks,
    tables,
  };
}

/**
 * Produce a single string suitable for LLM context from an OcrResult.
 * Returns compact JSON (not pretty-printed) for minimal token usage.
 */
export function compactOcrForLlm(result: OcrResult): string {
  const compact = compactOcrJson(result);
  return JSON.stringify(compact);
}
