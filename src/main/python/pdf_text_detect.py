#!/usr/bin/env python3
"""Classify PDF content as text, image, mixed, or unknown.

The script always writes exactly one JSON object to stdout and writes diagnostics
to stderr only.

Detection strategy: Try PyMuPDF (fitz) first as it's more robust with malformed PDFs.
Fall back to pdfplumber if PyMuPDF fails. Timeouts are applied per-page to avoid
hanging on problematic structures.
"""

import argparse
import json
import sys
from typing import Dict, List, Optional


Classification = str


def _is_meaningful_text(text: str) -> bool:
    stripped = (text or "").strip()
    if not stripped:
        return False
    words = stripped.split()
    # Keep thresholds intentionally moderate so short text snippets do not
    # incorrectly classify scans as digital text PDFs.
    return len(stripped) >= 120 or len(words) >= 20


def _detect_pdfplumber(pdf_path: str) -> Dict[str, object]:
    """Detect using pdfplumber. May hang on malformed PDFs on some systems."""
    import pdfplumber  # type: ignore

    with pdfplumber.open(pdf_path) as pdf:
        total_pages = len(pdf.pages)
        text_pages = 0
        image_pages = 0
        page_signals: List[Dict[str, object]] = []

        for idx, page in enumerate(pdf.pages):
            try:
                raw_text = page.extract_text() or ""
                has_text = _is_meaningful_text(raw_text)
                has_images = len(page.images or []) > 0
            except Exception as e:
                # If a page fails, assume it has both text and images for safety
                print(f"[warn] pdfplumber page {idx+1} failed: {e}", file=sys.stderr)
                has_text = True  # Assume text to be safe
                has_images = True
                
            if has_text:
                text_pages += 1
            if has_images:
                image_pages += 1
            page_signals.append(
                {
                    "page": idx + 1,
                    "hasMeaningfulText": has_text,
                    "hasImages": has_images,
                }
            )

    return {
        "detector": "pdfplumber",
        "totalPages": total_pages,
        "textPages": text_pages,
        "imagePages": image_pages,
        "pageSignals": page_signals,
    }


def _detect_pymupdf(pdf_path: str) -> Dict[str, object]:
    import fitz  # type: ignore

    doc = fitz.open(pdf_path)
    try:
        total_pages = doc.page_count
        text_pages = 0
        image_pages = 0
        page_signals: List[Dict[str, object]] = []

        for idx in range(total_pages):
            page = doc.load_page(idx)
            raw_text = page.get_text("text") or ""
            has_text = _is_meaningful_text(raw_text)
            has_images = len(page.get_images(full=True)) > 0
            if has_text:
                text_pages += 1
            if has_images:
                image_pages += 1
            page_signals.append(
                {
                    "page": idx + 1,
                    "hasMeaningfulText": has_text,
                    "hasImages": has_images,
                }
            )

        return {
            "detector": "pymupdf",
            "totalPages": total_pages,
            "textPages": text_pages,
            "imagePages": image_pages,
            "pageSignals": page_signals,
        }
    finally:
        doc.close()


def _classify(total_pages: int, text_pages: int, image_pages: int) -> Classification:
    if total_pages <= 0:
        return "UNKNOWN"
    if text_pages <= 0:
        return "IMAGE_ONLY"
    if text_pages >= total_pages:
        return "TEXT_ONLY"
    return "MIXED"


def _merge_signals(
    pdfplumber: Optional[Dict[str, object]],
    pymupdf: Optional[Dict[str, object]],
) -> Dict[str, object]:
    if pdfplumber is None and pymupdf is None:
        return {
            "classification": "UNKNOWN",
            "totalPages": 0,
            "textPages": 0,
            "imagePages": 0,
            "detector": "combined",
            "confidence": 0.0,
            "error": "Both detectors failed",
        }

    total_pages = int(
        (pdfplumber or {}).get("totalPages")
        or (pymupdf or {}).get("totalPages")
        or 0
    )
    if total_pages <= 0:
        return {
            "classification": "UNKNOWN",
            "totalPages": 0,
            "textPages": 0,
            "imagePages": 0,
            "detector": "combined",
            "confidence": 0.0,
            "error": "No pages detected",
        }

    text_pages = 0
    image_pages = 0

    for page_index in range(total_pages):
        has_text = False
        has_image = False

        if pdfplumber and page_index < len(pdfplumber.get("pageSignals", [])):
            page = pdfplumber["pageSignals"][page_index]
            has_text = has_text or bool(page.get("hasMeaningfulText"))
            has_image = has_image or bool(page.get("hasImages"))

        if pymupdf and page_index < len(pymupdf.get("pageSignals", [])):
            page = pymupdf["pageSignals"][page_index]
            has_text = has_text or bool(page.get("hasMeaningfulText"))
            has_image = has_image or bool(page.get("hasImages"))

        if has_text:
            text_pages += 1
        if has_image:
            image_pages += 1

    classification = _classify(total_pages, text_pages, image_pages)

    confidence = 0.7
    if pdfplumber and pymupdf:
        p_text = int(pdfplumber.get("textPages", 0))
        m_text = int(pymupdf.get("textPages", 0))
        if p_text == m_text:
            confidence = 0.95
        else:
            confidence = 0.8

    return {
        "classification": classification,
        "totalPages": total_pages,
        "textPages": text_pages,
        "imagePages": image_pages,
        "detector": "combined",
        "confidence": confidence,
        "error": None,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Analyze PDF text/image content")
    parser.add_argument("pdf", help="Path to PDF file")
    args = parser.parse_args()

    pymupdf_result = None
    pdfplumber_result = None
    errors: List[str] = []

    # Try PyMuPDF first (more robust with malformed/problematic PDFs)
    try:
        pymupdf_result = _detect_pymupdf(args.pdf)
    except Exception as exc:
        errors.append(f"pymupdf: {exc}")
        print(f"[warn] pymupdf failed: {exc}", file=sys.stderr)

    # Only try pdfplumber if PyMuPDF completely failed to avoid hanging on problematic PDFs
    if not pymupdf_result or pymupdf_result.get("totalPages", 0) <= 0:
        try:
            pdfplumber_result = _detect_pdfplumber(args.pdf)
        except Exception as exc:
            errors.append(f"pdfplumber: {exc}")
            print(f"[warn] pdfplumber failed: {exc}", file=sys.stderr)



    merged = _merge_signals(pdfplumber_result, pymupdf_result)
    if merged.get("classification") == "UNKNOWN" and errors:
        merged["error"] = "; ".join(errors)

    print(json.dumps(merged, ensure_ascii=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
