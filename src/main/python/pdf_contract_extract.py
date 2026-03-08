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


# ─── Section classifier ────────────────────────────────────────────────────────

# Keywords that appear in bold section-header text just above each table block
_RATES_KW      = re.compile(r"\brates?\b", re.IGNORECASE)
_ORIGIN_KW     = re.compile(r"origin\s+arbitrar", re.IGNORECASE)
_DEST_KW       = re.compile(r"destination\s+arbitrar", re.IGNORECASE)

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


# ─── Table section classification ─────────────────────────────────────────────

def _classify_section(page: fitz.Page, table_rect: Any, warnings: list) -> str:
    """
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

    if _DEST_KW.search(above_text):
        return "DEST_ARB"
    if _ORIGIN_KW.search(above_text):
        return "ORIGIN_ARB"
    if _RATES_KW.search(above_text):
        return "RATES"

    # Fallback: inspect the table's own header row for distinctive columns
    return "UNKNOWN"


def _infer_section_from_headers(col_keys: List[str]) -> str:
    """Infer section from column names when positional classification fails."""
    keys = set(col_keys)
    if "originCity" in keys and "destinationCity" in keys:
        return "DEST_ARB"
    if "originCity" in keys:
        return "ORIGIN_ARB"
    if "destinationCity" in keys:
        return "RATES"
    return "UNKNOWN"


# ─── Core extraction ──────────────────────────────────────────────────────────

def extract_tables(doc: fitz.Document, header: Dict) -> Tuple[List, List, List, List]:
    """
    Iterate every page, find tables, classify them, and return
    (rates, origin_arbs, dest_arbs, warnings).
    """
    rates: List[Dict[str, Any]] = []
    origin_arbs: List[Dict[str, Any]] = []
    dest_arbs: List[Dict[str, Any]] = []
    warnings: List[str] = []

    # Track current section across pages (tables can span pages with no repeating header)
    current_section = "UNKNOWN"

    for page_no in range(len(doc)):
        page = doc[page_no]

        try:
            with _FitzStdoutGuard():
                found_tables = page.find_tables()
        except Exception as e:
            warnings.append(f"Page {page_no + 1}: find_tables() failed — {e}")
            continue

        for tbl in found_tables:
            raw_rows = tbl.extract()  # list of list of str|None
            if not raw_rows or len(raw_rows) < 2:
                continue

            # Determine if the first row is a header row
            # Heuristic: header cells are non-numeric strings
            first_row = [str(c or "").strip() for c in raw_rows[0]]
            is_header_row = any(
                re.search(r"[a-zA-Z]{3,}", cell) for cell in first_row
            )

            if is_header_row:
                col_keys = [_norm_col(c) for c in first_row]
                data_rows = raw_rows[1:]
                # Re-classify section from this table's header
                section = _classify_section(page, tbl.bbox, warnings)
                if section == "UNKNOWN":
                    section = _infer_section_from_headers(col_keys)
                if section != "UNKNOWN":
                    current_section = section
            else:
                # Continuation table — reuse last known column mapping
                col_keys = []
                data_rows = raw_rows

            if not col_keys:
                warnings.append(f"Page {page_no + 1}: no column headers found, skipping table")
                continue

            section_to_use = current_section if current_section != "UNKNOWN" else "RATES"

            for raw_row in data_rows:
                cells = [str(c or "").strip() for c in raw_row]
                # Skip blank rows
                if not any(cells):
                    continue
                # Build row dict, padding or trimming to col_keys length
                row: dict[str, Any] = {}
                for i, key in enumerate(col_keys):
                    row[key] = cells[i] if i < len(cells) else ""

                # Stamp header fields
                row["carrier"]         = header["carrier"]
                row["contractId"]      = header["contractId"]
                row["effectiveDate"]   = header["effectiveDate"]
                row["expirationDate"]  = header["expirationDate"]

                if section_to_use == "RATES":
                    rates.append(row)
                elif section_to_use == "ORIGIN_ARB":
                    origin_arbs.append(row)
                elif section_to_use == "DEST_ARB":
                    dest_arbs.append(row)

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

    try:
        header = extract_header(doc)
        rates, origin_arbs, dest_arbs, tbl_warnings = extract_tables(doc, header)
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
        "pageCount":     len(rates) + len(origin_arbs) + len(dest_arbs),
        "processingTime": elapsed,
        "warnings":      warnings,
    }

    print(json.dumps(result, ensure_ascii=False))
    sys.stdout.flush()


if __name__ == "__main__":
    main()
