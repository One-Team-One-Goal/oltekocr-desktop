"""
pdf_extract.py  —  Unified document extraction sidecar for OltekOCR Desktop
==============================================================================
Dispatches to the correct extraction library based on --model.

Usage:
    python pdf_extract.py --input /path/to/document.pdf --model docling [--chunk-size 25] [--mode text]
    python pdf_extract.py --input /path/to/document.pdf --model pdfplumber
    python pdf_extract.py --input /path/to/document.pdf --model pymupdf
    python pdf_extract.py --input /path/to/document.pdf --model unstructured

Output JSON matches OcrResult (same as pdf_docling.py).
"""

import argparse
import json
import os
import sys
import time
import uuid
from pathlib import Path


def log(msg: str) -> None:
    sys.stderr.buffer.write((f"[progress] {msg}\n").encode("utf-8", errors="replace"))
    sys.stderr.buffer.flush()


# ── Markdown helpers ─────────────────────────────────────────────────────────

def _render_table_as_markdown(table: dict) -> str:
    """Convert a table dict to a markdown table string."""
    rows = table.get("rows", 0)
    cols = table.get("cols", 0)
    cells = table.get("cells", [])
    if not rows or not cols or not cells:
        return ""
    grid: list[list[str]] = [[""] * cols for _ in range(rows)]
    for cell in cells:
        r, c = cell.get("row", 0), cell.get("col", 0)
        if r < rows and c < cols:
            grid[r][c] = str(cell.get("text", "")).replace("|", "\\|").replace("\n", " ")
    lines: list[str] = []
    for i, row in enumerate(grid):
        lines.append("| " + " | ".join(row) + " |")
        if i == 0:
            lines.append("|" + "|".join(" --- " for _ in row) + "|")
    return "\n".join(lines)


def build_markdown(blocks: list, tables: list) -> str:
    """Build formatted markdown from text blocks and tables."""
    parts: list[str] = []
    for block in blocks:
        text = block.get("text", "").strip()
        if not text:
            continue
        if block.get("blockType") == "heading":
            parts.append(f"## {text}")
        else:
            parts.append(text)
    for table in tables:
        md = _render_table_as_markdown(table)
        if md:
            parts.append(md)
    return "\n\n".join(parts)


# ── pdfplumber extraction ────────────────────────────────────────────────────

def extract_pdfplumber(pdf_path: str) -> dict:
    t0 = time.perf_counter()
    warnings: list[str] = []
    log("Using pdfplumber extractor")

    try:
        import pdfplumber
    except ImportError as exc:
        return {"error": f"pdfplumber is not installed: {exc}"}

    path = Path(pdf_path)
    if not path.exists():
        return {"error": f"File not found: {pdf_path}"}

    all_blocks: list[dict] = []
    all_tables: list[dict] = []
    text_parts: list[str] = []
    page_count = 0

    try:
        with pdfplumber.open(str(path)) as pdf:
            page_count = len(pdf.pages)
            log(f"PDF has {page_count} pages")

            for i, page in enumerate(pdf.pages):
                page_num = i + 1
                if page_num % 10 == 1:
                    log(f"Processing page {page_num} / {page_count}")

                # Extract text
                page_text = page.extract_text() or ""
                if page_text.strip():
                    for para in page_text.split("\n\n"):
                        para = para.strip()
                        if not para:
                            continue
                        all_blocks.append({
                            "text": para,
                            "blockType": "paragraph",
                            "page": page_num,
                        })
                        text_parts.append(para)

                # Extract tables
                try:
                    tables = page.extract_tables() or []
                    for tbl in tables:
                        if not tbl:
                            continue
                        rows = len(tbl)
                        cols = max((len(r) for r in tbl), default=0)
                        cells: list[dict] = []
                        table_texts: list[str] = []
                        for r_idx, row in enumerate(tbl):
                            for c_idx, cell in enumerate(row or []):
                                cell_text = str(cell).strip() if cell else ""
                                cells.append({
                                    "row": r_idx,
                                    "col": c_idx,
                                    "text": cell_text,
                                })
                                if cell_text:
                                    table_texts.append(cell_text)
                        all_tables.append({
                            "tableId": str(uuid.uuid4())[:8],
                            "rows": rows,
                            "cols": cols,
                            "cells": cells,
                        })
                        if table_texts:
                            text_parts.append(" | ".join(table_texts))
                except Exception as exc:
                    warnings.append(f"Table extraction failed on page {page_num}: {exc}")

    except Exception as exc:
        return {"error": f"pdfplumber extraction failed: {exc}"}

    if not all_blocks and not all_tables:
        return {"error": "pdfplumber produced no content."}

    processing_time = round(time.perf_counter() - t0, 3)
    full_text = "\n".join(text_parts)
    log(f"Done in {processing_time}s — {len(all_blocks)} blocks, {len(all_tables)} tables, {page_count} pages")

    return {
        "fullText": full_text,
        "markdown": build_markdown(all_blocks, all_tables),
        "textBlocks": all_blocks,
        "tables": all_tables,
        "avgConfidence": 95.0,
        "processingTime": processing_time,
        "pageCount": page_count,
        "warnings": warnings,
    }


