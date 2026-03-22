"""
pdf_contract_extract.py
-----------------------
Fast PyMuPDF-only extractor for shipping service contracts.

It emits three prompt-aligned sheet payloads:
- rates
- originArbs
- destArbs

Each row uses the exact column headers expected by the Excel template.
"""

from __future__ import annotations

import argparse
import io
import json
import re
import sys
import time
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

if hasattr(sys.stdout, "buffer"):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "buffer"):
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

try:
    import fitz
except ImportError:
    print(json.dumps({"error": "PyMuPDF (fitz) is not installed. Run: pip install pymupdf"}))
    sys.exit(1)


class _FitzStdoutGuard:
    def __enter__(self):
        self._prev = sys.stdout
        sys.stdout = sys.stderr
        return self

    def __exit__(self, *_):
        sys.stdout = self._prev


RATES_COLS = [
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

ORIGIN_ARB_COLS = [
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

DEST_ARB_COLS = [
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


def blank_row(cols: List[str]) -> Dict[str, str]:
    return {col: "" for col in cols}


def clean_text(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def to_iso_date(value: str) -> str:
    value = clean_text(value)
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


def city_only(value: str) -> str:
    value = clean_text(value)
    if not value:
        return ""
    return clean_text(value.split(",", 1)[0]).title()


def preserve_city(value: str) -> str:
    return clean_text(value).title()


def short_commodity(value: str) -> str:
    value = clean_text(value)
    if not value:
        return ""
    value = re.split(r"\bEXCLUDING\b", value, maxsplit=1, flags=re.IGNORECASE)[0]
    value = value.split("(", 1)[0]
    if re.search(r"\band/or\b", value, re.IGNORECASE):
        left = re.split(r"\band/or\b", value, maxsplit=1, flags=re.IGNORECASE)[0]
        if " - " in left:
            value = left
    return clean_text(value.rstrip(":;,.- "))


DEFAULT_SECTION_PATTERNS = [
    {"section": "RATES", "pattern": r"6\s*[-.]\s*1|general\s+rate"},
    {"section": "ORIGIN_ARB", "pattern": r"6\s*[-.]\s*3|origin\s+arbitrary"},
    {"section": "DEST_ARB", "pattern": r"6\s*[-.]\s*4|destination\s+arbitrary"},
    {"section": "STOP", "pattern": r"6\s*[-.]\s*5|g\.?o\.?h"},
]

DEFAULT_REGEX_BY_FIELD = {
    "contractId": r"\bATL\w+\b",
    "commodity": r"COMMODITY\s*:\s*(.+)",
    "origin": r"\bORIGIN\s*:\s*(.+)",
    "originVia": r"\bORIGIN\s+VIA\s*:\s*(.+)",
    "rateApplicableOver": r"RATE\s+APPLICABLE\s+OVER\s*:\s*(.+)",
    "scope": r"\[([^\]]*\(WB\)[^\]]*)\]",
    "dateToken": r"(\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}-\d{2}-\d{2}|\d{8}|\d{1,2}\s+[A-Za-z]{3,9},?\s+\d{4})",
    "validRange": r"valid\s*(?:from)?\s*(\d{4}-\d{2}-\d{2}|\d{8}|\d{1,2}\s+[A-Za-z]{3,9},?\s+\d{4})\s*(?:to|through|thru)\s*(\d{4}-\d{2}-\d{2}|\d{8}|\d{1,2}\s+[A-Za-z]{3,9},?\s+\d{4})",
    "effectiveDate": r"effective\s+date\s*[:\-]?\s*([^\n\r]+)",
    "expirationDate": r"expir(?:ation|y)\s+date\s*[:\-]?\s*([^\n\r]+)",
}

DEFAULT_HEADER_MAP = {
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


def _compile_regex(pattern: str, fallback: str) -> re.Pattern:
    try:
        return re.compile(pattern, re.IGNORECASE)
    except re.error:
        return re.compile(fallback, re.IGNORECASE)


def _compile_section_patterns(defs: List[Dict[str, str]]) -> List[Tuple[re.Pattern, str]]:
    out: List[Tuple[re.Pattern, str]] = []
    for entry in defs:
        section = clean_text(entry.get("section", "")).upper()
        pattern = entry.get("pattern", "")
        if section not in {"RATES", "ORIGIN_ARB", "DEST_ARB", "STOP"}:
            continue
        if not pattern:
            continue
        try:
            out.append((re.compile(pattern, re.IGNORECASE), section))
        except re.error:
            continue
    return out


def _schema_field_regex(schema: Dict[str, Any], key: str) -> Optional[str]:
    field_defs = schema.get("fieldDefinitions")
    if isinstance(field_defs, dict):
        value = field_defs.get(key)
        if isinstance(value, dict):
            regex = value.get("regex")
            if isinstance(regex, str) and regex.strip():
                return regex
        if isinstance(value, str) and value.strip():
            return value

    regex_by_field = schema.get("regexByField")
    if isinstance(regex_by_field, dict):
        value = regex_by_field.get(key)
        if isinstance(value, str) and value.strip():
            return value

    return None


def load_runtime_patterns(schema: Optional[Dict[str, Any]]) -> Tuple[
    List[Tuple[re.Pattern, str]],
    re.Pattern,
    re.Pattern,
    re.Pattern,
    re.Pattern,
    re.Pattern,
    re.Pattern,
    re.Pattern,
    re.Pattern,
    re.Pattern,
    re.Pattern,
    Dict[str, str],
]:
    section_defs = DEFAULT_SECTION_PATTERNS
    header_map = dict(DEFAULT_HEADER_MAP)

    if isinstance(schema, dict):
        schema_sections = schema.get("sectionDefinitions")
        if isinstance(schema_sections, list):
            candidate_defs: List[Dict[str, str]] = []
            for item in schema_sections:
                if not isinstance(item, dict):
                    continue
                section = clean_text(item.get("section") or item.get("name") or "").upper()
                pattern = item.get("startRegex") or item.get("pattern") or ""
                if isinstance(pattern, str) and section:
                    candidate_defs.append({"section": section, "pattern": pattern})
            if candidate_defs:
                section_defs = candidate_defs
        elif isinstance(schema.get("sectionPatterns"), list):
            section_defs = [
                {
                    "section": clean_text((item or {}).get("section", "")).upper(),
                    "pattern": str((item or {}).get("pattern", "")),
                }
                for item in schema.get("sectionPatterns", [])
                if isinstance(item, dict)
            ]

        aliases = schema.get("headerAliases")
        if isinstance(aliases, dict):
            for key, value in aliases.items():
                if isinstance(key, str) and isinstance(value, str):
                    header_map[key.lower().strip()] = value.strip()
        elif isinstance(schema.get("headerMap"), dict):
            for key, value in schema.get("headerMap", {}).items():
                if isinstance(key, str) and isinstance(value, str):
                    header_map[key.lower().strip()] = value.strip()

    compiled_sections = _compile_section_patterns(section_defs)
    if not compiled_sections:
        compiled_sections = _compile_section_patterns(DEFAULT_SECTION_PATTERNS)

    def rx(field_key: str) -> re.Pattern:
        fallback = DEFAULT_REGEX_BY_FIELD[field_key]
        custom = _schema_field_regex(schema or {}, field_key) if isinstance(schema, dict) else None
        return _compile_regex(custom or fallback, fallback)

    return (
        compiled_sections,
        rx("contractId"),
        rx("commodity"),
        rx("origin"),
        rx("originVia"),
        rx("rateApplicableOver"),
        rx("scope"),
        rx("dateToken"),
        rx("validRange"),
        rx("effectiveDate"),
        rx("expirationDate"),
        header_map,
    )


(
    SECTION_PATTERNS,
    CONTRACT_ID_RE,
    COMMODITY_RE,
    ORIGIN_RE,
    ORIGIN_VIA_RE,
    RATE_OVER_RE,
    SCOPE_RE,
    DATE_TOKEN_RE,
    VALID_RANGE_RE,
    EFFECTIVE_RE,
    EXPIRATION_RE,
    HEADER_MAP,
) = load_runtime_patterns(None)


def normalize_header(cell: str) -> str:
    clean = clean_text(cell).lower().replace("_", " ")
    clean = clean.replace("\n", " ")
    clean = re.sub(r"\s+", " ", clean)
    return HEADER_MAP.get(clean, clean)


def dedupe_headers(headers: List[str]) -> List[str]:
    out: List[str] = []
    seen: Dict[str, int] = {}
    for header in headers:
        key = normalize_header(header)
        count = seen.get(key, 0) + 1
        seen[key] = count
        out.append(key if count == 1 else f"{key}_{count}")
    return out


def row_dict(headers: List[str], cells: List[str]) -> Dict[str, str]:
    row: Dict[str, str] = {}
    for idx, header in enumerate(headers):
        row[header] = clean_text(cells[idx] if idx < len(cells) else "")
    return row


def is_blank_row(cells: List[str]) -> bool:
    return not any(clean_text(cell) for cell in cells)


def is_header_row(cells: List[str]) -> bool:
    first = clean_text(cells[0] if cells else "").lower()
    return first.startswith("destination") or first.startswith("point")


def has_numbers(value: str) -> bool:
    return bool(re.search(r"\d", clean_text(value)))


def continuation_row(section: str, row: Dict[str, str]) -> bool:
    anchor = row.get("destination_city", "") if section == "RATES" else row.get("point", "")
    if clean_text(anchor):
        return False
    return any(clean_text(v) for v in row.values())


def merge_row(base: Dict[str, str], cont: Dict[str, str]) -> None:
    for key, value in cont.items():
        value = clean_text(value)
        if not value:
            continue
        current = clean_text(base.get(key, ""))
        if not current:
            base[key] = value
        elif value not in current:
            base[key] = clean_text(f"{current} {value}")


def build_boundaries(doc: fitz.Document) -> List[Tuple[int, float, str]]:
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
            for pattern, section in SECTION_PATTERNS:
                if section not in seen and pattern.search(text):
                    found.append((page_no, float(block["bbox"][1]), section))
                    seen.add(section)
                    break
    found.sort(key=lambda item: (item[0], item[1]))
    return found


def section_for(page_no: int, y0: float, boundaries: List[Tuple[int, float, str]]) -> str:
    pos = page_no * 1_000_000.0 + y0
    current = "UNKNOWN"
    for b_page, b_y, section in boundaries:
        if b_page * 1_000_000.0 + b_y <= pos:
            current = section
        else:
            break
    return current


def scan_inline_labels(page: fitz.Page) -> List[Tuple[float, str, str]]:
    lines: List[Tuple[float, str]] = []
    for block in page.get_text("dict").get("blocks", []):
        if block.get("type") != 0:
            continue
        for line in block.get("lines", []):
            y0 = float(line["bbox"][1])
            text = clean_text(" ".join(span["text"] for span in line.get("spans", [])))
            if text:
                lines.append((y0, text))
    lines.sort(key=lambda item: item[0])

    found: List[Tuple[float, str, str]] = []
    i = 0
    while i < len(lines):
        y0, text = lines[i]

        m = re.match(r"ORIGIN\s+VIA\s*:\s*(.+)", text, re.IGNORECASE)
        if m:
            found.append((y0, "origin_via", city_only(m.group(1))))
            i += 1
            continue

        m = re.match(r"ORIGIN(?!\s+VIA)\s*:\s*(.+)", text, re.IGNORECASE)
        if m:
            found.append((y0, "origin", city_only(m.group(1))))
            i += 1
            continue

        m = re.match(r"RATE\s+APPLICABLE\s+OVER\s*:\s*(.+)", text, re.IGNORECASE)
        if m:
            found.append((y0, "rate_over", city_only(m.group(1))))
            i += 1
            continue

        i += 1

    return found


def parse_date_pairs(text: str) -> List[Tuple[str, str]]:
    pairs: List[Tuple[str, str]] = []
    for start, end in VALID_RANGE_RE.findall(text):
        pair = (to_iso_date(start), to_iso_date(end))
        if pair not in pairs:
            pairs.append(pair)
    return pairs


def parse_scope_bracketed(text: str) -> str:
    match = SCOPE_RE.search(text)
    return f"[{clean_text(match.group(1))}]" if match else ""


def parse_scope_unbracketed(text: str) -> str:
    match = SCOPE_RE.search(text)
    return clean_text(match.group(1)) if match else ""


def extract_header(doc: fitz.Document) -> Dict[str, str]:
    texts = [doc[i].get_text("text") for i in range(min(len(doc), 12))]
    text = "\n".join(texts)

    contract_id = ""
    match = CONTRACT_ID_RE.search(text)
    if match:
        contract_id = match.group(0).upper()

    pairs = parse_date_pairs("\n".join(doc[i].get_text("text") for i in range(len(doc))))
    if not pairs:
        effs = [to_iso_date(DATE_TOKEN_RE.search(m.group(1)).group(1)) for m in EFFECTIVE_RE.finditer(text) if DATE_TOKEN_RE.search(m.group(1))]
        exps = [to_iso_date(DATE_TOKEN_RE.search(m.group(1)).group(1)) for m in EXPIRATION_RE.finditer(text) if DATE_TOKEN_RE.search(m.group(1))]
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


def agw_values(origin_city: str) -> Tuple[str, str, str]:
    city = clean_text(origin_city).lower()
    if city in {"halifax", "vancouver", "montreal"}:
        return ("525", "500", "500")
    if city in {"chicago", "pocatello"}:
        return ("200", "400", "400")
    if city in {"baltimore", "richmond"}:
        return ("", "", "")
    return ("230", "230", "230")


def build_rates_row(header: Dict[str, str], dates: Tuple[str, str], commodity: str, origin_city: str, origin_via_city: str, scope: str, row: Dict[str, str]) -> Dict[str, str]:
    out = blank_row(RATES_COLS)
    out["Carrier"] = header["carrier"]
    out["Contract ID"] = header["contractId"]
    out["effective_date"] = dates[0]
    out["expiration_date"] = dates[1]
    out["commodity"] = commodity
    out["origin_city"] = origin_city
    out["origin_via_city"] = origin_via_city
    out["destination_city"] = city_only(row.get("destination_city", ""))
    out["destination_via_city"] = city_only(row.get("destination_via_city", ""))
    out["service"] = "CY/CY"
    out["SCOPE"] = scope
    out["BaseRate 20"] = row.get("rate20", "")
    out["BaseRate 40"] = row.get("rate40", "")
    out["BaseRate 40H"] = row.get("rate40h", "")
    out["BaseRate 45"] = row.get("rate45", "")
    if clean_text(row.get("direct_call", "")):
        out["Remarks"] = "!must be direct call at destination"

    country = clean_text(row.get("cntry", "")).upper()
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


def build_origin_arb_row(header: Dict[str, str], dates: Tuple[str, str], scope: str, rate_over_city: str, row: Dict[str, str]) -> Dict[str, str]:
    out = blank_row(ORIGIN_ARB_COLS)
    out["Carrier"] = header["carrier"]
    out["Contract ID"] = header["contractId"]
    out["effective_date"] = dates[0]
    out["expiration_date"] = dates[1]
    out["origin_city"] = city_only(row.get("point", ""))
    out["origin_via_city"] = rate_over_city
    out["service"] = "CY"
    out["Scope"] = scope
    out["BaseRate 20"] = row.get("rate20", "")
    out["BaseRate 40"] = row.get("rate40", "")
    out["BaseRate 40H"] = row.get("rate40h", "")
    out["BaseRate 45"] = row.get("rate45", "")
    out["20' AGW"], out["40' AGW"], out["45' AGW"] = agw_values(out["origin_city"])
    return out


def build_dest_arb_row(header: Dict[str, str], dates: Tuple[str, str], scope: str, rate_over_city: str, row: Dict[str, str]) -> Dict[str, str]:
    out = blank_row(DEST_ARB_COLS)
    out["Carrier"] = header["carrier"]
    out["Contract ID"] = header["contractId"]
    out["effective_date"] = dates[0]
    out["expiration_date"] = dates[1]
    out["destination_city"] = preserve_city(row.get("point", ""))
    out["destination_via_city"] = rate_over_city
    out["service"] = "CY"
    out["Scope"] = scope
    out["BaseRate 20"] = row.get("rate20", "")
    out["BaseRate 40"] = row.get("rate40", "")
    out["BaseRate 40H"] = row.get("rate40h", "")
    out["BaseRate 45"] = row.get("rate45", "")
    return out


def extract_tables(doc: fitz.Document, header: Dict[str, str]) -> Tuple[List[Dict[str, str]], List[Dict[str, str]], List[Dict[str, str]], List[str], List[Dict[str, Any]]]:
    rates: List[Dict[str, str]] = []
    origin_arbs: List[Dict[str, str]] = []
    dest_arbs: List[Dict[str, str]] = []
    warnings: List[str] = []
    raw_pages: List[Dict[str, Any]] = []

    boundaries = build_boundaries(doc)
    if not boundaries:
        warnings.append("No section boundaries found; defaulting tables to RATES")
        boundaries = [(0, 0.0, "RATES")]

    section_headers: Dict[str, List[str]] = {"RATES": [], "ORIGIN_ARB": [], "DEST_ARB": []}
    previous_output: Dict[str, Optional[Dict[str, str]]] = {"RATES": None, "ORIGIN_ARB": None, "DEST_ARB": None}

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

        commodity_match = COMMODITY_RE.search(page_text)
        if commodity_match:
            current_commodity = short_commodity(commodity_match.group(1))

        origin_match = ORIGIN_RE.search(page_text)
        if origin_match:
            current_origin = city_only(origin_match.group(1))

        origin_via_match = ORIGIN_VIA_RE.search(page_text)
        if origin_via_match:
            current_origin_via = city_only(origin_via_match.group(1))

        scope_match = parse_scope_unbracketed(page_text)
        if scope_match:
            current_scope_rates = scope_match
        scope_arb_match = parse_scope_bracketed(page_text)
        if scope_arb_match:
            current_scope_arb = scope_arb_match

        rate_over_match = RATE_OVER_RE.search(page_text)
        if rate_over_match:
            current_rate_over = city_only(rate_over_match.group(1))

        pairs = parse_date_pairs(page_text)
        if pairs:
            current_dates = pairs[-1]

        inline_labels = scan_inline_labels(page)

        try:
            with _FitzStdoutGuard():
                table_finder = page.find_tables(strategy="lines_strict")
                found_tables = table_finder.tables if hasattr(table_finder, "tables") else list(table_finder)
                if not found_tables:
                    table_finder = page.find_tables(strategy="lines")
                    found_tables = table_finder.tables if hasattr(table_finder, "tables") else list(table_finder)
        except Exception as exc:
            warnings.append(f"Page {page_no + 1}: find_tables() failed — {exc}")
            continue

        for table in found_tables:
            raw_rows = table.extract()
            if not raw_rows or len(raw_rows) < 2:
                continue

            table_y0 = float(table.bbox[1]) if hasattr(table, "bbox") else 0.0
            section = section_for(page_no, table_y0, boundaries)
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

            rows = [[clean_text(cell) for cell in row] for row in raw_rows]
            rows = [row for row in rows if not is_blank_row(row)]
            if not rows:
                continue

            if is_header_row(rows[0]):
                headers = dedupe_headers(rows[0])
                section_headers[section] = headers
                rows = rows[1:]
            else:
                headers = section_headers.get(section, [])
                if not headers:
                    warnings.append(f"Page {page_no + 1}: skipped continuation table in {section} with no prior headers")
                    continue

            for cells in rows:
                if is_blank_row(cells) or is_header_row(cells):
                    continue

                parsed_row = row_dict(headers, cells)
                if continuation_row(section, parsed_row) and previous_output[section] is not None:
                    merge_row(previous_output[section], parsed_row)
                    continue

                if section == "RATES":
                    out = build_rates_row(header, current_dates, current_commodity, table_origin, table_origin_via, current_scope_rates, parsed_row)
                    if any(has_numbers(out[k]) for k in ("BaseRate 20", "BaseRate 40", "BaseRate 40H", "BaseRate 45")):
                        rates.append(out)
                        previous_output[section] = out
                elif section == "ORIGIN_ARB":
                    out = build_origin_arb_row(header, current_dates, current_scope_arb, table_rate_over, parsed_row)
                    if out["origin_city"]:
                        origin_arbs.append(out)
                        previous_output[section] = out
                elif section == "DEST_ARB":
                    out = build_dest_arb_row(header, current_dates, current_scope_arb, table_rate_over, parsed_row)
                    if out["destination_city"]:
                        dest_arbs.append(out)
                        previous_output[section] = out

    end_rates = blank_row(RATES_COLS)
    end_rates["Carrier"] = "DOC END"
    rates.append(end_rates)

    end_origin = blank_row(ORIGIN_ARB_COLS)
    end_origin["Carrier"] = "DOC END"
    origin_arbs.append(end_origin)

    end_dest = blank_row(DEST_ARB_COLS)
    end_dest["Carrier"] = "DOC END"
    dest_arbs.append(end_dest)

    return rates, origin_arbs, dest_arbs, warnings, raw_pages


def main() -> None:
    global SECTION_PATTERNS
    global CONTRACT_ID_RE
    global COMMODITY_RE
    global ORIGIN_RE
    global ORIGIN_VIA_RE
    global RATE_OVER_RE
    global SCOPE_RE
    global DATE_TOKEN_RE
    global VALID_RANGE_RE
    global EFFECTIVE_RE
    global EXPIRATION_RE
    global HEADER_MAP

    parser = argparse.ArgumentParser(description="Extract freight contract tables from a PDF")
    parser.add_argument("--pdf", required=True, help="Absolute path to the PDF file")
    parser.add_argument("--schema-json", default="", help="JSON string containing extraction field definitions")
    args = parser.parse_args()

    started = time.time()

    schema_warnings: List[str] = []
    if args.schema_json:
        try:
            schema_obj = json.loads(args.schema_json)
            (
                SECTION_PATTERNS,
                CONTRACT_ID_RE,
                COMMODITY_RE,
                ORIGIN_RE,
                ORIGIN_VIA_RE,
                RATE_OVER_RE,
                SCOPE_RE,
                DATE_TOKEN_RE,
                VALID_RANGE_RE,
                EFFECTIVE_RE,
                EXPIRATION_RE,
                HEADER_MAP,
            ) = load_runtime_patterns(schema_obj)
        except Exception as exc:
            schema_warnings.append(f"Invalid schema JSON; using defaults ({exc})")

    try:
        doc = fitz.open(args.pdf)
    except Exception as exc:
        print(json.dumps({"error": f"Failed to open PDF: {exc}"}, ensure_ascii=False))
        sys.exit(1)

    try:
        header = extract_header(doc)
        rates, origin_arbs, dest_arbs, warnings, raw_pages = extract_tables(doc, header)
        result = {
            "header": header,
            "rates": rates,
            "originArbs": origin_arbs,
            "destArbs": dest_arbs,
            "rawPages": raw_pages,
            "pageCount": len(doc),
            "processingTime": round(time.time() - started, 2),
            "warnings": [*schema_warnings, *warnings],
        }
        print(json.dumps(result, ensure_ascii=False))
        sys.stdout.flush()
    except Exception as exc:
        print(json.dumps({"error": f"Extraction failed: {exc}"}, ensure_ascii=False))
        sys.stdout.flush()
        sys.exit(1)
    finally:
        doc.close()


if __name__ == "__main__":
    main()
