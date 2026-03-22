"""
pdf_contract_extract.py
-----------------------
Legacy/standard freight contract extraction using pdfplumber.

This entrypoint always runs the hardcoded legacy extractor.
Schema-driven dynamic extraction lives in pdf_contract_extract_dynamic.py.
"""
from __future__ import annotations  # Python 3.7+ safe subscript annotations

import sys
import json
import argparse
import time
import re
import ast
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple

# Force UTF-8 output for Windows subprocesses without replacing stream objects.
for _stream_name in ("stdout", "stderr"):
    _stream = getattr(sys, _stream_name, None)
    if _stream and hasattr(_stream, "reconfigure"):
        try:
            _stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass


class _FitzStdoutGuard:
    """No-op context manager kept for backward compatibility."""
    def __enter__(self):
        return self

    def __exit__(self, *_):
        return None


try:
    import pdfplumber
except ImportError:
    print(json.dumps({"error": "pdfplumber is not installed. Run: pip install pdfplumber"}))
    sys.exit(1)


class _PlumberTableAdapter:
    def __init__(self, table: Any):
        self._table = table
        self.bbox = tuple(table.bbox) if hasattr(table, "bbox") else (0.0, 0.0, 0.0, 0.0)

    def extract(self) -> List[List[Any]]:
        return self._table.extract() or []


class _PlumberTableFinderAdapter:
    def __init__(self, tables: List[_PlumberTableAdapter]):
        self.tables = tables

    def __iter__(self):
        return iter(self.tables)


class _PlumberPageAdapter:
    def __init__(self, page: Any):
        self._page = page

    def _line_items(self) -> List[Dict[str, Any]]:
        words = self._page.extract_words(x_tolerance=2, y_tolerance=2, keep_blank_chars=False) or []
        by_line: Dict[float, List[Dict[str, Any]]] = {}
        for w in words:
            top = round(float(w.get("top", 0.0)), 1)
            by_line.setdefault(top, []).append(w)

        lines: List[Dict[str, Any]] = []
        for _, items in sorted(by_line.items(), key=lambda kv: kv[0]):
            items.sort(key=lambda it: float(it.get("x0", 0.0)))
            text = " ".join(str(it.get("text", "")) for it in items).strip()
            if not text:
                continue
            x0 = min(float(it.get("x0", 0.0)) for it in items)
            x1 = max(float(it.get("x1", 0.0)) for it in items)
            y0 = min(float(it.get("top", 0.0)) for it in items)
            y1 = max(float(it.get("bottom", 0.0)) for it in items)
            lines.append({"text": text, "bbox": (x0, y0, x1, y1)})
        return lines

    def get_text(self, mode: str = "text") -> Any:
        if mode == "text":
            return self._page.extract_text() or ""

        lines = self._line_items()
        if mode == "blocks":
            return [
                (line["bbox"][0], line["bbox"][1], line["bbox"][2], line["bbox"][3], line["text"], idx, 0)
                for idx, line in enumerate(lines)
            ]

        if mode == "dict":
            return {
                "blocks": [
                    {
                        "type": 0,
                        "bbox": line["bbox"],
                        "lines": [
                            {
                                "bbox": line["bbox"],
                                "spans": [
                                    {
                                        "text": line["text"],
                                        "bbox": line["bbox"],
                                    }
                                ],
                            }
                        ],
                    }
                    for line in lines
                ]
            }

        raise ValueError(f"Unsupported text mode: {mode}")

    def find_tables(self, strategy: str = "lines") -> _PlumberTableFinderAdapter:
        if strategy == "lines_strict":
            settings = {"vertical_strategy": "lines_strict", "horizontal_strategy": "lines_strict"}
        else:
            settings = {"vertical_strategy": "lines", "horizontal_strategy": "lines"}
        tables = self._page.find_tables(table_settings=settings) or []
        return _PlumberTableFinderAdapter([_PlumberTableAdapter(t) for t in tables])


class _PlumberDocumentAdapter:
    def __init__(self, doc: Any):
        self._doc = doc
        self._pages = [_PlumberPageAdapter(page) for page in doc.pages]

    def __len__(self) -> int:
        return len(self._pages)

    def __getitem__(self, index: int) -> _PlumberPageAdapter:
        return self._pages[index]

    def close(self) -> None:
        self._doc.close()


def open_pdf_document(path: str) -> _PlumberDocumentAdapter:
    return _PlumberDocumentAdapter(pdfplumber.open(path))


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


def extract_header(doc: Any) -> Dict:
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

def _build_section_boundaries(doc: Any) -> List[Tuple[int, float, str]]:
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


def _DEAD_classify_section(page: Any, table_rect: Any, warnings: list) -> str:
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


def _scan_origin_labels(page: Any) -> List[Tuple[float, str, str]]:
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

def extract_tables(doc: Any, header: Dict) -> Tuple[List, List, List, List]:
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


def _parse_schema_preset(schema_json: Optional[str], warnings: List[str]) -> Optional[Dict[str, Any]]:
    if not schema_json:
        return None

    try:
        parsed = json.loads(schema_json)
    except Exception as err:
        warnings.append(f"Invalid schema JSON payload: {err}")
        return None

    if not isinstance(parsed, dict):
        warnings.append("Schema payload must be an object with name and tabs.")
        return None

    name = str(parsed.get("name", "")).strip()
    tabs_raw = parsed.get("tabs", [])
    if not isinstance(tabs_raw, list):
        warnings.append("Schema payload tabs must be an array.")
        return None

    tabs: List[Dict[str, Any]] = []
    for tab_idx, tab in enumerate(tabs_raw):
        if not isinstance(tab, dict):
            warnings.append(f"Schema tab #{tab_idx + 1} is not an object; skipping.")
            continue

        tab_name = str(tab.get("name", "")).strip() or f"Tab {tab_idx + 1}"
        fields_raw = tab.get("fields", [])
        if not isinstance(fields_raw, list):
            warnings.append(f"Schema tab '{tab_name}' fields must be an array; skipping tab.")
            continue

        fields: List[Dict[str, Any]] = []
        for field_idx, item in enumerate(fields_raw):
            if not isinstance(item, dict):
                warnings.append(
                    f"Schema field #{field_idx + 1} in tab '{tab_name}' is not an object; skipping."
                )
                continue

            label = str(item.get("label", "")).strip()
            field_key = str(item.get("fieldKey", "")).strip()
            regex_rule = str(item.get("regexRule", "")).strip()

            if not field_key:
                warnings.append(
                    f"Schema field #{field_idx + 1} in tab '{tab_name}' missing fieldKey; skipping."
                )
                continue

            field_obj: Dict[str, Any] = {
                "label": label,
                "fieldKey": field_key,
                "regexRule": regex_rule,
            }

            # ── Enhanced field properties ──
            extraction_strategy = str(item.get("extractionStrategy", "regex")).strip()
            if extraction_strategy in ("regex", "table_column", "header_field", "page_region"):
                field_obj["extractionStrategy"] = extraction_strategy

            data_type = str(item.get("dataType", "string")).strip()
            if data_type in ("string", "currency", "number", "date", "percentage"):
                field_obj["dataType"] = data_type

            page_range = str(item.get("pageRange", "")).strip()
            if page_range:
                field_obj["pageRange"] = page_range

            post_processing = item.get("postProcessing", [])
            if isinstance(post_processing, list):
                field_obj["postProcessing"] = [str(p).strip() for p in post_processing if str(p).strip()]

            alt_regex_rules = item.get("altRegexRules", [])
            if isinstance(alt_regex_rules, list):
                field_obj["altRegexRules"] = [str(r).strip() for r in alt_regex_rules if str(r).strip()]

            section_hint = str(item.get("sectionHint", "")).strip()
            if section_hint:
                field_obj["sectionHint"] = section_hint.upper()

            section_indicator_key = str(
                item.get("sectionIndicatorKey", item.get("contextLabel", ""))
            ).strip()
            if section_indicator_key:
                field_obj["sectionIndicatorKey"] = section_indicator_key

            context_hint = str(item.get("contextHint", "")).strip()
            if context_hint in ("same_line_after_label", "next_line_after_label", "table_cell"):
                field_obj["contextHint"] = context_hint

            context_label = str(item.get("contextLabel", "")).strip()
            if context_label:
                field_obj["contextLabel"] = context_label

            mandatory = item.get("mandatory", False)
            if isinstance(mandatory, bool):
                field_obj["mandatory"] = mandatory

            expected_format = str(item.get("expectedFormat", "")).strip()
            if expected_format:
                field_obj["expectedFormat"] = expected_format

            min_length = item.get("minLength")
            if isinstance(min_length, int) and min_length >= 0:
                field_obj["minLength"] = min_length

            max_length = item.get("maxLength")
            if isinstance(max_length, int) and max_length >= 0:
                field_obj["maxLength"] = max_length

            allowed_values = item.get("allowedValues", [])
            if isinstance(allowed_values, list):
                field_obj["allowedValues"] = [str(v).strip() for v in allowed_values if str(v).strip()]

            fields.append(field_obj)

        tabs.append({"name": tab_name, "fields": fields})

    if not tabs:
        return None

    extraction_mode_raw = str(parsed.get("extractionMode", "AUTO")).strip().upper()
    extraction_mode = (
        extraction_mode_raw
        if extraction_mode_raw in ("AUTO", "CONTRACT_BIASED", "GENERIC")
        else "AUTO"
    )
    record_start_regex = str(parsed.get("recordStartRegex", "")).strip() or None

    return {
        "name": name,
        "extractionMode": extraction_mode,
        "recordStartRegex": record_start_regex,
        "tabs": tabs,
    }


