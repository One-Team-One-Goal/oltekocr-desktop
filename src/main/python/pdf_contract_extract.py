"""
pdf_contract_extract.py
-----------------------
Extracts structured freight rate tables from a digital PDF contract using PyMuPDF.

Usage:
    python pdf_contract_extract.py --pdf <path>

Outputs a single JSON blob to stdout:
{
  "header": { "carrier", "contractId", "effectiveDate", "expirationDate" },
  "rates":         [ { ...row fields } ],
  "originArbs":    [ { ...row fields } ],
  "destArbs":      [ { ...row fields } ],
  "pageCount":     <int>,
  "processingTime": <float seconds>,
  "warnings":      [ <str>, ... ]
}
"""
from __future__ import annotations  # Python 3.7+ safe subscript annotations

import sys
import io
import json
import argparse
import time
import re
from typing import Any, Dict, List, Tuple

# Force UTF-8 stdout/stderr so non-ASCII city names don't cause encoding errors
# when Python is spawned as a subprocess on Windows (default cp1252 codepage)
if hasattr(sys.stdout, "buffer"):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "buffer"):
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")


class _FitzStdoutGuard:
    """Context manager: redirect sys.stdout -> sys.stderr during fitz calls.

    PyMuPDF (and pymupdf) occasionally print informational messages to stdout
    (e.g. 'Consider using the pymupdf_layout package…').  These corrupt the
    JSON we write to stdout, so we push them to stderr while fitz is running.
    """
    def __enter__(self):
        self._prev = sys.stdout
        sys.stdout = sys.stderr
        return self

    def __exit__(self, *_):
        sys.stdout = self._prev


try:
    import fitz  # PyMuPDF
except ImportError:
    print(json.dumps({"error": "PyMuPDF (fitz) is not installed. Run: pip install pymupdf"}))
    sys.exit(1)


# ─── Section boundary patterns ───────────────────────────────────────────────
# Each tuple: (compiled regex, section name)
# The first occurrence of each pattern in document order marks the start of
# that section.  Tables are assigned by comparing their document position
# (page × 1,000,000 + y0) against these boundaries.
#
# Patterns are intentionally fuzzy on separators (dot/dash/space) so they
# survive minor formatting variations across contract versions.

_BOUNDARY_PATTERNS: List[Tuple[re.Pattern, str]] = [
    (re.compile(r"6[\s\-\u2013\u2014.]+1[\s\-\u2013\u2014.]*General\s+Rate",          re.IGNORECASE), "RATES"),
    (re.compile(r"6[\s\-\u2013\u2014.]+3[\s\-\u2013\u2014.]*Origin\s+Arbitrary",      re.IGNORECASE), "ORIGIN_ARB"),
    (re.compile(r"6[\s\-\u2013\u2014.]+4[\s\-\u2013\u2014.]*Destination\s+Arbitrary", re.IGNORECASE), "DEST_ARB"),
    (re.compile(r"6[\s\-\u2013\u2014.]+5[\s\-\u2013\u2014.]*G\.?O\.?H",              re.IGNORECASE), "STOP"),
]

