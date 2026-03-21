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
from typing import Any, Dict, List, Optional, Tuple

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
            if section_hint in ("RATES", "ORIGIN_ARB", "DEST_ARB", "HEADER"):
                field_obj["sectionHint"] = section_hint

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

    return {"name": name, "tabs": tabs}


def _apply_post_processing(value: str, rules: List[str]) -> str:
    """Apply a sequence of post-processing transformations to a value."""
    result = value
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
    full_text: str, pdf_pages: List[str], field: Dict[str, Any], warnings: List[str]
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
    search_text = full_text
    if page_range:
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
        value = _apply_post_processing(value, post_processing)

    # ── Step 5: Validate against constraints ─────────────────────────────────
    is_valid, value = _validate_extraction(value, field, warnings)
    if not is_valid:
        if field.get("mandatory"):
            warnings.append(f"Field '{field_key}' failed validation; expected format: {field.get('expectedFormat', 'N/A')}")
        return ""

    return value.strip()


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


def extract_tables_from_schema(
    doc: fitz.Document, header: Dict[str, str], schema_preset: Dict[str, Any]
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
    # Keep legacy extraction as primary source of truth for row accuracy
    rates_src, origin_src, dest_src, legacy_warnings = extract_tables(doc, header)
    warnings: List[str] = list(legacy_warnings)

    full_text = "\n".join(doc[i].get_text("text") for i in range(len(doc)))

    # Pre-extract per-page text for page range filtering
    pdf_pages = [doc[i].get_text("text") for i in range(len(doc))]

    tabs_out: List[Dict[str, Any]] = []

    for tab in schema_preset.get("tabs", []):
        tab_name = str(tab.get("name", "Tab")).strip() or "Tab"
        fields = tab.get("fields", [])
        section_rows = _pick_section_rows(tab_name, fields, rates_src, origin_src, dest_src)
        tab_rows: List[Dict[str, Any]] = []

        # Build one output row per source table row (same behavior that made old mode accurate)
        for source_row in section_rows:
            row: Dict[str, Any] = {}

            for field in fields:
                field_key = str(field.get("fieldKey", "")).strip()
                if not field_key:
                    continue

                value = _lookup_row_value(source_row, field)

                section_hint = str(field.get("sectionHint", "")).strip()
                context_hint = str(field.get("contextHint", "")).strip()
                extraction_strategy = str(field.get("extractionStrategy", "")).strip()
                is_header_like = section_hint == "HEADER" or context_hint in (
                    "same_line_after_label",
                    "next_line_after_label",
                )

                # Header-like fields should prefer header extraction before regex.
                if not value and is_header_like:
                    value = _lookup_header_value(header, field)

                # Fallback to regex when mapping misses, but avoid broad text matching
                # for table-cell columns unless strategy explicitly requests regex.
                if not value:
                    if extraction_strategy == "regex" or is_header_like:
                        value = _extract_field_value(full_text, pdf_pages, field, warnings)
                else:
                    # Apply same transformations/validation pipeline for table-mapped values
                    post_processing = field.get("postProcessing", [])
                    if post_processing:
                        value = _apply_post_processing(value, post_processing)
                    is_valid, value = _validate_extraction(value, field, warnings)
                    if not is_valid:
                        value = ""

                row[field_key] = value

            # Always add header data to every row
            row["carrier"] = header.get("carrier", "")
            row["contractId"] = header.get("contractId", "")
            row["effectiveDate"] = header.get("effectiveDate", "")
            row["expirationDate"] = header.get("expirationDate", "")

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
                    value = _lookup_header_value(header, field)
                if not value and (extraction_strategy == "regex" or is_header_like):
                    value = _extract_field_value(full_text, pdf_pages, field, warnings)

                fallback_row[field_key] = value

            fallback_row["carrier"] = header.get("carrier", "")
            fallback_row["contractId"] = header.get("contractId", "")
            fallback_row["effectiveDate"] = header.get("effectiveDate", "")
            fallback_row["expirationDate"] = header.get("expirationDate", "")
            tab_rows.append(fallback_row)

        tabs_out.append({"name": tab_name, "rows": tab_rows})

    rates = tabs_out[0]["rows"] if len(tabs_out) > 0 else []
    origin_arbs = tabs_out[1]["rows"] if len(tabs_out) > 1 else []
    dest_arbs = tabs_out[2]["rows"] if len(tabs_out) > 2 else []
    return rates, origin_arbs, dest_arbs, tabs_out, warnings


# ─── Entry point ──────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Extract freight contract tables from a PDF")
    parser.add_argument("--pdf", required=True, help="Absolute path to the PDF file")
    parser.add_argument(
        "--schema-json",
        required=False,
        default="",
        help="Optional JSON array of schema fields with regex rules",
    )
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
        tabs_out: List[Dict[str, Any]] = []
        schema_preset = _parse_schema_preset(args.schema_json, warnings)

        if schema_preset:
            rates, origin_arbs, dest_arbs, tabs_out, tbl_warnings = extract_tables_from_schema(
                doc, header, schema_preset
            )
        else:
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