def _to_float(value: Any) -> Optional[float]:
    try:
        cleaned = re.sub(r"[^\d.\-]", "", str(value or ""))
        if cleaned in ("", "-", ".", "-."):
            return None
        return float(cleaned)
    except Exception:
        return None


def _lookup_context_number(context: Dict[str, Any], reference: str) -> Optional[float]:
    ref = str(reference or "").strip()
    if not ref:
        return None

    # Direct key lookup first
    if ref in context:
        return _to_float(context.get(ref))

    # Canonical key fallback (strip non-alphanumeric)
    ref_canon = re.sub(r"[^a-z0-9]", "", ref.lower())
    for key, raw in context.items():
        key_canon = re.sub(r"[^a-z0-9]", "", str(key).lower())
        if key_canon == ref_canon:
            return _to_float(raw)

    return None


def _safe_eval_formula(
    expression: str,
    context: Dict[str, Any],
    warnings: Optional[List[str]] = None,
    field_key: str = "",
) -> Optional[float]:
    formula = str(expression or "").strip()
    if not formula:
        return None

    # Placeholder style: {{Field Key}} * 1.2
    def repl(match: re.Match) -> str:
        ref = match.group(1).strip()
        num = _lookup_context_number(context, ref)
        if num is None:
            if warnings is not None:
                warnings.append(
                    f"Formula reference '{ref}' not found for field '{field_key}'"
                )
            return "0"
        return str(num)

    formula = re.sub(r"\{\{\s*([^}]+?)\s*\}\}", repl, formula)

    variables: Dict[str, float] = {}
    for key, raw in context.items():
        numeric = _to_float(raw)
        if numeric is None:
            continue
        key_str = str(key)
        aliases = {
            key_str,
            re.sub(r"[^A-Za-z0-9_]", "_", key_str),
            re.sub(r"[^a-z0-9]", "", key_str.lower()),
        }
        for alias in aliases:
            if not alias:
                continue
            if alias[0].isdigit():
                alias = f"f_{alias}"
            if re.match(r"^[A-Za-z_][A-Za-z0-9_]*$", alias) and alias not in variables:
                variables[alias] = numeric

    try:
        parsed = ast.parse(formula, mode="eval")
        allowed_nodes = (
            ast.Expression,
            ast.BinOp,
            ast.UnaryOp,
            ast.Add,
            ast.Sub,
            ast.Mult,
            ast.Div,
            ast.USub,
            ast.UAdd,
            ast.Mod,
            ast.Pow,
            ast.FloorDiv,
            ast.Name,
            ast.Load,
            ast.Constant,
        )
        for node in ast.walk(parsed):
            if not isinstance(node, allowed_nodes):
                raise ValueError(f"Unsupported token: {type(node).__name__}")
            if isinstance(node, ast.Name) and node.id not in variables:
                raise ValueError(f"Unknown variable: {node.id}")

        result = eval(compile(parsed, "<formula>", "eval"), {"__builtins__": {}}, variables)
        return float(result)
    except Exception as err:
        if warnings is not None:
            warnings.append(f"Invalid formula for field '{field_key}': {err}")
        return None


def _apply_post_processing(
    value: str,
    rules: List[str],
    context: Optional[Dict[str, Any]] = None,
    warnings: Optional[List[str]] = None,
    field_key: str = "",
) -> str:
    """Apply a sequence of post-processing transformations to a value."""
    result = value
    context = context or {}
    for rule in rules:
        rule = rule.strip().lower()
        if rule == "trim":
            result = result.strip()
        elif rule == "uppercase":
            result = result.upper()
        elif rule == "lowercase":
            result = result.lower()
        elif rule == "remove_commas":
            result = result.replace(",", "")
        elif rule == "remove_currency":
            result = re.sub(r"[$€¥£]", "", result)
        elif rule == "extract_digits":
            result = re.sub(r"[^\d.]", "", result)
        elif rule == "fix_date":
            # Try to parse various date formats and normalize to YYYY-MM-DD
            for fmt in ["%m/%d/%Y", "%d/%m/%Y", "%m-%d-%Y", "%d-%m-%Y", "%Y-%m-%d"]:
                try:
                    import datetime
                    parsed = datetime.datetime.strptime(result.strip(), fmt)
                    result = parsed.strftime("%Y-%m-%d")
                    break
                except ValueError:
                    continue
        elif rule.startswith("add_days:") or rule.startswith("sub_days:"):
            try:
                sign = -1 if rule.startswith("sub_days:") else 1
                amount = int(rule.split(":", 1)[1].strip())
                for fmt in ["%Y-%m-%d", "%m/%d/%Y", "%d/%m/%Y", "%m-%d-%Y", "%d-%m-%Y"]:
                    try:
                        parsed = datetime.strptime(result.strip(), fmt)
                        shifted = parsed + timedelta(days=sign * amount)
                        result = shifted.strftime("%Y-%m-%d")
                        break
                    except ValueError:
                        continue
            except Exception:
                pass
        elif any(rule.startswith(prefix) for prefix in ("add:", "sub:", "mul:", "div:")):
            try:
                op, raw_operand = rule.split(":", 1)
                operand = float(raw_operand.strip())
                numeric = float(re.sub(r"[^\d.\-]", "", result) or "0")
                if op == "add":
                    numeric = numeric + operand
                elif op == "sub":
                    numeric = numeric - operand
                elif op == "mul":
                    numeric = numeric * operand
                elif op == "div" and operand != 0:
                    numeric = numeric / operand
                result = str(numeric)
            except Exception:
                pass
        elif any(rule.startswith(prefix) for prefix in ("add_field:", "sub_field:", "mul_field:", "div_field:")):
            try:
                op, ref = rule.split(":", 1)
                ref_value = _lookup_context_number(context, ref)
                numeric = float(re.sub(r"[^\d.\-]", "", result) or "0")
                if ref_value is None:
                    if warnings is not None:
                        warnings.append(
                            f"Referenced field '{ref}' not found for field '{field_key}'"
                        )
                    continue
                if op == "add_field":
                    numeric = numeric + ref_value
                elif op == "sub_field":
                    numeric = numeric - ref_value
                elif op == "mul_field":
                    numeric = numeric * ref_value
                elif op == "div_field" and ref_value != 0:
                    numeric = numeric / ref_value
                result = str(numeric)
            except Exception:
                pass
        elif rule.startswith("formula:"):
            numeric = _safe_eval_formula(rule.split(":", 1)[1], context, warnings, field_key)
            if numeric is not None:
                result = str(numeric)
        elif rule.startswith("round:"):
            try:
                digits = int(rule.split(":", 1)[1].strip())
                numeric = float(re.sub(r"[^\d.\-]", "", result) or "0")
                result = str(round(numeric, digits))
            except Exception:
                pass
    return result