# ─── Column name normalisation map ────────────────────────────────────────────
# Maps raw header cell text → canonical field name
_COL_MAP = {
    # shared
    "carrier":                  "carrier",
    "contract id":              "contractId",
    "contract_id":              "contractId",
    "effective_date":           "effectiveDate",
    "effective date":           "effectiveDate",
    "expiration_date":          "expirationDate",
    "expiration date":          "expirationDate",
    "commodity":                "commodity",
    "service":                  "service",
    "remarks":                  "remarks",
    "scope":                    "scope",
    # rates / destination arb city columns
    "destination_city":         "destinationCity",
    "destination city":         "destinationCity",
    "destination_via_city":     "destinationViaCity",
    "destination via city":     "destinationViaCity",
    "destination via_city":     "destinationViaCity",
    # origin arb city columns
    "origin_city":              "originCity",
    "origin city":              "originCity",
    "origin_via_city":          "originViaCity",
    "origin via city":          "originViaCity",
    "origin via_city":          "originViaCity",
    # base rates
    "baserate 20":              "baseRate20",
    "baserate20":               "baseRate20",
    "base rate 20":             "baseRate20",
    "baserate 40":              "baseRate40",
    "baserate40":               "baseRate40",
    "base rate 40":             "baseRate40",
    "baserate 40h":             "baseRate40H",
    "baserate40h":              "baseRate40H",
    "base rate 40h":            "baseRate40H",
    "baserate 45":              "baseRate45",
    "baserate45":               "baseRate45",
    "base rate 45":             "baseRate45",
    # origin arb AGW
    "20' agw":                  "agw20",
    "20'agw":                   "agw20",
    "40' agw":                  "agw40",
    "40'agw":                   "agw40",
    "45' agw":                  "agw45",
    "45'agw":                   "agw45",
    "agw 20":                   "agw20",
    "agw 40":                   "agw40",
    "agw 45":                   "agw45",
    # dest arb surcharges
    "ams(china & japan)":       "amsChina",
    "ams (china & japan)":      "amsChina",
    "ams(china&japan)":         "amsChina",
    "hea heavy surcharge":      "heaHeavySurcharge",
    "hea heavy\nsurcharge":     "heaHeavySurcharge",
    "(hea) heavy surcharge":    "heaHeavySurcharge",
    "agw":                      "agw",
    "red sea diversion":        "redSeaDiversion",
    "red sea\ndiversion":       "redSeaDiversion",
    # actual contract header spellings (short-form / single-word variants)
    "destination":              "destinationCity",
    "destination via":          "destinationViaCity",
    "20'":                      "baseRate20",
    "40'":                      "baseRate40",
    "40hc":                     "baseRate40H",
    "40'hc":                    "baseRate40H",
    "40' hc":                   "baseRate40H",
    "45'":                      "baseRate45",
    "direct call":              "directCall",
    "direct\ncall":             "directCall",
}


def _norm_col(raw: str) -> str:
    """Normalise a raw header cell text to a canonical field name."""
    clean = raw.strip().lower().replace("\n", " ").replace("  ", " ")
    return _COL_MAP.get(clean, clean.replace(" ", "_").replace("'", ""))


# ─── Header extraction ─────────────────────────────────────────────────────────

_CONTRACT_ID_RE    = re.compile(r"\bATL\w+\b|Contract\s+(?:No\.?|Number|ID)[:\s]+([A-Z0-9\-]+)", re.IGNORECASE)
_DATE_RE           = re.compile(r"(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})")
_EFF_LABEL_RE      = re.compile(r"effective\s+date[:\s]+", re.IGNORECASE)
_EXP_LABEL_RE      = re.compile(r"expir(?:ation|y)\s+date[:\s]+", re.IGNORECASE)


def extract_header(doc: fitz.Document) -> Dict:
    """
    Pull carrier, contractId, effectiveDate, expirationDate from the first 2 pages of text.
    """
    header = {
        "carrier": "OLTEK",   # hardcoded per spec
        "contractId": "",
        "effectiveDate": "",
        "expirationDate": "",
    }

    text = ""
    for page_no in range(min(2, len(doc))):
        text += doc[page_no].get_text("text") + "\n"

    # Contract ID  — look for "ATLxxxxx" pattern first, then labelled field
    m = re.search(r"\b(ATL\d+[A-Z]\d*)\b", text)
    if m:
        header["contractId"] = m.group(1)
    else:
        m = re.search(r"Contract\s+(?:No\.?|Number|ID)[:\s]+([A-Z0-9\-]+)", text, re.IGNORECASE)
        if m:
            header["contractId"] = m.group(1).strip()

    # Dates — find all date-like strings then assign by proximity to labels
    dates_in_text = _DATE_RE.findall(text)

    eff_match = _EFF_LABEL_RE.search(text)
    if eff_match:
        after = text[eff_match.end():]
        dm = _DATE_RE.search(after)
        if dm:
            header["effectiveDate"] = dm.group(1)

    exp_match = _EXP_LABEL_RE.search(text)
    if exp_match:
        after = text[exp_match.end():]
        dm = _DATE_RE.search(after)
        if dm:
            header["expirationDate"] = dm.group(1)

    # Fallback: assign first two dates to effective / expiration
    if not header["effectiveDate"] and len(dates_in_text) > 0:
        header["effectiveDate"] = dates_in_text[0]
    if not header["expirationDate"] and len(dates_in_text) > 1:
        header["expirationDate"] = dates_in_text[1]

    return header


