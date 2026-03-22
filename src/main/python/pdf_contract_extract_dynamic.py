"""
pdf_contract_extract_dynamic.py
-------------------------------
Schema-driven dynamic freight contract extraction.

This entrypoint is intentionally separate from pdf_contract_extract.py so the
legacy/standard extractor and dynamic schema extractor can evolve independently.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from typing import Any, Dict, List

# Keep UTF-8 output on Windows subprocesses without replacing stream objects.
for _stream_name in ("stdout", "stderr"):
    _stream = getattr(sys, _stream_name, None)
    if _stream and hasattr(_stream, "reconfigure"):
        try:
            _stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass

# Reuse extraction internals from the legacy module while keeping a separate entrypoint.
import pdf_contract_extract as legacy


def main() -> None:
    parser = argparse.ArgumentParser(description="Extract freight contract tables from a PDF using a schema preset")
    parser.add_argument("--pdf", required=True, help="Absolute path to the PDF file")
    parser.add_argument(
        "--schema-json",
        required=True,
        help="Schema preset JSON object with tabs/fields",
    )
    args = parser.parse_args()

    start = time.time()
    warnings: List[str] = []
    legacy.log_progress(5, "Opening PDF")

    schema_preset = legacy._parse_schema_preset(args.schema_json, warnings)
    if not schema_preset:
        print(json.dumps({"error": "Dynamic extraction requires a valid schema preset JSON."}))
        sys.stdout.flush()
        sys.exit(1)

    try:
        doc = legacy.open_pdf_document(args.pdf)
    except Exception as exc:  # pragma: no cover - subprocess guard
        print(json.dumps({"error": f"Failed to open PDF: {exc}"}))
        sys.stdout.flush()
        sys.exit(1)

    page_count = len(doc)
    legacy.log_progress(12, f"Loaded PDF with {page_count} page(s)")

    try:
        legacy.log_progress(18, "Extracting header fields")
        header = legacy._legacy_extract_header(doc)
        legacy.log_progress(25, "Extracting schema tabs")
        rates, origin_arbs, dest_arbs, tabs_out, tbl_warnings = legacy.extract_tables_from_schema(
            doc,
            header,
            schema_preset,
        )
        raw_pages: List[Dict[str, Any]] = [
            {
                "page": i + 1,
                "text": doc[i].get_text("text"),
            }
            for i in range(page_count)
        ]
        legacy.log_progress(90, "Finalizing extraction output")
        warnings.extend(tbl_warnings)
    except Exception as exc:  # pragma: no cover - subprocess guard
        print(json.dumps({"error": f"Extraction failed: {exc}"}))
        sys.stdout.flush()
        sys.exit(1)
    finally:
        doc.close()

    elapsed = round(time.time() - start, 2)

    result = {
        "header": header,
        "rates": rates,
        "originArbs": origin_arbs,
        "destArbs": dest_arbs,
        "tabs": tabs_out,
        "rawPages": raw_pages,
        "pageCount": page_count,
        "processingTime": elapsed,
        "warnings": warnings,
    }

    legacy.log_progress(100, "Complete")
    print(json.dumps(result, ensure_ascii=False))
    sys.stdout.flush()


if __name__ == "__main__":
    main()
