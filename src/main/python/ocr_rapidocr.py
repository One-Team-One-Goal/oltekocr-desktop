"""
ocr_rapidocr.py  —  RapidOCR sidecar for OltekOCR Desktop
=============================================================
Accepts a single image (or PDF) path from --image flag and writes a JSON
result to stdout that the NestJS OCR service reads.

Usage:
    python ocr_rapidocr.py --image /path/to/scan.png [--lang en]

Output JSON schema:
{
  "fullText":        string,
  "textBlocks":      [{text, confidence, blockType, bbox:[x1,y1,x2,y2], page}],
  "avgConfidence":   number,
  "processingTime":  number,  // seconds
  "pageCount":       number,
  "warnings":        [string]
}

On error the script exits with code 1 and writes:
  {"error": "<message>"}
to stdout so the caller can surface the message.
"""

import argparse
import json
import os
import sys
import time
from pathlib import Path
from typing import Any


def _convert_pdf_to_images(pdf_path: str) -> list[Any]:
    """Convert each PDF page to a numpy array using PyMuPDF (fitz)."""
    try:
        import fitz  # PyMuPDF
        import numpy as np

        doc = fitz.open(pdf_path)
        images = []
        for page in doc:
            mat = fitz.Matrix(2.0, 2.0)  # 2× zoom ≈ 144 DPI
            pix = page.get_pixmap(matrix=mat, colorspace=fitz.csRGB)
            arr = np.frombuffer(pix.samples, dtype=np.uint8).reshape(
                pix.height, pix.width, 3
            )
            images.append(arr)
        doc.close()
        return images
    except ImportError:
        return []


def ocr_image(engine: Any, image: Any, page_num: int) -> tuple[list[dict], list[str]]:
    """Run RapidOCR on a single image (path str or numpy array).
    Returns (text_blocks, warnings).
    """
    warnings: list[str] = []
    try:
        output = engine(image)
    except Exception as exc:
        warnings.append(f"Page {page_num}: RapidOCR engine error — {exc}")
        return [], warnings

    # RapidOCR 3.x returns a RapidOCROutput object with .boxes / .txts / .scores
    # Fall back to treating it as an iterable of (bbox, text, conf) for older builds.
    if hasattr(output, "boxes"):
        boxes = output.boxes if output.boxes is not None else []
        txts = output.txts if output.txts is not None else []
        scores = output.scores if output.scores is not None else []
        items_iter = zip(boxes, txts, scores)
        use_new_api = True
    else:
        # Legacy tuple API: (result_list, elapse)
        try:
            result, _elapse = output  # type: ignore[misc]
        except Exception:
            result = output
        if result is None:
            return [], warnings
        items_iter = result  # type: ignore[assignment]
        use_new_api = False

    blocks: list[dict] = []
    for item in items_iter:
        try:
            if use_new_api:
                bbox_pts, text, conf = item
            elif len(item) == 3:
                bbox_pts, text, conf = item
            elif len(item) == 2:
                bbox_pts, text = item
                conf = 1.0
            else:
                continue

            text = str(text).strip()
            if not text:
                continue

            # Flatten quad box → axis-aligned [x1,y1,x2,y2]
            # bbox_pts = [[x1,y1],[x2,y1],[x2,y2],[x1,y2]]
            xs = [p[0] for p in bbox_pts]
            ys = [p[1] for p in bbox_pts]
            bbox = [int(min(xs)), int(min(ys)), int(max(xs)), int(max(ys))]

            blocks.append(
                {
                    "text": text,
                    "confidence": round(float(conf) * 100, 2),  # 0..100
                    "blockType": "paragraph",
                    "bbox": bbox,
                    "page": page_num,
                }
            )
        except Exception:
            continue

    return blocks, warnings


def run(image_path: str, lang: str = "en") -> dict:
    warnings: list[str] = []
    t0 = time.perf_counter()

    path = Path(image_path)
    if not path.exists():
        return {"error": f"File not found: {image_path}"}

    suffix = path.suffix.lower()
    is_pdf = suffix == ".pdf"

    try:
        try:
            from rapidocr_onnxruntime import RapidOCR  # type: ignore  # v1.4+
        except ImportError:
            from rapidocr import RapidOCR  # type: ignore  # legacy
    except ImportError as exc:
        return {"error": f"rapidocr is not installed: {exc}"}

    engine = RapidOCR()

    all_blocks: list[dict] = []

    if is_pdf:
        pages = _convert_pdf_to_images(str(path))
        if not pages:
            warnings.append(
                "PyMuPDF (fitz) not available — cannot process PDF. "
                "Install it with: pip install PyMuPDF"
            )
            page_count = 0
        else:
            page_count = len(pages)
            for i, page_img in enumerate(pages, start=1):
                blocks, page_warns = ocr_image(engine, page_img, i)
                all_blocks.extend(blocks)
                warnings.extend(page_warns)
    else:
        # Pass the file path directly; RapidOCR handles loading
        blocks, page_warns = ocr_image(engine, str(path), 1)
        all_blocks.extend(blocks)
        warnings.extend(page_warns)
        page_count = 1

    processing_time = round(time.perf_counter() - t0, 3)

    full_text = "\n".join(b["text"] for b in all_blocks)
    confidences = [b["confidence"] for b in all_blocks if b["confidence"] > 0]
    avg_confidence = round(sum(confidences) / len(confidences), 2) if confidences else 0.0

    return {
        "fullText": full_text,
        "markdown": full_text,  # plain text works fine as "markdown" fallback
        "textBlocks": all_blocks,
        "tables": [],
        "avgConfidence": avg_confidence,
        "processingTime": processing_time,
        "pageCount": max(page_count, 1),
        "warnings": warnings,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="RapidOCR sidecar")
    parser.add_argument("--image", required=True, help="Path to image or PDF")
    parser.add_argument("--lang", default="en", help="Language hint (default: en)")
    args = parser.parse_args()

    result = run(args.image, args.lang)
    # Write compact JSON to stdout; NestJS reads this
    sys.stdout.write(json.dumps(result, ensure_ascii=False))
    sys.stdout.flush()

    if "error" in result:
        sys.exit(1)


if __name__ == "__main__":
    main()