# ─── Document-level section boundary builder ─────────────────────────────────

def _build_section_boundaries(doc: fitz.Document) -> List[Tuple[int, float, str]]:
    """
    Scan every page and return a list of (page_no, y0, section_name) sorted by
    document order (page ascending, then y ascending).
    Each entry marks where a new section starts.
    Only the FIRST occurrence of each section heading is recorded.
    """  # noqa: D401
    found: List[Tuple[int, float, str]] = []
    seen_sections: set = set()

    for page_no in range(len(doc)):
        page = doc[page_no]
        try:
            page_dict = page.get_text("dict")
        except Exception:
            continue
        for block in page_dict.get("blocks", []):
            if block.get("type") != 0:   # 0 = text
                continue
            block_text = " ".join(
                span["text"]
                for line in block.get("lines", [])
                for span in line.get("spans", [])
            )
            for pattern, section_name in _BOUNDARY_PATTERNS:
                if section_name not in seen_sections and pattern.search(block_text):
                    y0 = float(block["bbox"][1])
                    found.append((page_no, y0, section_name))
                    seen_sections.add(section_name)
                    break

    found.sort(key=lambda t: (t[0], t[1]))
    return found


def _section_for(page_no: int, table_y0: float,
                 boundaries: List[Tuple[int, float, str]]) -> str:
    """
    Return the section that owns a table at (page_no, table_y0).
    A table is owned by the most recent boundary that precedes it in
    document order.  Returns "UNKNOWN" if no boundary precedes it.
    """
    table_pos = page_no * 1_000_000.0 + table_y0
    current = "UNKNOWN"
    for (b_page, b_y, b_section) in boundaries:
        if b_page * 1_000_000.0 + b_y <= table_pos:
            current = b_section
        else:
            break
    return current


def _DEAD_classify_section(page: fitz.Page, table_rect: Any, warnings: list) -> str:
    """REMOVED — kept as dead code for reference only.
    Look at text blocks on the same page that appear *above* the table.
    Return "RATES", "ORIGIN_ARB", "DEST_ARB", or "UNKNOWN".
    table_rect may be a fitz.Rect/IRect or a plain (x0,y0,x1,y1) tuple.
    """
    # Normalise: Rect has .y0 attribute; plain tuple uses index 1
    table_top = table_rect.y0 if hasattr(table_rect, "y0") else table_rect[1]

    # Collect all text blocks above the table rect
    blocks = page.get_text("blocks")  # (x0,y0,x1,y1,text,block_no,block_type)
    above_text = ""
    for b in blocks:
        bx0, by0, bx1, by1, btext = b[0], b[1], b[2], b[3], b[4]
        # Block must be above the table
        if by1 <= table_top + 5:
            above_text += " " + btext

    # NOTE: this function is no longer called — superseded by _build_section_boundaries
    # + _section_for.  Left here temporarily for reference.
    above_text = ""
    return "UNKNOWN"


