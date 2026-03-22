"""
pdf_docling.py  —  Docling PDF sidecar for OltekOCR Desktop
=============================================================
Accepts a PDF path via --input and writes a JSON result to stdout
that the NestJS OCR service reads.

Usage:
    python pdf_docling.py --input /path/to/document.pdf [--chunk-size 25]

Strategy: chunked conversion
  pdfium accumulates memory as it processes pages. Beyond ~30 pages in a
  single pass it triggers std::bad_alloc. To process every page we:
    1. Convert page_range=(1,N) for each chunk of CHUNK_SIZE pages.
    2. Create a fresh DocumentConverter per chunk so pdfium is re-initialised
       and its memory is freed between chunks.
    3. Force a GC collect between chunks for good measure.
    4. Stop when a Docling chunk returns fewer items than a minimum threshold
       (indicating we have gone past the end of the document).
    5. Merge all chunk results into one output payload.

Output JSON schema matches OcrResult:
{
  "fullText":        string,
  "markdown":        string,
  "textBlocks":      [{text, confidence, blockType, bbox, page}],
  "tables":          [{tableId, rows, cols, cells, caption, bbox}],
  "avgConfidence":   number,
  "processingTime":  number,   // seconds
  "pageCount":       number,
  "warnings":        [string]
}
"""

import argparse
import gc
import json
import sys
import time
import uuid
from pathlib import Path


def log(msg: str) -> None:
    sys.stderr.buffer.write((f"[progress] {msg}\n").encode("utf-8", errors="replace"))
    sys.stderr.buffer.flush()


def get_page_count(pdf_path: Path) -> int:
    """Try several pure-Python libraries to get the page count."""
    # pypdf (pure Python, no native deps)
    try:
        from pypdf import PdfReader
        return len(PdfReader(str(pdf_path)).pages)
    except Exception:
        pass
    # pdfplumber
    try:
        import pdfplumber
        with pdfplumber.open(str(pdf_path)) as pdf:
            return len(pdf.pages)
    except Exception:
        pass
    # PyMuPDF
    try:
        import fitz
        with fitz.open(str(pdf_path)) as doc:
            return len(doc)
    except Exception:
        pass
    return 0


def _make_pipeline_opts(mode: str):
    """Build PdfPipelineOptions, returning None if unavailable."""
    try:
        from docling.datamodel.pipeline_options import PdfPipelineOptions
        opts = PdfPipelineOptions()
        opts.images_scale = 1.0
        for attr in [
            "do_table_structure",
            "do_cell_matching",
            "do_formula_enrichment",
            "do_code_enrichment",
            "do_picture_classification",
            "do_picture_description",
        ]:
            if hasattr(opts, attr):
                setattr(opts, attr, False)
        if hasattr(opts, "do_ocr"):
            opts.do_ocr = mode == "ocr"
        return opts
    except Exception:
        return None


def _make_converter(mode: str):
    """Create a fresh DocumentConverter with slimmed-down pipeline options."""
    from docling.document_converter import DocumentConverter
    from docling.datamodel.base_models import InputFormat
    from docling.document_converter import PdfFormatOption

    pipeline_opts = _make_pipeline_opts(mode)
    if pipeline_opts is not None:
        return DocumentConverter(
            format_options={
                InputFormat.PDF: PdfFormatOption(pipeline_options=pipeline_opts),
            }
        )
    return DocumentConverter()


def _extract_blocks(doc) -> tuple[list[dict], list[str]]:
    """Extract text blocks from a Docling document, skip table items."""
    blocks: list[dict] = []
    text_parts: list[str] = []
    for item in doc.iterate_items():
        if isinstance(item, tuple):
            item = item[0]
        item_type = type(item).__name__.lower()
        if "table" in item_type:
            continue
        if "heading" in item_type or "title" in item_type:
            block_type = "heading"
        elif "list" in item_type:
            block_type = "list"
        elif "header" in item_type:
            block_type = "header"
        elif "footer" in item_type:
            block_type = "footer"
        else:
            block_type = "paragraph"

        text = ""
        if hasattr(item, "text"):
            text = str(item.text).strip()
        elif hasattr(item, "export_to_text"):
            text = str(item.export_to_text()).strip()
        if not text:
            continue

        page, bbox = 1, [0, 0, 0, 0]
        if hasattr(item, "prov") and item.prov:
            prov = item.prov[0] if isinstance(item.prov, list) else item.prov
            if hasattr(prov, "page_no"):
                page = int(prov.page_no)
            if hasattr(prov, "bbox"):
                b = prov.bbox
                if hasattr(b, "l"):
                    bbox = [int(b.l), int(b.t), int(b.r), int(b.b)]
                elif isinstance(b, (list, tuple)) and len(b) >= 4:
                    bbox = [int(b[0]), int(b[1]), int(b[2]), int(b[3])]

        blocks.append({
            "text": text,
            "confidence": 100.0,
            "blockType": block_type,
            "bbox": bbox,
            "page": page,
        })
        text_parts.append(text)
    return blocks, text_parts