def _validate_extraction(
    value: str, field: Dict[str, Any], warnings: List[str]
) -> Tuple[bool, str]:
    """
    Validate extracted value against field constraints.
    Returns (is_valid, potentially_corrected_value, warning_message).
    """
    if not value and field.get("mandatory"):
        return False, value

    if not value:
        return True, value

    min_len = field.get("minLength", 0)
    max_len = field.get("maxLength", None)

    if len(value) < min_len:
        return False, value

    if max_len and len(value) > max_len:
        return False, value

    allowed = field.get("allowedValues", [])
    if allowed and value not in allowed:
        return False, value

    return True, value


def _extract_field_value(
    full_text: str,
    pdf_pages: List[str],
    field: Dict[str, Any],
    warnings: List[str],
    search_text_override: Optional[str] = None,
) -> str:
    """
    Extract a field value using the configured extraction strategy and rules.
    
    Tries primary regex, then fallback regexes, with post-processing applied.
    """
    extraction_strategy = field.get("extractionStrategy", "regex")
    regex_rule = field.get("regexRule", "").strip()
    alt_regex_rules = field.get("altRegexRules", [])
    post_processing = field.get("postProcessing", [])
    page_range = field.get("pageRange", "")
    field_key = field.get("fieldKey", "")

    value = ""

    # ── Step 1: Determine search scope (full text or specific pages) ────────
    search_text = search_text_override if search_text_override is not None else full_text
    if search_text_override is None and page_range:
        try:
            # Parse page range: "1", "1-3", "1,5,7"
            page_nums = set()
            for part in page_range.split(","):
                part = part.strip()
                if "-" in part:
                    start, end = part.split("-", 1)
                    page_nums.update(range(int(start.strip()) - 1, int(end.strip())))
                else:
                    page_nums.add(int(part) - 1)

            search_text = "\n".join(
                pdf_pages[i] for i in sorted(page_nums) if 0 <= i < len(pdf_pages)
            )
        except Exception as err:
            warnings.append(
                f"Could not parse pageRange '{page_range}' for field '{field_key}': {err}"
            )
            search_text = full_text

    # ── Step 2: Try primary regex ────────────────────────────────────────────
    if extraction_strategy == "regex" and regex_rule:
        try:
            match = re.search(regex_rule, search_text, re.IGNORECASE | re.MULTILINE)
            if match:
                if match.lastindex and match.lastindex >= 1:
                    value = next((g for g in match.groups() if g is not None), "")
                    if not value:
                        value = match.group(0)
                else:
                    value = match.group(0)
        except re.error as err:
            warnings.append(f"Invalid regex for field '{field_key}': {err}")

    # ── Step 3: Try fallback regexes if primary failed ──────────────────────
    if not value and alt_regex_rules:
        for alt_rule in alt_regex_rules:
            alt_rule = alt_rule.strip()
            if not alt_rule:
                continue
            try:
                match = re.search(alt_rule, search_text, re.IGNORECASE | re.MULTILINE)
                if match:
                    if match.lastindex and match.lastindex >= 1:
                        value = next((g for g in match.groups() if g is not None), "")
                        if not value:
                            value = match.group(0)
                    else:
                        value = match.group(0)
                    break  # Success on first fallback
            except re.error as err:
                warnings.append(f"Invalid alt regex for field '{field_key}': {err}")

    # ── Step 4: Apply post-processing ────────────────────────────────────────
    if value and post_processing:
        value = _apply_post_processing(value, post_processing, warnings=warnings, field_key=field_key)

    # ── Step 5: Validate against constraints ─────────────────────────────────
    is_valid, value = _validate_extraction(value, field, warnings)
    if not is_valid:
        if field.get("mandatory"):
            warnings.append(f"Field '{field_key}' failed validation; expected format: {field.get('expectedFormat', 'N/A')}")
        return ""

    return value.strip()


def _extract_by_context_hint(
    text: str,
    label: str,
    context_hint: str,
    all_labels: Optional[List[str]] = None,
) -> str:
    """Extract value by label position for header-like fields.

    - same_line_after_label: read text after label on the same line
    - next_line_after_label: read next non-empty line after label line
    """
    label_clean = str(label or "").strip()
    if not label_clean:
        return ""

    lines = text.splitlines()
    if not lines:
        return ""

    label_re = re.compile(rf"{re.escape(label_clean.rstrip(':'))}\s*:?", re.IGNORECASE)

    normalized_labels = []
    for raw in all_labels or []:
        cleaned = str(raw or "").strip().rstrip(":")
        if cleaned and cleaned.lower() != label_clean.rstrip(":").lower():
            normalized_labels.append(cleaned)

    def cut_at_next_label(value: str) -> str:
        candidate = value.strip()
        if not candidate:
            return ""
        stop_at = len(candidate)
        for other_label in normalized_labels:
            match = re.search(rf"\b{re.escape(other_label)}\s*:?", candidate, re.IGNORECASE)
            if match and match.start() < stop_at:
                stop_at = match.start()
        return candidate[:stop_at].strip(" :-\t")

    for idx, raw_line in enumerate(lines):
        line = raw_line.strip()
        if not line:
            continue
        match = label_re.search(line)
        if not match:
            continue

        # Same-line tail after the label is often present for both modes.
        tail = cut_at_next_label(line[match.end() :])
        if tail:
            return tail

        # Fallback to next non-empty line for multi-line layouts.
        if context_hint in ("same_line_after_label", "next_line_after_label"):
            for next_idx in range(idx + 1, len(lines)):
                candidate = cut_at_next_label(lines[next_idx])
                if candidate:
                    return candidate

    return ""


def _build_header_chunks(
    full_text: str,
    fields: List[Dict[str, Any]],
    warnings: List[str],
) -> List[str]:
    """Split full text into repeated header chunks using sectionIndicatorKey.

    If no usable indicator or only one match is found, returns [full_text].
    """
    indicator = ""
    for field in fields:
        raw = str(field.get("sectionIndicatorKey", "")).strip()
        if raw:
            indicator = raw
            break

    def find_starts(pattern: str) -> List[int]:
        try:
            return sorted(
                set(m.start() for m in re.finditer(re.escape(pattern), full_text, re.IGNORECASE))
            )
        except re.error as err:
            warnings.append(f"Invalid section indicator '{pattern}': {err}")
            return []

    if not indicator:
        # Heuristic fallback for repeated document headers in a combined PDF:
        # try field labels/keys and pick the first one that repeats.
        for field in fields:
            candidates = [
                str(field.get("label", "")).strip().rstrip(":"),
                str(field.get("fieldKey", "")).strip(),
            ]
            for candidate in candidates:
                if len(candidate) < 3:
                    continue
                starts = find_starts(candidate)
                if len(starts) > 1:
                    indicator = candidate
                    warnings.append(
                        f"Auto header chunking using indicator '{indicator}' ({len(starts)} matches)."
                    )
                    break
            if indicator:
                break

    if not indicator:
        return [full_text]

    starts = find_starts(indicator)

    # De-dupe + stable sort
    starts = sorted(set(starts))
    if len(starts) <= 1:
        return [full_text]

    chunks: List[str] = []
    for idx, start in enumerate(starts):
        end = starts[idx + 1] if idx + 1 < len(starts) else len(full_text)
        chunk = full_text[start:end].strip()
        if chunk:
            chunks.append(chunk)

    return chunks or [full_text]


def _canon_key(value: str) -> str:
    return re.sub(r"[^a-z0-9]", "", value.lower())


def _lookup_row_value(row: Dict[str, Any], field: Dict[str, Any]) -> str:
    """Best-effort lookup from extracted table row using schema field key/label variants."""
    field_key = str(field.get("fieldKey", "")).strip()
    label = str(field.get("label", "")).strip()

    candidates: List[str] = []
    for base in [field_key, label]:
        if not base:
            continue
        candidates.extend(
            [
                base,
                base.lower(),
                base.replace("_", " "),
                _norm_col(base),
                _norm_col(base.replace("_", " ")),
            ]
        )

    # Keep order stable while removing duplicates
    seen = set()
    uniq_candidates: List[str] = []
    for c in candidates:
        if c and c not in seen:
            seen.add(c)
            uniq_candidates.append(c)

    # 1) Exact/direct key lookup
    for c in uniq_candidates:
        if c in row and str(row[c]).strip():
            return str(row[c]).strip()

    # 2) Canonicalized key lookup
    canon_index: Dict[str, str] = {}
    for key in row.keys():
        canon = _canon_key(str(key))
        if canon and canon not in canon_index:
            canon_index[canon] = key

    for c in uniq_candidates:
        ck = _canon_key(c)
        if ck and ck in canon_index:
            val = str(row.get(canon_index[ck], "")).strip()
            if val:
                return val

    return ""