def _scan_origin_labels(page: fitz.Page) -> List[Tuple[float, str, str]]:
    """
    Scan a page for ORIGIN / ORIGIN VIA labels.
    Returns list of (y0, 'origin'|'originVia', value) sorted by y0.

    Handles two PDF layouts:
      • Single-line:  "ORIGIN : CHARLESTON, SC, UNITED STATES(CY)"
      • Multi-line:   "ORIGIN"  (line 1)
                      " : "     (line 2  — colon-only, may have spaces)
                      "CHARLESTON, SC, UNITED STATES(CY)"  (line 3)

    Uses get_text("dict") so each visible line gets its own precise y0.
    """
    # Build a flat (y0, text) list from every span line on the page
    lines: List[Tuple[float, str]] = []
    for block in page.get_text("dict").get("blocks", []):
        if block.get("type") != 0:   # 0 = text block
            continue
        for line in block.get("lines", []):
            y0 = float(line["bbox"][1])
            text = " ".join(span["text"] for span in line.get("spans", [])).strip()
            if text:
                lines.append((y0, text))

    lines.sort(key=lambda x: x[0])

    results: List[Tuple[float, str, str]] = []
    i = 0
    while i < len(lines):
        y0, raw = lines[i]
        text = re.sub(r"\s+", " ", raw).strip()

        # ── Single-line: "ORIGIN VIA : value" ────────────────────────────────
        m = re.match(r"ORIGIN\s+VIA\s*:\s*(.+)", text, re.IGNORECASE)
        if m:
            results.append((y0, "originVia", m.group(1).strip()))
            i += 1
            continue

        # ── Single-line: "ORIGIN : value" ────────────────────────────────────
        m = re.match(r"ORIGIN(?!\s+VIA)\s*:\s*(.+)", text, re.IGNORECASE)
        if m:
            results.append((y0, "origin", m.group(1).strip()))
            i += 1
            continue

        # ── Multi-line: "ORIGIN VIA" alone ───────────────────────────────────
        if re.fullmatch(r"ORIGIN\s+VIA", text, re.IGNORECASE):
            label_y = y0
            # Look ahead: skip colon-only / whitespace-only lines, take next real value
            j = i + 1
            while j < len(lines) and re.fullmatch(r"[:\s]*", lines[j][1]):
                j += 1
            if j < len(lines) and lines[j][1].strip():
                results.append((label_y, "originVia", lines[j][1].strip()))
                i = j + 1
                continue

        # ── Multi-line: "ORIGIN" alone (not VIA) ─────────────────────────────
        if re.fullmatch(r"ORIGIN", text, re.IGNORECASE):
            label_y = y0
            j = i + 1
            while j < len(lines) and re.fullmatch(r"[:\s]*", lines[j][1]):
                j += 1
            if j < len(lines) and lines[j][1].strip():
                results.append((label_y, "origin", lines[j][1].strip()))
                i = j + 1
                continue

        i += 1

    results.sort(key=lambda x: x[0])
    return results


# ─── Core extraction ──────────────────────────────────────────────────────────