def _extract_tables(doc) -> tuple[list[dict], list[str]]:
    """Extract tables from a Docling document."""
    tables: list[dict] = []
    text_parts: list[str] = []
    for item in doc.iterate_items():
        if isinstance(item, tuple):
            item = item[0]
        if "table" not in type(item).__name__.lower():
            continue

        cells: list[dict] = []
        n_rows, n_cols = 0, 0
        if hasattr(item, "data") and item.data is not None:
            grid = getattr(item.data, "grid", None)
            if grid:
                n_rows = len(grid)
                for r_idx, row in enumerate(grid):
                    n_cols = max(n_cols, len(row))
                    for c_idx, cell in enumerate(row):
                        cell_text = ""
                        if hasattr(cell, "text"):
                            cell_text = str(cell.text).strip()
                        elif hasattr(cell, "value"):
                            cell_text = str(cell.value).strip()
                        cells.append({
                            "row": r_idx, "col": c_idx, "text": cell_text,
                            "confidence": 100.0,
                            "rowSpan": getattr(cell, "row_span", 1) or 1,
                            "colSpan": getattr(cell, "col_span", 1) or 1,
                        })
            else:
                for tc in getattr(item.data, "table_cells", []):
                    r, c = getattr(tc, "row", 0), getattr(tc, "col", 0)
                    n_rows = max(n_rows, r + 1)
                    n_cols = max(n_cols, c + 1)
                    cells.append({
                        "row": r, "col": c,
                        "text": str(getattr(tc, "text", "") or "").strip(),
                        "confidence": 100.0,
                        "rowSpan": getattr(tc, "row_span", 1) or 1,
                        "colSpan": getattr(tc, "col_span", 1) or 1,
                    })

        table_text = ""
        if hasattr(item, "export_to_text"):
            table_text = str(item.export_to_text()).strip()
        elif hasattr(item, "text"):
            table_text = str(item.text).strip()
        if table_text:
            text_parts.append(table_text)

        page, bbox = 1, [0, 0, 0, 0]
        if hasattr(item, "prov") and item.prov:
            prov = item.prov[0] if isinstance(item.prov, list) else item.prov
            if hasattr(prov, "page_no"):
                page = int(prov.page_no)
            if hasattr(prov, "bbox"):
                b = prov.bbox
                if hasattr(b, "l"):
                    bbox = [int(b.l), int(b.t), int(b.r), int(b.b)]
                elif isinstance(b, (list, tuple)) and len(b) >= 4:
                    bbox = [int(b[0]), int(b[1]), int(b[2]), int(b[3])]

        tables.append({
            "tableId": str(uuid.uuid4())[:8],
            "rows": n_rows, "cols": n_cols, "cells": cells,
            "caption": "", "bbox": bbox, "page": page,
        })
    return tables, text_parts