def _lookup_header_value(header: Dict[str, str], field: Dict[str, Any]) -> str:
    """Lookup schema field value from extracted header using alias/canonical matching."""
    field_key = str(field.get("fieldKey", "")).strip()
    label = str(field.get("label", "")).strip()

    aliases = [field_key, label]
    alias_map = {
        "contract_id": "contractId",
        "contractid": "contractId",
        "effective_date": "effectiveDate",
        "effectivedate": "effectiveDate",
        "expiration_date": "expirationDate",
        "expirationdate": "expirationDate",
        "carrier": "carrier",
    }

    for a in aliases:
        if not a:
            continue
        k = _canon_key(a)
        mapped = alias_map.get(k)
        if mapped and str(header.get(mapped, "")).strip():
            return str(header.get(mapped, "")).strip()

    return ""


def _pick_section_rows(
    tab_name: str,
    fields: List[Dict[str, Any]],
    rates: List[Dict[str, Any]],
    origin_arbs: List[Dict[str, Any]],
    dest_arbs: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    # Prefer explicit section hints in schema fields
    section_counts: Dict[str, int] = {"RATES": 0, "ORIGIN_ARB": 0, "DEST_ARB": 0}
    for f in fields:
        hint = str(f.get("sectionHint", "")).strip()
        if hint in section_counts:
            section_counts[hint] += 1

    selected = max(section_counts, key=lambda k: section_counts[k])
    if section_counts[selected] > 0:
        if selected == "RATES":
            return rates
        if selected == "ORIGIN_ARB":
            return origin_arbs
        if selected == "DEST_ARB":
            return dest_arbs

    # Fallback: infer from tab name
    name = tab_name.strip().lower()
    if "origin" in name and "arb" in name:
        return origin_arbs
    if ("dest" in name or "destination" in name) and "arb" in name:
        return dest_arbs
    return rates


def _resolve_tab_section(tab_name: str, fields: List[Dict[str, Any]]) -> str:
    """Resolve tab target section from field hints first, then tab name heuristics."""
    def _to_known_section(value: str) -> str:
        raw = str(value or "").strip()
        if not raw:
            return ""
        upper = re.sub(r"[^A-Z0-9]+", "_", raw.upper()).strip("_")
        if upper in ("RATES", "ORIGIN_ARB", "DEST_ARB", "HEADER"):
            return upper

        low = raw.lower()
        if "header" in low:
            return "HEADER"
        if "origin" in low and "arb" in low:
            return "ORIGIN_ARB"
        if ("dest" in low or "destination" in low) and "arb" in low:
            return "DEST_ARB"
        if "rate" in low:
            return "RATES"
        return ""

    section_counts: Dict[str, int] = {
        "RATES": 0,
        "ORIGIN_ARB": 0,
        "DEST_ARB": 0,
        "HEADER": 0,
    }
    for field in fields:
        hint = _to_known_section(str(field.get("sectionHint", "")).strip())
        indicator = _to_known_section(
            str(field.get("sectionIndicatorKey", "")).strip()
        )
        target = hint or indicator
        if target in section_counts:
            section_counts[target] += 1

    selected = max(section_counts, key=lambda key: section_counts[key])
    if section_counts[selected] > 0:
        return selected

    return _to_known_section(tab_name) or "RATES"


def _is_contract_biased_schema(schema_preset: Dict[str, Any]) -> bool:
    mode = str(schema_preset.get("extractionMode", "AUTO") or "AUTO").strip().upper()
    if mode == "CONTRACT_BIASED":
        return True
    if mode == "GENERIC":
        return False

    name = str(schema_preset.get("name", "")).strip().lower()
    if "contract" in name:
        return True

    contract_section_hits = 0
    for tab in schema_preset.get("tabs", []):
        for field in tab.get("fields", []):
            hint = str(field.get("sectionHint", "")).strip().upper()
            if hint in ("RATES", "ORIGIN_ARB", "DEST_ARB"):
                contract_section_hits += 1

    return contract_section_hits >= 2


def _build_record_chunks(
    full_text: str,
    schema_preset: Dict[str, Any],
    fields: List[Dict[str, Any]],
    warnings: List[str],
) -> List[str]:
    pattern = str(schema_preset.get("recordStartRegex", "") or "").strip()
    if pattern:
        try:
            starts = sorted(set(m.start() for m in re.finditer(pattern, full_text, re.IGNORECASE | re.MULTILINE)))
            if len(starts) > 1:
                chunks: List[str] = []
                for idx, start in enumerate(starts):
                    end = starts[idx + 1] if idx + 1 < len(starts) else len(full_text)
                    chunk = full_text[start:end].strip()
                    if chunk:
                        chunks.append(chunk)
                if chunks:
                    return chunks
            elif len(starts) == 1:
                return [full_text[starts[0] :].strip()]
        except re.error as err:
            warnings.append(f"Invalid recordStartRegex '{pattern}': {err}")

    return _build_header_chunks(full_text, fields, warnings)


def _extract_generic_from_schema(
    doc: Any,
    schema_preset: Dict[str, Any],
) -> Tuple[
    List[Dict[str, Any]],
    List[Dict[str, Any]],
    List[Dict[str, Any]],
    List[Dict[str, Any]],
    List[str],
]:
    warnings: List[str] = []
    full_text = "\n".join(doc[i].get_text("text") for i in range(len(doc)))
    pdf_pages = [doc[i].get_text("text") for i in range(len(doc))]

    all_fields: List[Dict[str, Any]] = []
    for tab in schema_preset.get("tabs", []):
        all_fields.extend(tab.get("fields", []))

    record_chunks = _build_record_chunks(full_text, schema_preset, all_fields, warnings)
    tabs_out: List[Dict[str, Any]] = []

    for tab in schema_preset.get("tabs", []):
        tab_name = str(tab.get("name", "Tab")).strip() or "Tab"
        fields = tab.get("fields", [])

        # Header-oriented tabs work per chunk; table-oriented tabs can still use full text.
        uses_header_style = any(
            str(field.get("contextHint", "")).strip()
            in ("same_line_after_label", "next_line_after_label")
            or str(field.get("sectionHint", "")).strip().upper() == "HEADER"
            for field in fields
        )
        chunks = record_chunks if uses_header_style else [full_text]

        tab_rows: List[Dict[str, Any]] = []
        all_labels = [
            str(field.get("contextLabel") or field.get("label") or field.get("fieldKey") or "").strip()
            for field in fields
        ]

        for chunk in chunks:
            row: Dict[str, Any] = {}

            for field in fields:
                field_key = str(field.get("fieldKey", "")).strip()
                if not field_key:
                    continue

                extraction_strategy = str(field.get("extractionStrategy", "regex")).strip()
                context_hint = str(field.get("contextHint", "")).strip()
                label_for_context = str(
                    field.get("contextLabel")
                    or field.get("label")
                    or field.get("fieldKey")
                    or ""
                ).strip()

                value = ""
                used_context_hint = False
                if context_hint in ("same_line_after_label", "next_line_after_label") and label_for_context:
                    value = _extract_by_context_hint(
                        chunk,
                        label_for_context,
                        context_hint,
                        all_labels=all_labels,
                    )
                    used_context_hint = bool(value)

                if not value:
                    if extraction_strategy in ("regex", "header_field", "table_column", "page_region"):
                        value = _extract_field_value(
                            full_text,
                            pdf_pages,
                            field,
                            warnings,
                            search_text_override=chunk,
                        )

                if value and used_context_hint:
                    post_processing = field.get("postProcessing", [])
                    if post_processing:
                        value = _apply_post_processing(
                            value,
                            post_processing,
                            context=row,
                            warnings=warnings,
                            field_key=field_key,
                        )
                    is_valid, value = _validate_extraction(value, field, warnings)
                    if not is_valid:
                        value = ""

                row[field_key] = value

            if any(str(v).strip() for v in row.values()):
                tab_rows.append(row)

        if not tab_rows:
            tab_rows.append({str(field.get("fieldKey", "")).strip(): "" for field in fields if str(field.get("fieldKey", "")).strip()})

        tabs_out.append({"name": tab_name, "rows": tab_rows})

    rates = tabs_out[0]["rows"] if len(tabs_out) > 0 else []
    origin_arbs = tabs_out[1]["rows"] if len(tabs_out) > 1 else []
    dest_arbs = tabs_out[2]["rows"] if len(tabs_out) > 2 else []
    return rates, origin_arbs, dest_arbs, tabs_out, warnings


def extract_tables_from_schema(
    doc: Any, header: Dict[str, str], schema_preset: Dict[str, Any]
) -> Tuple[
    List[Dict[str, Any]],
    List[Dict[str, Any]],
    List[Dict[str, Any]],
    List[Dict[str, Any]],
    List[str],
]:
    """
    Hybrid extraction mode:
    1) Use legacy table extraction (accurate, structure-aware) as primary source.
    2) Project each row into user schema fields dynamically.
    3) Use regex extraction only as fallback per field when row lookup misses.

    Returns (rates, origin_arbs, dest_arbs, tabs_out, warnings).
    """
    if not _is_contract_biased_schema(schema_preset):
        return _extract_generic_from_schema(doc, schema_preset)

    # Contract-biased mode: use legacy parser as dynamic source so schema mode matches hardcoded output behavior.
    legacy_header = _legacy_extract_header(doc)
    rates_src, origin_src, dest_src, legacy_warnings, _raw_pages = _legacy_extract_tables(
        doc,
        legacy_header,
    )
    warnings: List[str] = list(legacy_warnings)

    full_text = "\n".join(doc[i].get_text("text") for i in range(len(doc)))

    # Pre-extract per-page text for page range filtering
    pdf_pages = [doc[i].get_text("text") for i in range(len(doc))]

    tabs_out: List[Dict[str, Any]] = []

    section_rows_map: Dict[str, List[Dict[str, Any]]] = {
        "RATES": [],
        "ORIGIN_ARB": [],
        "DEST_ARB": [],
    }

    for tab in schema_preset.get("tabs", []):
        tab_name = str(tab.get("name", "Tab")).strip() or "Tab"
        fields = tab.get("fields", [])
        tab_section = _resolve_tab_section(tab_name, fields)

        if tab_section == "ORIGIN_ARB":
            section_rows = origin_src
        elif tab_section == "DEST_ARB":
            section_rows = dest_src
        elif tab_section == "HEADER":
            header_chunks = _build_header_chunks(full_text, fields, warnings)
            section_rows = [{"__chunk_text": chunk} for chunk in header_chunks]
        else:
            section_rows = rates_src

        tab_rows: List[Dict[str, Any]] = []

        # Build one output row per source table row (same behavior that made old mode accurate)
        for source_row in section_rows:
            row: Dict[str, Any] = {}

            for field in fields:
                field_key = str(field.get("fieldKey", "")).strip()
                if not field_key:
                    continue

                scoped_text = (
                    str(source_row.get("__chunk_text", ""))
                    if isinstance(source_row, dict)
                    else ""
                )

                value = _lookup_row_value(source_row, field)

                section_hint = str(field.get("sectionHint", "")).strip()
                context_hint = str(field.get("contextHint", "")).strip()
                extraction_strategy = str(field.get("extractionStrategy", "")).strip()
                is_header_like = section_hint == "HEADER" or context_hint in (
                    "same_line_after_label",
                    "next_line_after_label",
                )

                # Header-like fields should prefer legacy header values before regex.
                if not value and is_header_like:
                    value = _lookup_header_value(legacy_header, field)

                if not value and is_header_like:
                    label_for_context = str(
                        field.get("contextLabel")
                        or field.get("label")
                        or field.get("fieldKey")
                        or ""
                    ).strip()
                    all_labels = [
                        str(f.get("contextLabel") or f.get("label") or f.get("fieldKey") or "").strip()
                        for f in fields
                    ]
                    if label_for_context and context_hint in (
                        "same_line_after_label",
                        "next_line_after_label",
                    ):
                        value = _extract_by_context_hint(
                            scoped_text or full_text,
                            label_for_context,
                            context_hint,
                            all_labels=all_labels,
                        )

                # Fallback to regex when mapping misses, but avoid broad text matching
                # for table-cell columns unless strategy explicitly requests regex.
                if not value:
                    if extraction_strategy == "regex" or is_header_like:
                        value = _extract_field_value(
                            full_text,
                            pdf_pages,
                            field,
                            warnings,
                            search_text_override=scoped_text or None,
                        )
                else:
                    # Apply same transformations/validation pipeline for table-mapped values
                    post_processing = field.get("postProcessing", [])
                    if post_processing:
                        context = {**source_row, **row}
                        value = _apply_post_processing(
                            value,
                            post_processing,
                            context=context,
                            warnings=warnings,
                            field_key=field_key,
                        )
                    is_valid, value = _validate_extraction(value, field, warnings)
                    if not is_valid:
                        value = ""

                row[field_key] = value

            tab_rows.append(row)

        # If source section is empty, still output one regex-derived row as fallback
        if not tab_rows:
            fallback_row: Dict[str, Any] = {}
            for field in fields:
                field_key = str(field.get("fieldKey", "")).strip()
                if not field_key:
                    continue

                section_hint = str(field.get("sectionHint", "")).strip()
                context_hint = str(field.get("contextHint", "")).strip()
                extraction_strategy = str(field.get("extractionStrategy", "")).strip()
                is_header_like = section_hint == "HEADER" or context_hint in (
                    "same_line_after_label",
                    "next_line_after_label",
                )

                value = ""
                if is_header_like:
                    value = _lookup_header_value(legacy_header, field)
                if not value and (extraction_strategy == "regex" or is_header_like):
                    value = _extract_field_value(full_text, pdf_pages, field, warnings)

                fallback_row[field_key] = value
            tab_rows.append(fallback_row)

        tabs_out.append({"name": tab_name, "rows": tab_rows})

        if tab_section in section_rows_map and not section_rows_map[tab_section]:
            section_rows_map[tab_section] = tab_rows

    rates = section_rows_map["RATES"]
    origin_arbs = section_rows_map["ORIGIN_ARB"]
    dest_arbs = section_rows_map["DEST_ARB"]
    return rates, origin_arbs, dest_arbs, tabs_out, warnings


# ─── Legacy hardcoded fallback (used when no schema is assigned) ────────────

LEGACY_RATES_COLS = [
    "Carrier",
    "Contract ID",
    "effective_date",
    "expiration_date",
    "commodity",
    "origin_city",
    "origin_via_city",
    "destination_city",
    "destination_via_city",
    "service",
    "Remarks",
    "SCOPE",
    "BaseRate 20",
    "BaseRate 40",
    "BaseRate 40H",
    "BaseRate 45",
    "AMS(CHINA & JAPAN)",
    "(HEA) Heavy Surcharge",
    "AGW",
    "RED SEA DIVERSION CHARGE(RDS).",
]

LEGACY_ORIGIN_ARB_COLS = [
    "Carrier",
    "Contract ID",
    "effective_date",
    "expiration_date",
    "commodity",
    "origin_city",
    "origin_via_city",
    "service",
    "Remarks",
    "Scope",
    "BaseRate 20",
    "BaseRate 40",
    "BaseRate 40H",
    "BaseRate 45",
    "20' AGW",
    "40' AGW",
    "45' AGW",
]

LEGACY_DEST_ARB_COLS = [
    "Carrier",
    "Contract ID",
    "effective_date",
    "expiration_date",
    "commodity",
    "destination_city",
    "destination_via_city",
    "service",
    "Remarks",
    "Scope",
    "BaseRate 20",
    "BaseRate 40",
    "BaseRate 40H",
    "BaseRate 45",
]


def _legacy_blank_row(cols: List[str]) -> Dict[str, str]:
    return {col: "" for col in cols}


def _legacy_clean_text(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def _legacy_to_iso_date(value: str) -> str:
    value = _legacy_clean_text(value)
    for fmt in (
        "%d/%m/%Y",
        "%d-%m-%Y",
        "%m/%d/%Y",
        "%m-%d-%Y",
        "%Y-%m-%d",
        "%Y%m%d",
        "%d %b, %Y",
        "%d %B, %Y",
        "%d %b %Y",
        "%d %B %Y",
    ):
        try:
            return datetime.strptime(value, fmt).strftime("%Y-%m-%d")
        except Exception:
            pass
    return value


def _legacy_city_only(value: str) -> str:
    value = _legacy_clean_text(value)
    if not value:
        return ""
    return _legacy_clean_text(value.split(",", 1)[0]).title()


def _legacy_preserve_city(value: str) -> str:
    return _legacy_clean_text(value).title()


def _legacy_short_commodity(value: str) -> str:
    value = _legacy_clean_text(value)
    if not value:
        return ""
    value = re.split(r"\bEXCLUDING\b", value, maxsplit=1, flags=re.IGNORECASE)[0]
    value = value.split("(", 1)[0]
    if re.search(r"\band/or\b", value, re.IGNORECASE):
        left = re.split(r"\band/or\b", value, maxsplit=1, flags=re.IGNORECASE)[0]
        if " - " in left:
            value = left
    return _legacy_clean_text(value.rstrip(":;,.- "))


LEGACY_SECTION_PATTERNS: List[Tuple[re.Pattern, str]] = [
    (re.compile(r"6\s*[-.]\s*1|general\s+rate", re.IGNORECASE), "RATES"),
    (re.compile(r"6\s*[-.]\s*3|origin\s+arbitrary", re.IGNORECASE), "ORIGIN_ARB"),
    (re.compile(r"6\s*[-.]\s*4|destination\s+arbitrary", re.IGNORECASE), "DEST_ARB"),
    (re.compile(r"6\s*[-.]\s*5|g\.?o\.?h", re.IGNORECASE), "STOP"),
]

LEGACY_CONTRACT_ID_RE = re.compile(r"\bATL\w+\b", re.IGNORECASE)
LEGACY_COMMODITY_RE = re.compile(r"COMMODITY\s*:\s*(.+)", re.IGNORECASE)
LEGACY_ORIGIN_RE = re.compile(r"\bORIGIN\s*:\s*(.+)", re.IGNORECASE)
LEGACY_ORIGIN_VIA_RE = re.compile(r"\bORIGIN\s+VIA\s*:\s*(.+)", re.IGNORECASE)
LEGACY_RATE_OVER_RE = re.compile(r"RATE\s+APPLICABLE\s+OVER\s*:\s*(.+)", re.IGNORECASE)
LEGACY_SCOPE_RE = re.compile(r"\[([^\]]*\(WB\)[^\]]*)\]", re.IGNORECASE)
LEGACY_DATE_TOKEN_RE = re.compile(
    r"(\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}-\d{2}-\d{2}|\d{8}|\d{1,2}\s+[A-Za-z]{3,9},?\s+\d{4})"
)
LEGACY_VALID_RANGE_RE = re.compile(
    r"valid\s*(?:from)?\s*(\d{4}-\d{2}-\d{2}|\d{8}|\d{1,2}\s+[A-Za-z]{3,9},?\s+\d{4})\s*(?:to|through|thru)\s*(\d{4}-\d{2}-\d{2}|\d{8}|\d{1,2}\s+[A-Za-z]{3,9},?\s+\d{4})",
    re.IGNORECASE,
)
LEGACY_EFFECTIVE_RE = re.compile(r"effective\s+date\s*[:\-]?\s*([^\n\r]+)", re.IGNORECASE)
LEGACY_EXPIRATION_RE = re.compile(r"expir(?:ation|y)\s+date\s*[:\-]?\s*([^\n\r]+)", re.IGNORECASE)


LEGACY_HEADER_MAP = {
    "destination": "destination_city",
    "destination city": "destination_city",
    "destination via": "destination_via_city",
    "destination via city": "destination_via_city",
    "point": "point",
    "via": "via",
    "cntry": "cntry",
    "term": "term",
    "type": "type",
    "cur": "cur",
    "service": "service",
    "lane": "lane",
    "trunk lane": "trunk_lane",
    "mode": "mode",
    "box": "box",
    "cmdt": "cmdt",
    "note": "note",
    "direct call": "direct_call",
    "20'": "rate20",
    "40'": "rate40",
    "40hc": "rate40h",
    "45'": "rate45",
    "20' agw": "agw20",
    "40' agw": "agw40",
    "45' agw": "agw45",
}


def _legacy_normalize_header(cell: str) -> str:
    clean = _legacy_clean_text(cell).lower().replace("_", " ")
    clean = clean.replace("\n", " ")
    clean = re.sub(r"\s+", " ", clean)
    return LEGACY_HEADER_MAP.get(clean, clean)


def _legacy_dedupe_headers(headers: List[str]) -> List[str]:
    out: List[str] = []
    seen: Dict[str, int] = {}
    for header in headers:
        key = _legacy_normalize_header(header)
        count = seen.get(key, 0) + 1
        seen[key] = count
        out.append(key if count == 1 else f"{key}_{count}")
    return out


def _legacy_row_dict(headers: List[str], cells: List[str]) -> Dict[str, str]:
    row: Dict[str, str] = {}
    for idx, header in enumerate(headers):
        row[header] = _legacy_clean_text(cells[idx] if idx < len(cells) else "")
    return row


def _legacy_is_blank_row(cells: List[str]) -> bool:
    return not any(_legacy_clean_text(cell) for cell in cells)


def _legacy_is_header_row(cells: List[str]) -> bool:
    first = _legacy_clean_text(cells[0] if cells else "").lower()
    return first.startswith("destination") or first.startswith("point")


def _legacy_has_numbers(value: str) -> bool:
    return bool(re.search(r"\d", _legacy_clean_text(value)))


def _legacy_continuation_row(section: str, row: Dict[str, str]) -> bool:
    anchor = row.get("destination_city", "") if section == "RATES" else row.get("point", "")
    if _legacy_clean_text(anchor):
        return False
    return any(_legacy_clean_text(v) for v in row.values())


def _legacy_merge_row(base: Dict[str, str], cont: Dict[str, str]) -> None:
    for key, value in cont.items():
        value = _legacy_clean_text(value)
        if not value:
            continue
        current = _legacy_clean_text(base.get(key, ""))
        if not current:
            base[key] = value
        elif value not in current:
            base[key] = _legacy_clean_text(f"{current} {value}")


def _legacy_build_boundaries(doc: Any) -> List[Tuple[int, float, str]]:
    found: List[Tuple[int, float, str]] = []
    seen = set()
    for page_no in range(len(doc)):
        page = doc[page_no]
        try:
            page_dict = page.get_text("dict")
        except Exception:
            continue
        for block in page_dict.get("blocks", []):
            if block.get("type") != 0:
                continue
            text = " ".join(
                span["text"]
                for line in block.get("lines", [])
                for span in line.get("spans", [])
            )
            for pattern, section in LEGACY_SECTION_PATTERNS:
                if section not in seen and pattern.search(text):
                    found.append((page_no, float(block["bbox"][1]), section))
                    seen.add(section)
                    break
    found.sort(key=lambda item: (item[0], item[1]))
    return found


def _legacy_section_for(
    page_no: int, y0: float, boundaries: List[Tuple[int, float, str]]
) -> str:
    pos = page_no * 1_000_000.0 + y0
    current = "UNKNOWN"
    for b_page, b_y, section in boundaries:
        if b_page * 1_000_000.0 + b_y <= pos:
            current = section
        else:
            break
    return current


def _legacy_scan_inline_labels(page: Any) -> List[Tuple[float, str, str]]:
    lines: List[Tuple[float, str]] = []
    for block in page.get_text("dict").get("blocks", []):
        if block.get("type") != 0:
            continue
        for line in block.get("lines", []):
            y0 = float(line["bbox"][1])
            text = _legacy_clean_text(" ".join(span["text"] for span in line.get("spans", [])))
            if text:
                lines.append((y0, text))
    lines.sort(key=lambda item: item[0])

    found: List[Tuple[float, str, str]] = []
    i = 0
    while i < len(lines):
        y0, text = lines[i]

        m = re.match(r"ORIGIN\s+VIA\s*:\s*(.+)", text, re.IGNORECASE)
        if m:
            found.append((y0, "origin_via", _legacy_city_only(m.group(1))))
            i += 1
            continue

        if re.fullmatch(r"ORIGIN\s+VIA", text, re.IGNORECASE):
            j = i + 1
            while j < len(lines) and re.fullmatch(r"[:\s]*", lines[j][1]):
                j += 1
            if j < len(lines) and lines[j][1].strip():
                found.append((y0, "origin_via", _legacy_city_only(lines[j][1])))
                i = j + 1
                continue

        m = re.match(r"ORIGIN(?!\s+VIA)\s*:\s*(.+)", text, re.IGNORECASE)
        if m:
            found.append((y0, "origin", _legacy_city_only(m.group(1))))
            i += 1
            continue

        if re.fullmatch(r"ORIGIN", text, re.IGNORECASE):
            j = i + 1
            while j < len(lines) and re.fullmatch(r"[:\s]*", lines[j][1]):
                j += 1
            if j < len(lines) and lines[j][1].strip():
                found.append((y0, "origin", _legacy_city_only(lines[j][1])))
                i = j + 1
                continue

        m = re.match(r"RATE\s+APPLICABLE\s+OVER\s*:\s*(.+)", text, re.IGNORECASE)
        if m:
            found.append((y0, "rate_over", _legacy_city_only(m.group(1))))
            i += 1
            continue

        if re.fullmatch(r"RATE\s+APPLICABLE\s+OVER", text, re.IGNORECASE):
            j = i + 1
            while j < len(lines) and re.fullmatch(r"[:\s]*", lines[j][1]):
                j += 1
            if j < len(lines) and lines[j][1].strip():
                found.append((y0, "rate_over", _legacy_city_only(lines[j][1])))
                i = j + 1
                continue

        i += 1

    return found


def _legacy_parse_date_pairs(text: str) -> List[Tuple[str, str]]:
    pairs: List[Tuple[str, str]] = []
    for start, end in LEGACY_VALID_RANGE_RE.findall(text):
        pair = (_legacy_to_iso_date(start), _legacy_to_iso_date(end))
        if pair not in pairs:
            pairs.append(pair)
    return pairs


def _legacy_parse_scope_bracketed(text: str) -> str:
    match = LEGACY_SCOPE_RE.search(text)
    return f"[{_legacy_clean_text(match.group(1))}]" if match else ""


def _legacy_parse_scope_unbracketed(text: str) -> str:
    match = LEGACY_SCOPE_RE.search(text)
    return _legacy_clean_text(match.group(1)) if match else ""


def _legacy_extract_header(doc: Any) -> Dict[str, str]:
    texts = [doc[i].get_text("text") for i in range(min(len(doc), 12))]
    text = "\n".join(texts)

    contract_id = ""
    match = LEGACY_CONTRACT_ID_RE.search(text)
    if match:
        contract_id = match.group(0).upper()

    pairs = _legacy_parse_date_pairs("\n".join(doc[i].get_text("text") for i in range(len(doc))))
    if not pairs:
        effs = [
            _legacy_to_iso_date(LEGACY_DATE_TOKEN_RE.search(m.group(1)).group(1))
            for m in LEGACY_EFFECTIVE_RE.finditer(text)
            if LEGACY_DATE_TOKEN_RE.search(m.group(1))
        ]
        exps = [
            _legacy_to_iso_date(LEGACY_DATE_TOKEN_RE.search(m.group(1)).group(1))
            for m in LEGACY_EXPIRATION_RE.finditer(text)
            if LEGACY_DATE_TOKEN_RE.search(m.group(1))
        ]
        for idx in range(max(len(effs), len(exps))):
            eff = effs[idx] if idx < len(effs) else ""
            exp = exps[idx] if idx < len(exps) else ""
            if eff and exp:
                pairs.append((eff, exp))

    effective_date, expiration_date = pairs[0] if pairs else ("", "")
    return {
        "carrier": "OLTEK",
        "contractId": contract_id,
        "effectiveDate": effective_date,
        "expirationDate": expiration_date,
    }


def _legacy_agw_values(origin_city: str) -> Tuple[str, str, str]:
    city = _legacy_clean_text(origin_city).lower()
    if city in {"halifax", "vancouver", "montreal"}:
        return ("525", "500", "500")
    if city in {"chicago", "pocatello"}:
        return ("200", "400", "400")
    if city in {"baltimore", "richmond"}:
        return ("", "", "")
    return ("230", "230", "230")


def _legacy_build_rates_row(
    header: Dict[str, str],
    dates: Tuple[str, str],
    commodity: str,
    origin_city: str,
    origin_via_city: str,
    scope: str,
    row: Dict[str, str],
) -> Dict[str, str]:
    out = _legacy_blank_row(LEGACY_RATES_COLS)
    out["Carrier"] = header["carrier"]
    out["Contract ID"] = header["contractId"]
    out["effective_date"] = dates[0]
    out["expiration_date"] = dates[1]
    out["commodity"] = commodity
    out["origin_city"] = origin_city
    out["origin_via_city"] = origin_via_city
    out["destination_city"] = _legacy_city_only(row.get("destination_city", ""))
    out["destination_via_city"] = _legacy_city_only(row.get("destination_via_city", ""))
    out["service"] = "CY/CY"
    out["SCOPE"] = scope
    out["BaseRate 20"] = row.get("rate20", "")
    out["BaseRate 40"] = row.get("rate40", "")
    out["BaseRate 40H"] = row.get("rate40h", "")
    out["BaseRate 45"] = row.get("rate45", "")
    if _legacy_clean_text(row.get("direct_call", "")):
        out["Remarks"] = "!must be direct call at destination"

    country = _legacy_clean_text(row.get("cntry", "")).upper()
    if scope == "NORTH AMERICA - ASIA (WB)" and country in {"CN", "JP"}:
        out["AMS(CHINA & JAPAN)"] = "35"

    row_blob = " ".join(row.values()).lower()
    if "hea" in row_blob and "included" in row_blob:
        out["(HEA) Heavy Surcharge"] = "included"
    if re.search(r"\bagw\b", row_blob) and "included" in row_blob:
        out["AGW"] = "included"
    if scope == "NORTH AMERICA - WEST ASIA AND AFRICA (WB)":
        out["RED SEA DIVERSION CHARGE(RDS)."] = "included"

    return out


def _legacy_build_origin_arb_row(
    header: Dict[str, str],
    dates: Tuple[str, str],
    scope: str,
    rate_over_city: str,
    row: Dict[str, str],
) -> Dict[str, str]:
    out = _legacy_blank_row(LEGACY_ORIGIN_ARB_COLS)
    out["Carrier"] = header["carrier"]
    out["Contract ID"] = header["contractId"]
    out["effective_date"] = dates[0]
    out["expiration_date"] = dates[1]
    out["origin_city"] = _legacy_city_only(row.get("point", ""))
    out["origin_via_city"] = rate_over_city
    out["service"] = "CY"
    out["Scope"] = scope
    out["BaseRate 20"] = row.get("rate20", "")
    out["BaseRate 40"] = row.get("rate40", "")
    out["BaseRate 40H"] = row.get("rate40h", "")
    out["BaseRate 45"] = row.get("rate45", "")
    out["20' AGW"], out["40' AGW"], out["45' AGW"] = _legacy_agw_values(out["origin_city"])
    return out


def _legacy_build_dest_arb_row(
    header: Dict[str, str],
    dates: Tuple[str, str],
    scope: str,
    rate_over_city: str,
    row: Dict[str, str],
) -> Dict[str, str]:
    out = _legacy_blank_row(LEGACY_DEST_ARB_COLS)
    out["Carrier"] = header["carrier"]
    out["Contract ID"] = header["contractId"]
    out["effective_date"] = dates[0]
    out["expiration_date"] = dates[1]
    out["destination_city"] = _legacy_preserve_city(row.get("point", ""))
    out["destination_via_city"] = rate_over_city
    out["service"] = "CY"
    out["Scope"] = scope
    out["BaseRate 20"] = row.get("rate20", "")
    out["BaseRate 40"] = row.get("rate40", "")
    out["BaseRate 40H"] = row.get("rate40h", "")
    out["BaseRate 45"] = row.get("rate45", "")
    return out


def _legacy_extract_tables(
    doc: Any,
    header: Dict[str, str],
) -> Tuple[
    List[Dict[str, str]],
    List[Dict[str, str]],
    List[Dict[str, str]],
    List[str],
    List[Dict[str, Any]],
]:
    rates: List[Dict[str, str]] = []
    origin_arbs: List[Dict[str, str]] = []
    dest_arbs: List[Dict[str, str]] = []
    warnings: List[str] = []
    raw_pages: List[Dict[str, Any]] = []

    boundaries = _legacy_build_boundaries(doc)
    if not boundaries:
        warnings.append("No section boundaries found; defaulting tables to RATES")
        boundaries = [(0, 0.0, "RATES")]

    section_headers: Dict[str, List[str]] = {"RATES": [], "ORIGIN_ARB": [], "DEST_ARB": []}
    previous_output: Dict[str, Optional[Dict[str, str]]] = {
        "RATES": None,
        "ORIGIN_ARB": None,
        "DEST_ARB": None,
    }

    current_commodity = ""
    current_origin = ""
    current_origin_via = ""
    current_scope_rates = ""
    current_scope_arb = ""
    current_rate_over = ""
    current_dates = (header["effectiveDate"], header["expirationDate"])

    for page_no in range(len(doc)):
        page = doc[page_no]
        page_text = doc[page_no].get_text("text")
        raw_pages.append({"page": page_no + 1, "text": page_text})

        commodity_match = LEGACY_COMMODITY_RE.search(page_text)
        if commodity_match:
            current_commodity = _legacy_short_commodity(commodity_match.group(1))

        origin_match = LEGACY_ORIGIN_RE.search(page_text)
        page_origin_hint = _legacy_city_only(origin_match.group(1)) if origin_match else ""

        origin_via_match = LEGACY_ORIGIN_VIA_RE.search(page_text)
        page_origin_via_hint = (
            _legacy_city_only(origin_via_match.group(1)) if origin_via_match else ""
        )

        scope_match = _legacy_parse_scope_unbracketed(page_text)
        if scope_match:
            current_scope_rates = scope_match
        scope_arb_match = _legacy_parse_scope_bracketed(page_text)
        if scope_arb_match:
            current_scope_arb = scope_arb_match

        rate_over_match = LEGACY_RATE_OVER_RE.search(page_text)
        page_rate_over_hint = (
            _legacy_city_only(rate_over_match.group(1)) if rate_over_match else ""
        )

        pairs = _legacy_parse_date_pairs(page_text)
        if pairs:
            current_dates = pairs[-1]

        inline_labels = _legacy_scan_inline_labels(page)

        try:
            with _FitzStdoutGuard():
                table_finder = page.find_tables(strategy="lines_strict")
                found_tables = (
                    table_finder.tables if hasattr(table_finder, "tables") else list(table_finder)
                )
                if not found_tables:
                    table_finder = page.find_tables(strategy="lines")
                    found_tables = (
                        table_finder.tables if hasattr(table_finder, "tables") else list(table_finder)
                    )
        except Exception as exc:
            warnings.append(f"Page {page_no + 1}: find_tables() failed - {exc}")
            continue

        for table in found_tables:
            raw_rows = table.extract()
            if not raw_rows or len(raw_rows) < 2:
                continue

            table_y0 = float(table.bbox[1]) if hasattr(table, "bbox") else 0.0
            section = _legacy_section_for(page_no, table_y0, boundaries)
            if section in ("UNKNOWN", "STOP"):
                continue

            table_origin = current_origin
            table_origin_via = current_origin_via
            table_rate_over = current_rate_over
            for label_y, label_type, label_value in inline_labels:
                if label_y < table_y0:
                    if label_type == "origin":
                        table_origin = label_value
                    elif label_type == "origin_via":
                        table_origin_via = label_value
                    elif label_type == "rate_over":
                        table_rate_over = label_value

            rows = [[_legacy_clean_text(cell) for cell in row] for row in raw_rows]
            rows = [row for row in rows if not _legacy_is_blank_row(row)]
            if not rows:
                continue

            if _legacy_is_header_row(rows[0]):
                headers = _legacy_dedupe_headers(rows[0])
                section_headers[section] = headers
                rows = rows[1:]
            else:
                headers = section_headers.get(section, [])
                if not headers:
                    warnings.append(
                        f"Page {page_no + 1}: skipped continuation table in {section} with no prior headers"
                    )
                    continue

            for cells in rows:
                if _legacy_is_blank_row(cells) or _legacy_is_header_row(cells):
                    continue

                parsed_row = _legacy_row_dict(headers, cells)
                if _legacy_continuation_row(section, parsed_row) and previous_output[section] is not None:
                    _legacy_merge_row(previous_output[section], parsed_row)
                    continue

                if section == "RATES":
                    out = _legacy_build_rates_row(
                        header,
                        current_dates,
                        current_commodity,
                        table_origin,
                        table_origin_via,
                        current_scope_rates,
                        parsed_row,
                    )
                    if any(
                        _legacy_has_numbers(out[k])
                        for k in ("BaseRate 20", "BaseRate 40", "BaseRate 40H", "BaseRate 45")
                    ):
                        rates.append(out)
                        previous_output[section] = out
                elif section == "ORIGIN_ARB":
                    out = _legacy_build_origin_arb_row(
                        header,
                        current_dates,
                        current_scope_arb,
                        table_rate_over,
                        parsed_row,
                    )
                    if out["origin_city"]:
                        origin_arbs.append(out)
                        previous_output[section] = out
                elif section == "DEST_ARB":
                    out = _legacy_build_dest_arb_row(
                        header,
                        current_dates,
                        current_scope_arb,
                        table_rate_over,
                        parsed_row,
                    )
                    if out["destination_city"]:
                        dest_arbs.append(out)
                        previous_output[section] = out

        # Update carry-forward context after processing tables on this page.
        # This keeps continuation tables at the top of a page from inheriting
        # labels that appear lower on the same page.
        has_inline_origin = False
        has_inline_origin_via = False
        has_inline_rate_over = False
        for _, label_type, label_value in inline_labels:
            if label_type == "origin":
                current_origin = label_value
                has_inline_origin = True
            elif label_type == "origin_via":
                current_origin_via = label_value
                has_inline_origin_via = True
            elif label_type == "rate_over":
                current_rate_over = label_value
                has_inline_rate_over = True

        # Fallback to page-level regex if inline scan missed a label type.
        if page_origin_hint and not has_inline_origin:
            current_origin = page_origin_hint
        if page_origin_via_hint and not has_inline_origin_via:
            current_origin_via = page_origin_via_hint
        if page_rate_over_hint and not has_inline_rate_over:
            current_rate_over = page_rate_over_hint

    end_rates = _legacy_blank_row(LEGACY_RATES_COLS)
    end_rates["Carrier"] = "DOC END"
    rates.append(end_rates)

    end_origin = _legacy_blank_row(LEGACY_ORIGIN_ARB_COLS)
    end_origin["Carrier"] = "DOC END"
    origin_arbs.append(end_origin)

    end_dest = _legacy_blank_row(LEGACY_DEST_ARB_COLS)
    end_dest["Carrier"] = "DOC END"
    dest_arbs.append(end_dest)

    return rates, origin_arbs, dest_arbs, warnings, raw_pages


# ─── Entry point ──────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Extract freight contract tables from a PDF")
    parser.add_argument("--pdf", required=True, help="Absolute path to the PDF file")
    args = parser.parse_args()

    start = time.time()
    warnings: List[str] = []

    try:
        doc = open_pdf_document(args.pdf)
    except Exception as e:
        print(json.dumps({"error": f"Failed to open PDF: {e}"}))
        sys.stdout.flush()
        sys.exit(1)

    page_count = len(doc)

    try:
        # Legacy-only path: keep this script focused on standard hardcoded extraction.
        header = _legacy_extract_header(doc)
        rates, origin_arbs, dest_arbs, tbl_warnings, raw_pages = _legacy_extract_tables(
            doc,
            header,
        )
        tabs_out = [
            {"name": "Rates", "rows": rates},
            {"name": "Origin Arbitraries", "rows": origin_arbs},
            {"name": "Destination Arbitraries", "rows": dest_arbs},
        ]

        warnings.extend(tbl_warnings)
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
        "tabs":          tabs_out,
        "rawPages":      raw_pages,
        "pageCount":     page_count,
        "processingTime": elapsed,
        "warnings":      warnings,
    }

    print(json.dumps(result, ensure_ascii=False))
    sys.stdout.flush()


if __name__ == "__main__":
    main()