# ── PyMuPDF (fitz) extraction ────────────────────────────────────────────────

def extract_pymupdf(pdf_path: str) -> dict:
    t0 = time.perf_counter()
    warnings: list[str] = []
    log("Using PyMuPDF (fitz) extractor")

    try:
        import fitz  # pymupdf
    except ImportError as exc:
        return {"error": f"PyMuPDF is not installed: {exc}"}

    path = Path(pdf_path)
    if not path.exists():
        return {"error": f"File not found: {pdf_path}"}

    all_blocks: list[dict] = []
    text_parts: list[str] = []
    all_tables: list[dict] = []
    page_count = 0

    # libmupdf (the C library inside PyMuPDF) writes diagnostic messages
    # directly to file-descriptor 1 (stdout), bypassing Python's buffers.
    # Redirect fd 1 → fd 2 (stderr) for the duration of all fitz operations
    # so those messages never corrupt the JSON we write at the end.
    _saved_fd = os.dup(1)
    os.dup2(2, 1)  # stdout → stderr
    try:
        try:
            doc = fitz.open(str(path))
            page_count = len(doc)
            log(f"PDF has {page_count} pages")

            for i, page in enumerate(doc):
                page_num = i + 1
                if page_num % 10 == 1:
                    log(f"Processing page {page_num} / {page_count}")

                # dict extraction gives structured blocks
                page_dict = page.get_text("dict")
                for block in page_dict.get("blocks", []):
                    if block.get("type") != 0:  # 0 = text block
                        continue
                    block_text_parts: list[str] = []
                    for line in block.get("lines", []):
                        for span in line.get("spans", []):
                            t = span.get("text", "").strip()
                            if t:
                                block_text_parts.append(t)
                    text = " ".join(block_text_parts).strip()
                    if not text:
                        continue

                    bbox_raw = block.get("bbox", [0, 0, 0, 0])
                    all_blocks.append({
                        "text": text,
                        "blockType": "paragraph",
                        "page": page_num,
                    })
                    text_parts.append(text)

                # PyMuPDF 1.23+ has find_tables()
                if hasattr(page, "find_tables"):
                    try:
                        tab_finder = page.find_tables()
                        for tbl in tab_finder.tables:
                            data = tbl.extract()
                            if not data:
                                continue
                            rows = len(data)
                            cols = max((len(r) for r in data), default=0)
                            cells: list[dict] = []
                            table_texts: list[str] = []
                            for r_idx, row in enumerate(data):
                                for c_idx, cell in enumerate(row):
                                    cell_text = str(cell).strip() if cell else ""
                                    cells.append({
                                        "row": r_idx,
                                        "col": c_idx,
                                        "text": cell_text,
                                    })
                                    if cell_text:
                                        table_texts.append(cell_text)
                            all_tables.append({
                                "tableId": str(uuid.uuid4())[:8],
                                "rows": rows,
                                "cols": cols,
                                "cells": cells,
                            })
                            if table_texts:
                                text_parts.append(" | ".join(table_texts))
                    except Exception as exc:
                        warnings.append(f"Table extraction failed on page {page_num}: {exc}")

            doc.close()
        except Exception as exc:
            return {"error": f"PyMuPDF extraction failed: {exc}"}
    finally:
        # Always restore stdout fd before we return or write JSON
        sys.stdout.flush()
        os.dup2(_saved_fd, 1)
        os.close(_saved_fd)

    if not all_blocks and not all_tables:
        return {"error": "PyMuPDF produced no content."}

    processing_time = round(time.perf_counter() - t0, 3)
    full_text = "\n".join(text_parts)
    log(f"Done in {processing_time}s — {len(all_blocks)} blocks, {len(all_tables)} tables, {page_count} pages")

    return {
        "fullText": full_text,
        "markdown": build_markdown(all_blocks, all_tables),
        "textBlocks": all_blocks,
        "tables": all_tables,
        "avgConfidence": 95.0,
        "processingTime": processing_time,
        "pageCount": page_count,
        "warnings": warnings,
    }


# ── Unstructured.io extraction ───────────────────────────────────────────────