def run(pdf_path: str, chunk_size: int = 25, mode: str = "auto") -> dict:
    warnings: list[str] = []
    t0 = time.perf_counter()

    path = Path(pdf_path)
    if not path.exists():
        return {"error": f"File not found: {pdf_path}"}
    if path.suffix.lower() != ".pdf":
        return {"error": f"Expected a PDF file, got: {path.suffix}"}

    try:
        from docling.document_converter import DocumentConverter  # noqa: F401
    except ImportError as exc:
        return {"error": f"docling is not installed: {exc}"}

    # Try to get total page count for friendlier progress messages.
    total_pages = get_page_count(path)
    if total_pages > 0:
        log(f"PDF has {total_pages} pages (chunk size: {chunk_size})")
    else:
        log(f"Page count unavailable; using chunk size {chunk_size} — will stop when document is exhausted")

    log(f"Docling mode: {mode}")

    # ── Chunked conversion ───────────────────────────────────
    # Each chunk uses a fresh converter so pdfium memory is freed between them.
    all_blocks: list[dict] = []
    all_text_parts: list[str] = []
    all_tables: list[dict] = []
    all_markdowns: list[str] = []
    chunk_num = 0
    page_start = 1
    # Hard cap to prevent infinite loops on edge cases
    MAX_PAGES = max(total_pages + chunk_size, 500) if total_pages > 0 else 500

    while page_start <= MAX_PAGES:
        page_end = page_start + chunk_size - 1
        chunk_num += 1
        log(f"Chunk {chunk_num}: pages {page_start}–{page_end}" +
            (f" / {total_pages}" if total_pages > 0 else ""))

        try:
            converter = _make_converter(mode)
            result = converter.convert(
                str(path),
                page_range=(page_start, page_end),
                raises_on_error=False,
            )
            doc = result.document
        except Exception as exc:
            warnings.append(f"Chunk {chunk_num} (pages {page_start}–{page_end}) failed: {exc}")
            log(f"Chunk {chunk_num} error: {exc}")
            # Release memory and move on to next chunk
            del converter
            gc.collect()
            page_start += chunk_size
            continue

        if doc is None:
            log(f"Chunk {chunk_num} returned no document — assuming end of PDF")
            del converter
            gc.collect()
            break

        try:
            chunk_blocks, chunk_text = _extract_blocks(doc)
            chunk_tables, chunk_table_text = _extract_tables(doc)
            chunk_md = ""
            try:
                chunk_md = doc.export_to_markdown()
            except Exception:
                chunk_md = "\n\n".join(chunk_text + chunk_table_text)

            all_blocks.extend(chunk_blocks)
            all_text_parts.extend(chunk_text)
            all_tables.extend(chunk_tables)
            all_text_parts.extend(chunk_table_text)
            if chunk_md:
                all_markdowns.append(chunk_md)

            log(f"Chunk {chunk_num} done: {len(chunk_blocks)} blocks, {len(chunk_tables)} tables")
        except Exception as exc:
            warnings.append(f"Chunk {chunk_num} extraction error: {exc}")
            log(f"Chunk {chunk_num} extraction error: {exc}")

        # Release pdfium memory before next chunk
        del doc, result, converter
        gc.collect()

        # Stop conditions:
        # 1. We know total pages and have covered them all
        if total_pages > 0 and page_end >= total_pages:
            log("All pages covered")
            break
        # 2. Last chunk returned nothing — we've gone past the end
        if total_pages == 0 and len(chunk_blocks) == 0 and len(chunk_tables) == 0:
            log("Empty chunk — assuming end of PDF")
            break

        page_start += chunk_size

    if not all_blocks and not all_tables:
        return {"error": "Docling conversion produced no content from any chunk."}

    page_count = max((b["page"] for b in all_blocks), default=1)
    processing_time = round(time.perf_counter() - t0, 3)
    full_text = "\n".join(all_text_parts)
    markdown = "\n\n---\n\n".join(all_markdowns) if all_markdowns else full_text

    log(f"Done in {processing_time}s — {len(all_blocks)} blocks, {len(all_tables)} tables, {page_count} pages")

    return {
        "fullText": full_text,
        "markdown": markdown,
        "textBlocks": all_blocks,
        "tables": all_tables,
        "avgConfidence": 100.0,
        "processingTime": processing_time,
        "pageCount": page_count,
        "warnings": warnings,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Docling PDF sidecar")
    parser.add_argument("--input", required=True, help="Path to PDF file")
    parser.add_argument(
        "--chunk-size",
        type=int,
        default=25,
        help="Pages per conversion chunk (default 25)",
    )
    parser.add_argument(
        "--mode",
        choices=["auto", "text", "ocr"],
        default="auto",
        help="Docling mode: text disables OCR, ocr enables OCR",
    )
    args = parser.parse_args()

    result = run(args.input, chunk_size=args.chunk_size, mode=args.mode)
    # Write as UTF-8 bytes to avoid cp1252 failures on Windows when the PDF
    # contains characters outside the Windows-1252 code page (e.g. ※ U+203B).
    sys.stdout.buffer.write(json.dumps(result, ensure_ascii=False).encode("utf-8"))
    sys.stdout.buffer.flush()

    if "error" in result:
        sys.exit(1)


if __name__ == "__main__":
    main()
