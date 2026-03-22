"""
manual_schema_blocks.py
-----------------------
Build ordered PDF blocks for manual schema builder.

Block types:
- kv_pair: ALL CAPS LABEL : value
- table:   pymupdf table detector output
- paragraph: fallback text lines
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from typing import Any, Dict, List, Tuple

for _stream_name in ("stdout", "stderr"):
    _stream = getattr(sys, _stream_name, None)
    if _stream and hasattr(_stream, "reconfigure"):
        try:
            _stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass

try:
    import fitz  # PyMuPDF
except Exception as exc:  # pragma: no cover - guard in sidecar
    print(json.dumps({"error": f"PyMuPDF is required: {exc}"}))
    sys.exit(1)

KV_RE = re.compile(r"^\s*([A-Z][A-Z0-9\s&/\-().]{1,80})\s*:\s*(.+?)\s*$")


def _inside_any_rect(line_rect: fitz.Rect, rects: List[fitz.Rect]) -> bool:
    for rect in rects:
        if line_rect.intersects(rect):
            return True
    return False


def _table_rows_to_dicts(rows: List[List[Any]], headers: List[str]) -> List[Dict[str, str]]:
    out: List[Dict[str, str]] = []
    for raw_row in rows:
        row_vals = [str(v or "").strip() for v in raw_row]
        if not any(row_vals):
            continue
        row_obj: Dict[str, str] = {}
        for idx, header in enumerate(headers):
            row_obj[header] = row_vals[idx] if idx < len(row_vals) else ""
        out.append(row_obj)
    return out


def extract_blocks(pdf_path: str) -> Dict[str, Any]:
    doc = fitz.open(pdf_path)
    blocks: List[Dict[str, Any]] = []

    try:
        for page_idx in range(doc.page_count):
            page = doc[page_idx]
            page_no = page_idx + 1

            table_rects: List[fitz.Rect] = []
            try:
                tables = page.find_tables()
                for table_idx, table in enumerate(tables.tables):
                    bbox = fitz.Rect(table.bbox)
                    table_rects.append(bbox)

                    extracted = table.extract() or []
                    if not extracted:
                        continue

                    header_row = [str(v or "").strip() for v in extracted[0]]
                    headers = [h if h else f"col_{i + 1}" for i, h in enumerate(header_row)]
                    rows = _table_rows_to_dicts(extracted[1:], headers)

                    blocks.append(
                        {
                            "id": f"table_{page_no}_{table_idx}",
                            "type": "table",
                            "page": page_no,
                            "y": float(bbox.y0),
                            "headers": headers,
                            "rows": rows,
                            "text": "\n".join(" | ".join(r.values()) for r in rows),
                        }
                    )
            except Exception:
                pass

            text_dict = page.get_text("dict")
            line_idx = 0
            for block in text_dict.get("blocks", []):
                if block.get("type") != 0:
                    continue

                for line in block.get("lines", []):
                    spans = line.get("spans", [])
                    text = " ".join(str(s.get("text", "")) for s in spans).strip()
                    if not text:
                        continue

                    line_rect = fitz.Rect(line.get("bbox", block.get("bbox", (0, 0, 0, 0))))
                    if _inside_any_rect(line_rect, table_rects):
                        continue

                    y = float(line_rect.y0)
                    m = KV_RE.match(text)
                    if m:
                        key = re.sub(r"\s+", " ", m.group(1).strip())
                        value = m.group(2).strip()
                        blocks.append(
                            {
                                "id": f"kv_{page_no}_{line_idx}",
                                "type": "kv_pair",
                                "page": page_no,
                                "y": y,
                                "key": key,
                                "value": value,
                                "text": text,
                            }
                        )
                    else:
                        blocks.append(
                            {
                                "id": f"para_{page_no}_{line_idx}",
                                "type": "paragraph",
                                "page": page_no,
                                "y": y,
                                "text": text,
                            }
                        )
                    line_idx += 1
    finally:
        doc.close()

    blocks.sort(key=lambda b: (int(b.get("page", 0)), float(b.get("y", 0.0))))

    return {
        "blocks": blocks,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Extract ordered manual-schema blocks from a PDF")
    parser.add_argument("--pdf", required=True, help="Absolute path to PDF")
    args = parser.parse_args()

    try:
        payload = extract_blocks(args.pdf)
        print(json.dumps(payload, ensure_ascii=False))
        sys.stdout.flush()
    except Exception as exc:
        print(json.dumps({"error": f"Failed to extract blocks: {exc}"}))
        sys.stdout.flush()
        sys.exit(1)


if __name__ == "__main__":
    main()