def extract_unstructured(pdf_path: str) -> dict:
    import threading
    t0 = time.perf_counter()
    warnings: list[str] = []
    log("Using Unstructured.io extractor")

    # Start heartbeat immediately so NestJS receives activity even if
    # importing unstructured itself is slow on first run.
    _stop_heartbeat = threading.Event()

    def _heartbeat():
        while not _stop_heartbeat.wait(15):
            elapsed = round(time.perf_counter() - t0, 1)
            log(f"Still processing... ({elapsed}s elapsed)")

    _hb_thread = threading.Thread(target=_heartbeat, daemon=True)
    _hb_thread.start()

    try:
        log("Importing Unstructured modules...")
        from unstructured.partition.auto import partition
    except ImportError as exc:
        _stop_heartbeat.set()
        return {"error": f"unstructured is not installed: {exc}"}

    path = Path(pdf_path)
    if not path.exists():
        return {"error": f"File not found: {pdf_path}"}

    all_blocks: list[dict] = []
    all_tables: list[dict] = []
    text_parts: list[str] = []

    try:
        # strategy="hi_res" would use detectron2/YOLO and requires a network
        # download on first use — that download hangs silently and triggers
        # the 60s idle watchdog.  Use "fast" by default; callers that truly
        # need layout-aware extraction should use docling instead.
        log("Running Unstructured partition (strategy=fast, no model download)...")
        elements = partition(filename=str(path), strategy="fast")

        page_numbers: set[int] = set()
        for elem in elements:
            elem_type = type(elem).__name__
            text = str(elem).strip()
            if not text:
                continue

            # Determine page number from metadata
            page = 1
            if hasattr(elem, "metadata"):
                meta = elem.metadata
                if hasattr(meta, "page_number") and meta.page_number:
                    page = int(meta.page_number)
            page_numbers.add(page)

            # Determine block type
            if "Table" in elem_type:
                # Unstructured tables come as HTML or text. Extract as a single-cell table.
                html = ""
                if hasattr(elem, "metadata") and hasattr(elem.metadata, "text_as_html"):
                    html = elem.metadata.text_as_html or ""

                cells: list[dict] = []
                n_rows, n_cols = 1, 1
                if html:
                    n_rows, n_cols, cells = _parse_html_table(html)
                else:
                    cells = [{"row": 0, "col": 0, "text": text}]

                all_tables.append({
                    "tableId": str(uuid.uuid4())[:8],
                    "rows": n_rows,
                    "cols": n_cols,
                    "cells": cells,
                })
                text_parts.append(text)
            else:
                if "Title" in elem_type or "Header" in elem_type:
                    block_type = "heading"
                elif "List" in elem_type:
                    block_type = "list"
                elif "Footer" in elem_type:
                    block_type = "footer"
                else:
                    block_type = "paragraph"

                all_blocks.append({
                    "text": text,
                    "blockType": block_type,
                    "page": page,
                })
                text_parts.append(text)

        page_count = max(page_numbers) if page_numbers else 0

    except Exception as exc:
        return {"error": f"Unstructured extraction failed: {exc}"}
    finally:
        _stop_heartbeat.set()

    if not all_blocks and not all_tables:
        return {"error": "Unstructured produced no content. Try strategy hi_res or switch to pdfplumber/pymupdf."}

    processing_time = round(time.perf_counter() - t0, 3)
    full_text = "\n".join(text_parts)
    log(f"Done in {processing_time}s — {len(all_blocks)} blocks, {len(all_tables)} tables, {page_count} pages")

    return {
        "fullText": full_text,
        "markdown": build_markdown(all_blocks, all_tables),
        "textBlocks": all_blocks,
        "tables": all_tables,
        "avgConfidence": 90.0,
        "processingTime": processing_time,
        "pageCount": page_count,
        "warnings": warnings,
    }


def _parse_html_table(html: str) -> tuple[int, int, list[dict]]:
    """Parse a simple HTML table into (rows, cols, cells) list."""
    try:
        from html.parser import HTMLParser

        class TableParser(HTMLParser):
            def __init__(self):
                super().__init__()
                self.rows: list[list[str]] = []
                self.current_row: list[str] = []
                self.current_cell: list[str] = []
                self.in_cell = False

            def handle_starttag(self, tag, attrs):
                if tag in ("td", "th"):
                    self.in_cell = True
                    self.current_cell = []
                elif tag == "tr":
                    self.current_row = []

            def handle_endtag(self, tag):
                if tag in ("td", "th"):
                    self.in_cell = False
                    self.current_row.append("".join(self.current_cell).strip())
                elif tag == "tr":
                    self.rows.append(self.current_row)

            def handle_data(self, data):
                if self.in_cell:
                    self.current_cell.append(data)

        parser = TableParser()
        parser.feed(html)

        n_rows = len(parser.rows)
        n_cols = max((len(r) for r in parser.rows), default=0)
        cells: list[dict] = []
        for r_idx, row in enumerate(parser.rows):
            for c_idx, cell_text in enumerate(row):
                cells.append({
                    "row": r_idx,
                    "col": c_idx,
                    "text": cell_text,
                })
        return n_rows, n_cols, cells
    except Exception:
        return 1, 1, [{"row": 0, "col": 0, "text": html}]


