"""
pdf_docling_text_extract.py
---------------------------
Docling text-only sidecar for PDF_EXTRACT workflows.

This intentionally avoids returning bbox/table metadata and returns a
pdfplumber-like text payload.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from typing import Dict, List


for _stream_name in ("stdout", "stderr"):
    _stream = getattr(sys, _stream_name, None)
    if _stream and hasattr(_stream, "reconfigure"):
        try:
            _stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass


def _load_docling_module():
    import importlib.util

    script_dir = os.path.dirname(os.path.abspath(__file__))
    path = os.path.join(script_dir, "pdf_docling.py")
    spec = importlib.util.spec_from_file_location("pdf_docling", path)
    if spec is None or spec.loader is None:
        raise RuntimeError("Failed to load pdf_docling.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _build_raw_pages(text_blocks: List[Dict], page_count: int) -> List[Dict]:
    pages: Dict[int, List[str]] = {i: [] for i in range(1, max(page_count, 0) + 1)}

    for block in text_blocks:
        text = str(block.get("text", "")).strip()
        if not text:
            continue
        try:
            page = int(block.get("page", 1))
        except Exception:
            page = 1
        if page < 1:
            page = 1
        if page not in pages:
            pages[page] = []
        pages[page].append(text)

    raw_pages: List[Dict] = []
    for page in sorted(pages.keys()):
        raw_pages.append({
            "page": page,
            "text": "\n".join(pages[page]).strip(),
        })
    return raw_pages


def run(input_path: str, chunk_size: int = 25, mode: str = "ocr") -> Dict:
    mod = _load_docling_module()
    result = mod.run(input_path, chunk_size=chunk_size, mode=mode)

    if not isinstance(result, dict):
        return {"error": "Unexpected Docling output format"}
    if "error" in result:
        return {"error": str(result.get("error", "Docling extraction failed"))}

    full_text = str(result.get("fullText", "") or "")
    page_count = int(result.get("pageCount", 0) or 0)
    processing_time = float(result.get("processingTime", 0) or 0)
    warnings = list(result.get("warnings", []) or [])
    text_blocks = list(result.get("textBlocks", []) or [])

    raw_pages = _build_raw_pages(text_blocks, page_count)

    return {
        "fullText": full_text,
        "rawPages": raw_pages,
        "pageCount": page_count,
        "processingTime": processing_time,
        "warnings": warnings,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Docling text-only PDF extractor")
    parser.add_argument("--input", required=True, help="Absolute path to PDF")
    parser.add_argument(
        "--chunk-size",
        type=int,
        default=25,
        help="Docling chunk size",
    )
    parser.add_argument(
        "--mode",
        choices=["auto", "text", "ocr"],
        default="ocr",
        help="Docling mode",
    )
    args = parser.parse_args()

    output = run(args.input, chunk_size=args.chunk_size, mode=args.mode)
    sys.stdout.buffer.write(json.dumps(output, ensure_ascii=False).encode("utf-8"))
    sys.stdout.buffer.flush()

    if "error" in output:
        sys.exit(1)


if __name__ == "__main__":
    main()