def extract_tables(doc: fitz.Document, header: Dict) -> Tuple[List, List, List, List]:
    """
    Iterate every page, find tables via `find_tables()`, assign each table to
    its section using document-level keyword boundaries, and return
    (rates, origin_arbs, dest_arbs, warnings).

    Cross-page table handling
    -------------------------
    When a table continues onto the next page its first row will NOT contain
    column headers.  We maintain `section_col_keys` — a per-section memory of
    the most recently seen column-key list — so continuation tables can be
    correctly mapped without repeating headers.
    """
    rates: List[Dict[str, Any]] = []
    origin_arbs: List[Dict[str, Any]] = []
    dest_arbs: List[Dict[str, Any]] = []
    warnings: List[str] = []

    # ── Step 1: locate section boundaries in the document ────────────────────
    boundaries = _build_section_boundaries(doc)
    if not boundaries:
        warnings.append(
            "No section boundary keywords (6-1/6-3/6-4/6-5) found. "
            "All tables will be treated as RATES."
        )
        # Insert a fake RATES boundary at the very start so tables are collected
        boundaries = [(0, 0.0, "RATES")]

    # ── Step 2: per-section column-key memory for cross-page continuations ───
    # section_col_keys["RATES"] = ["destinationCity", "baseRate20", ...]
    section_col_keys: Dict[str, List[str]] = {}

    # Origin/OriginVia context — carries forward across pages for continuation tables
    current_origin: str = ""
    current_origin_via: str = ""

    # ── Step 3: iterate pages / tables ───────────────────────────────────────
    for page_no in range(len(doc)):
        page = doc[page_no]

        # Scan for ORIGIN/ORIGIN VIA labels on this page (sorted by y position)
        origin_labels = _scan_origin_labels(page)

        try:
            with _FitzStdoutGuard():
                found_tables = page.find_tables(strategy="lines")
        except Exception as e:
            warnings.append(f"Page {page_no + 1}: find_tables() failed — {e}")
            for (_, ltype, lval) in origin_labels:
                if ltype == "origin":      current_origin = lval
                elif ltype == "originVia": current_origin_via = lval
            continue

        for tbl in found_tables:
            raw_rows = tbl.extract()   # list[list[str|None]]
            if not raw_rows or len(raw_rows) < 2:
                continue

            # Determine which section owns this table
            table_y0 = float(tbl.bbox[1]) if hasattr(tbl, "bbox") else 0.0
            section = _section_for(page_no, table_y0, boundaries)

            # Skip tables that appear before the first boundary or after STOP
            if section in ("UNKNOWN", "STOP"):
                continue

            # Compute per-table origin context: carry-forward + any labels above this table
            tbl_origin = current_origin
            tbl_origin_via = current_origin_via
            for (label_y, ltype, lval) in origin_labels:
                if label_y < table_y0:
                    if ltype == "origin":      tbl_origin = lval
                    elif ltype == "originVia": tbl_origin_via = lval

            # ── Detect header row ─────────────────────────────────────────────
            # Heuristic: a header row contains at least one cell with 3+ letters
            first_row = [str(c or "").strip() for c in raw_rows[0]]
            is_header = any(re.search(r"[a-zA-Z]{3,}", cell) for cell in first_row)

            if is_header:
                raw_keys = [_norm_col(c) for c in first_row]
                # Deduplicate colliding keys (e.g. two "Cntry" columns)
                col_keys = []
                seen_keys: Dict[str, int] = {}
                for k in raw_keys:
                    if k in seen_keys:
                        seen_keys[k] += 1
                        col_keys.append(f"{k}_{seen_keys[k]}")
                    else:
                        seen_keys[k] = 1
                        col_keys.append(k)
                section_col_keys[section] = col_keys   # remember for later pages
                data_rows = raw_rows[1:]
            else:
                # ── Cross-page continuation ───────────────────────────────────
                # No header — use the column layout from the most recent
                # header-bearing table in the same section.
                col_keys = section_col_keys.get(section, [])
                if not col_keys:
                    warnings.append(
                        f"Page {page_no + 1}: continuation table in {section} "
                        f"has no prior column header — skipping"
                    )
                    continue
                data_rows = raw_rows

            # ── Build row dicts ───────────────────────────────────────────────
            for raw_row in data_rows:
                cells = [str(c or "").strip() for c in raw_row]
                if not any(cells):
                    continue   # blank row

                row: Dict[str, Any] = {}
                for i, key in enumerate(col_keys):
                    row[key] = cells[i] if i < len(cells) else ""

                # Stamp contract header fields on every data row
                row["carrier"]        = header["carrier"]
                row["contractId"]     = header["contractId"]
                row["effectiveDate"]  = header["effectiveDate"]
                row["expirationDate"] = header["expirationDate"]

                if section == "RATES":
                    # Origin context only meaningful for rate tables
                    row["origin"]    = tbl_origin
                    row["originVia"] = tbl_origin_via
                    rates.append(row)
                elif section == "ORIGIN_ARB":
                    origin_arbs.append(row)
                elif section == "DEST_ARB":
                    dest_arbs.append(row)

        # Update carry-forward with the last origin labels seen on this page
        for (_, ltype, lval) in origin_labels:
            if ltype == "origin":      current_origin = lval
            elif ltype == "originVia": current_origin_via = lval

    return rates, origin_arbs, dest_arbs, warnings


# ─── Entry point ──────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Extract freight contract tables from a PDF")
    parser.add_argument("--pdf", required=True, help="Absolute path to the PDF file")
    args = parser.parse_args()

    start = time.time()
    warnings: List[str] = []

    try:
        doc = fitz.open(args.pdf)
    except Exception as e:
        print(json.dumps({"error": f"Failed to open PDF: {e}"}))
        sys.stdout.flush()
        sys.exit(1)

    page_count = len(doc)

    try:
        header = extract_header(doc)
        rates, origin_arbs, dest_arbs, tbl_warnings = extract_tables(doc, header)
        warnings.extend(tbl_warnings)

        # Collect raw per-page text so the UI can show a "Raw" preview
        raw_pages: List[Dict[str, Any]] = []
        for i in range(page_count):
            raw_pages.append({
                "page": i + 1,
                "text": doc[i].get_text("text"),
            })
    except Exception as e:
        print(json.dumps({"error": f"Extraction failed: {e}"}))
        sys.stdout.flush()
        sys.exit(1)
    finally:
        doc.close()

    elapsed = round(time.time() - start, 2)

    result = {
        "header":        header,
        "rates":         rates,
        "originArbs":    origin_arbs,
        "destArbs":      dest_arbs,
        "rawPages":      raw_pages,
        "pageCount":     page_count,
        "processingTime": elapsed,
        "warnings":      warnings,
    }

    print(json.dumps(result, ensure_ascii=False))
    sys.stdout.flush()


if __name__ == "__main__":
    main()