# ── Docling (delegates to pdf_docling.py logic) ──────────────────────────────

def extract_docling(pdf_path: str, chunk_size: int = 25, mode: str = "text") -> dict:
    """Import and run the existing Docling chunked extractor."""
    import importlib.util, os
    script_dir = os.path.dirname(os.path.abspath(__file__))
    spec = importlib.util.spec_from_file_location("pdf_docling", os.path.join(script_dir, "pdf_docling.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.run(pdf_path, chunk_size=chunk_size, mode=mode)


# ── Marker extraction ───────────────────────────────────────────────────────

def extract_marker(pdf_path: str) -> dict:
    import threading
    t0 = time.perf_counter()
    warnings: list[str] = []
    log("Using Marker extractor")

    try:
        from marker.converters.pdf import PdfConverter
        from marker.models import create_model_dict
        from marker.output import text_from_rendered
        from marker.config.parser import ConfigParser
    except ImportError as exc:
        return {"error": f"marker-pdf is not installed: {exc}. Install with: pip install marker-pdf"}

    path = Path(pdf_path)
    if not path.exists():
        return {"error": f"File not found: {pdf_path}"}

    _stop_heartbeat = threading.Event()
    def _heartbeat():
        while not _stop_heartbeat.wait(15):
            elapsed = round(time.perf_counter() - t0, 1)
            log(f"Still processing... ({elapsed}s elapsed)")
    _hb_thread = threading.Thread(target=_heartbeat, daemon=True)
    _hb_thread.start()

    try:
        log("Loading Marker models (first run may take a while)...")
        config_parser = ConfigParser({})
        converter = PdfConverter(
            config=config_parser.generate_config_dict(),
            artifact_dict=create_model_dict(),
        )
        log("Running Marker conversion...")
        rendered = converter(str(path))
        markdown, _, out_meta = text_from_rendered(rendered)
        log("Marker conversion complete")
    except Exception as exc:
        return {"error": f"Marker extraction failed: {exc}"}
    finally:
        _stop_heartbeat.set()

    if not markdown or not markdown.strip():
        return {"error": "Marker produced no content."}

    # Convert markdown text into text blocks (one per paragraph)
    all_blocks: list[dict] = []
    text_parts: list[str] = []
    for para in markdown.split("\n\n"):
        para = para.strip()
        if not para:
            continue
        all_blocks.append({
            "text": para,
            "blockType": "heading" if para.startswith("#") else "paragraph",
            "page": 1,
        })
        text_parts.append(para)

    page_count = out_meta.get("page_count", 0) if isinstance(out_meta, dict) else 0
    processing_time = round(time.perf_counter() - t0, 3)
    full_text = "\n".join(text_parts)
    log(f"Done in {processing_time}s — {len(all_blocks)} blocks, {page_count} pages")

    return {
        "fullText": full_text,
        "markdown": markdown,
        "textBlocks": all_blocks,
        "tables": [],
        "avgConfidence": 95.0,
        "processingTime": processing_time,
        "pageCount": page_count,
        "warnings": warnings,
    }


# ── Main ─────────────────────────────────────────────────────────────────────

EXTRACTORS = {
    "docling": lambda args: extract_docling(args.input, chunk_size=args.chunk_size, mode=args.mode),
    "pdfplumber": lambda args: extract_pdfplumber(args.input),
    "pymupdf": lambda args: extract_pymupdf(args.input),
    "unstructured": lambda args: extract_unstructured(args.input),
}


def main() -> None:
    parser = argparse.ArgumentParser(description="Unified PDF extraction sidecar")
    parser.add_argument("--input", required=True, help="Path to document file")
    parser.add_argument(
        "--model",
        choices=list(EXTRACTORS.keys()),
        default="pdfplumber",
        help="Extraction model to use",
    )
    parser.add_argument(
        "--chunk-size",
        type=int,
        default=25,
        help="Pages per chunk (Docling only)",
    )
    parser.add_argument(
        "--mode",
        choices=["auto", "text", "ocr"],
        default="text",
        help="Docling mode (text/ocr)",
    )
    args = parser.parse_args()

    log(f"Model: {args.model}")
    extractor = EXTRACTORS.get(args.model)
    if not extractor:
        result = {"error": f"Unknown model: {args.model}"}
    else:
        result = extractor(args)

    sys.stdout.buffer.write(json.dumps(result, ensure_ascii=False).encode("utf-8"))
    sys.stdout.buffer.flush()

    if "error" in result:
        sys.exit(1)


if __name__ == "__main__":
    main()
