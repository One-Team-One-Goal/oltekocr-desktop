import os

content = r'''"""
manual_schema_blocks.py
-----------------------
Extracts tables from line-ruled PDFs using pdfplumber.
Tables on different pages with identical (or very similar) headers are merged
into a single group. KV pairs from non-table lines are surfaced as context.

Output JSON:
{
  "blocks": [
    { "id": "...", "type": "table", "page": 1, "y": 120,
      "rawTableIndex": 0, "headers": [...], "rows": [...], "sampleRows": [...] },
    { "id": "...", "type": "kv_pair", "page": 1, "y": 90, "key": "...", "value": "..." },
    ...
  ]
}
"""
import argparse
import json
import re
import sys
import uuid
from pathlib import Path


def _progress(msg: str) -> None:
    sys.stderr.buffer.write((f"[progress] {msg}\n").encode("utf-8", errors="replace"))
    sys.stderr.buffer.flush()


def _emit_json(payload: dict) -> None:
    data = json.dumps(payload, ensure_ascii=False)
    sys.stdout.buffer.write(data.encode("utf-8", errors="replace"))
    sys.stdout.buffer.write(b"\n")
    sys.stdout.buffer.flush()


def _normalize_headers(raw: list) -> list[str]:
    headers = []
    for i, v in enumerate(raw):
        h = (str(v) if v is not None else "").strip()
        # Remove embedded newlines from multi-line header cells
        h = re.sub(r"\s*\n\s*", " ", h).strip()
        headers.append(h or f"column_{i + 1}")
    return headers


def _build_text_lines(words: list[dict]) -> list[tuple[float, str]]:
    if not words:
        return []
    lines: dict[int, list[dict]] = {}
    for w in words:
        y = int(round(float(w.get("top", 0.0))))
        lines.setdefault(y, []).append(w)
    out: list[tuple[float, str]] = []
    for y in sorted(lines.keys()):
        row = sorted(lines[y], key=lambda item: float(item.get("x0", 0.0)))
        text = " ".join(str(item.get("text", "")).strip() for item in row).strip()
        if text:
            out.append((float(y), text))
    return out


def extract_blocks_pdfplumber(pdf_path: str) -> list[dict]:
    try:
        import pdfplumber
    except ImportError as exc:
        raise RuntimeError(f"pdfplumber not installed: {exc}") from exc

    # Lines strategy — works for ruled/bordered tables
    TABLE_SETTINGS = {
        "vertical_strategy": "lines",
        "horizontal_strategy": "lines",
        "snap_tolerance": 4,
        "join_tolerance": 4,
        "intersection_tolerance": 4,
        "edge_min_length": 3,
    }

    kv_re = re.compile(r"^\s*([^:\n]{2,80})\s*:\s*(.+)$")
    blocks: list[dict] = []
    raw_table_index = 0

    with pdfplumber.open(pdf_path) as pdf:
        _progress(f"Pages: {len(pdf.pages)}")
        for page_index, page in enumerate(pdf.pages):
            page_no = page_index + 1

            # ── Extract tables ────────────────────────────────────────────────
            # Use find_tables() to get both bbox (for Y position) and data.
            # API varies by pdfplumber version; handle both.
            raw_table_objects = []
            try:
                finder_result = page.find_tables(table_settings=TABLE_SETTINGS)
                # Older pdfplumber: find_tables returns a TableFinder with .tables
                if hasattr(finder_result, "tables"):
                    raw_table_objects = finder_result.tables
                else:
                    # Newer pdfplumber: find_tables returns a list of Table objects directly
                    raw_table_objects = list(finder_result)
            except Exception:
                raw_table_objects = []

            if raw_table_objects:
                _progress(f"Page {page_no}: {len(raw_table_objects)} table(s) found")
            else:
                _progress(f"Page {page_no}: no ruled tables")

            # Collect bounding boxes for the table regions so we can skip
            # text lines that fall inside a table (avoid duplicate data).
            table_bboxes: list[tuple] = []
            for tobj in raw_table_objects:
                try:
                    table_bboxes.append(tobj.bbox)
                except Exception:
                    pass

            def _in_table(y: float) -> bool:
                for bbox in table_bboxes:
                    # bbox = (x0, top, x1, bottom)
                    if len(bbox) >= 4 and float(bbox[1]) <= y <= float(bbox[3]):
                        return True
                return False

            for tobj in raw_table_objects:
                try:
                    data = tobj.extract()
                except Exception:
                    continue
                if not data or len(data) < 2:
                    continue

                headers = _normalize_headers(data[0])
                rows: list[dict[str, str]] = []
                for r in data[1:]:
                    if not r:
                        continue
                    obj: dict[str, str] = {}
                    for idx, header in enumerate(headers):
                        cell = ""
                        if idx < len(r):
                            raw_cell = r[idx]
                            cell = (str(raw_cell) if raw_cell is not None else "").strip()
                            cell = re.sub(r"\s*\n\s*", " ", cell).strip()
                        obj[header] = cell
                    if any(v for v in obj.values()):
                        rows.append(obj)

                if not rows:
                    continue

                table_y = 0.0
                try:
                    table_y = float(tobj.bbox[1])
                except Exception:
                    table_y = 100000.0 + raw_table_index

                blocks.append({
                    "id": str(uuid.uuid4()),
                    "type": "table",
                    "page": page_no,
                    "y": table_y,
                    "rawTableIndex": raw_table_index,
                    "headers": headers,
                    "rows": rows,
                    "sampleRows": rows[:3],
                })
                raw_table_index += 1

            # ── Extract KV pairs / paragraphs from non-table text ─────────────
            words = page.extract_words() or []
            for y, line_text in _build_text_lines(words):
                if _in_table(y):
                    continue
                m = kv_re.match(line_text)
                if m:
                    blocks.append({
                        "id": str(uuid.uuid4()),
                        "type": "kv_pair",
                        "page": page_no,
                        "y": y,
                        "key": m.group(1).strip(),
                        "value": m.group(2).strip(),
                    })
                elif len(line_text) > 6:
                    blocks.append({
                        "id": str(uuid.uuid4()),
                        "type": "paragraph",
                        "page": page_no,
                        "y": y,
                        "text": line_text,
                    })

    blocks.sort(key=lambda b: (int(b.get("page", 0)), float(b.get("y", 0.0))))
    _progress(f"Total blocks: {len(blocks)}, tables: {raw_table_index}")
    return blocks


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, help="Absolute path to PDF file")
    args = parser.parse_args()

    path = Path(args.input)
    if not path.exists():
        _emit_json({"error": f"File not found: {args.input}"})
        return 1

    try:
        blocks = extract_blocks_pdfplumber(str(path))
        _emit_json({"blocks": blocks})
        return 0
    except Exception as exc:
        _emit_json({"error": str(exc)})
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
'''

target = r'd:\Dev\Hackathon\oltekocr-desktop\src\main\python\manual_schema_blocks.py'
with open(target, 'w', encoding='utf-8') as f:
    f.write(content)
print(f'Written {len(content)} chars to {target}')
