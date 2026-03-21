#!/usr/bin/env python3
"""
Detect if a PDF has extractable text using pdfplumber.
Returns 'PDF_TEXT' or 'PDF_IMAGE' to stdout.
Exit code 0 always after detection.
"""

import sys
import argparse


def detect_with_pdfplumber(pdf_path: str) -> str:
    """Use pdfplumber to extract text from first few pages."""
    try:
        import pdfplumber
        with pdfplumber.open(pdf_path) as pdf:
            if len(pdf.pages) == 0:
                return "PDF_IMAGE"

            # Sample first up to 3 pages; image-only PDFs may still contain /Font objects.
            sample_pages = min(len(pdf.pages), 3)
            parts: list[str] = []
            for idx in range(sample_pages):
                text = pdf.pages[idx].extract_text() or ""
                if text.strip():
                    parts.append(text.strip())

            merged = "\n".join(parts).strip()
            if not merged:
                return "PDF_IMAGE"

            # Require meaningful text density to avoid OCR noise/metadata false positives.
            words = merged.split()
            if len(merged) >= 120 or len(words) >= 20:
                return "PDF_TEXT"
            return "PDF_IMAGE"
    except Exception:
        # If detection library is unavailable or PDF is malformed, use safe default.
        return "PDF_IMAGE"


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Detect if PDF has text")
    parser.add_argument("pdf", help="Path to PDF file")
    args = parser.parse_args()

    # Use text extraction signal only; avoid /Font-based false positives.
    result = detect_with_pdfplumber(args.pdf)

    print(result)
    sys.exit(0)
