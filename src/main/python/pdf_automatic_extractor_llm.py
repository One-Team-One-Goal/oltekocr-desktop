"""
pdf_automatic_extractor_llm.py — Ollama LLM auto-schema generator

Reads JSON payload from stdin:
{
  "docling_json": {...full Docling extraction...}
}

Writes JSON to stdout:
{
  "result": {
    "document_id": "...",
    "company": "...",
    "sections": [{...}],
    "tables": [{...}]
  }
}

On error:
{"error": "..."}
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request


def _extract_balanced_json_object(text: str) -> str | None:
    """Return the first balanced JSON object substring from text."""
    if not text:
        return None

    start = text.find("{")
    if start < 0:
        return None

    depth = 0
    in_string = False
    escape = False

    for idx in range(start, len(text)):
        ch = text[idx]

        if in_string:
            if escape:
                escape = False
            elif ch == "\\":
                escape = True
            elif ch == '"':
                in_string = False
            continue

        if ch == '"':
            in_string = True
            continue

        if ch == "{":
            depth += 1
            continue

        if ch == "}":
            depth -= 1
            if depth == 0:
                return text[start : idx + 1]

    return None


def _extract_json_from_response(text: str) -> dict:
    """Extract JSON object from LLM response, handling markdown code blocks."""
    raw = (text or "").strip()

    # Try plain JSON first
    try:
        parsed = json.loads(raw)
        if isinstance(parsed, dict):
            return parsed
    except json.JSONDecodeError:
        pass

    # Try markdown code fences
    if "```" in raw:
        parts = raw.split("```")
        for part in parts[1::2]:  # odd indices are inside fences
            cleaned = part.strip()
            if cleaned.startswith("json"):
                cleaned = cleaned[4:].strip()
            try:
                parsed = json.loads(cleaned)
                if isinstance(parsed, dict):
                    return parsed
            except json.JSONDecodeError:
                continue

    # Try to recover the first balanced JSON object from mixed text.
    candidate = _extract_balanced_json_object(raw)
    if candidate:
        try:
            parsed = json.loads(candidate)
            if isinstance(parsed, dict):
                return parsed
        except json.JSONDecodeError:
            pass

    # Some models return JSON as a quoted string; decode once and retry.
    try:
        decoded_once = json.loads(raw)
        if isinstance(decoded_once, str):
            nested = decoded_once.strip()
            nested_candidate = _extract_balanced_json_object(nested) or nested
            parsed = json.loads(nested_candidate)
            if isinstance(parsed, dict):
                return parsed
    except (json.JSONDecodeError, TypeError):
        pass

    raise ValueError("LLM response did not contain a valid JSON object")


def query_ollama(model: str, base_url: str, docling_json: dict) -> dict:
    """Send Docling JSON to Ollama and parse structured schema response."""

    prompt = (
        "You are an expert document extraction architect for logistics and invoice PDFs. "
        "Given Docling-extracted structure, infer a production-ready extraction schema and return ONLY valid JSON. "
        "Do not return prose, markdown, or code fences.\n"
        "Return this exact top-level object shape:\n"
        "{\n"
        "  document_id: string,\n"
        "  company: string,\n"
        "  extraction_mode: 'AUTO',\n"
        "  record_start_regex: string,\n"
        "  sections: [\n"
        "    {\n"
        "      id: string, label: string, bbox: any, is_active: boolean,\n"
        "      fields: [\n"
        "        {\n"
        "          id: string, label: string, field_key: string, regex_rule: string,\n"
        "          extraction_strategy: 'regex' | 'header_field' | 'table_column' | 'page_region',\n"
        "          data_type: 'string' | 'currency' | 'number' | 'date' | 'percentage',\n"
        "          section_hint: string, context_hint: 'same_line_after_label' | 'next_line_after_label' | 'table_cell',\n"
        "          context_label: string, mandatory: boolean, post_processing: string[]\n"
        "        }\n"
        "      ]\n"
        "    }\n"
        "  ],\n"
        "  tables: [\n"
        "    {\n"
        "      id: string, label: string, is_active: boolean, multi_page: boolean,\n"
        "      columns: [\n"
        "        {\n"
        "          id: string, label: string, field_key: string, regex_rule: string,\n"
        "          extraction_strategy: 'table_column',\n"
        "          data_type: 'string' | 'currency' | 'number' | 'date' | 'percentage',\n"
        "          section_hint: string, context_hint: 'table_cell',\n"
        "          context_label: string, mandatory: boolean, post_processing: string[]\n"
        "        }\n"
        "      ]\n"
        "    }\n"
        "  ],\n"
        "  tabs: [\n"
        "    { name: string, fields: [same field shape as section fields above] }\n"
        "  ]\n"
        "}\n"
        "Rules:\n"
        "- sections/tables/tabs must not be empty for structured docs.\n"
        "- fields/columns must include usable field_key and regex_rule when possible.\n"
        "- infer regex rules from labels/text patterns and inferred layout.\n"
        "- choose realistic data_type and post_processing (e.g., trim, remove_commas, remove_currency).\n"
        "- use snake_case ids and field_key unless a label style key is clearly better.\n"
        "- is_active must be true/false only (never null).\n\n"
        "DOCLING JSON:\n"
        f"{json.dumps(docling_json, ensure_ascii=False)[:20000]}\n\n"
        "JSON:"
    )

    payload = json.dumps({
        "model": model,
        "prompt": prompt,
        "format": "json",
        "stream": False,
        "options": {
            "temperature": 0.0,
            "num_predict": 4096,
        },
    }).encode("utf-8")

    url = f"{base_url}/api/generate"
    req = urllib.request.Request(url, data=payload, headers={"Content-Type": "application/json"})

    try:
        with urllib.request.urlopen(req, timeout=600) as resp:
            body = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        response_text = exc.read().decode("utf-8", errors="replace")
        response_error = response_text
        try:
            parsed_error = json.loads(response_text)
            if isinstance(parsed_error, dict) and parsed_error.get("error"):
                response_error = str(parsed_error["error"])
        except json.JSONDecodeError:
            pass

        if exc.code == 404:
            raise RuntimeError(
                f"Ollama model '{model}' is not available at {base_url}. "
                "Select an installed local model or pull it first. "
                f"Details: {response_error}"
            ) from exc

        raise RuntimeError(
            f"Ollama request failed with HTTP {exc.code} at {base_url}. "
            f"Details: {response_error}"
        ) from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(
            f"Cannot connect to Ollama at {base_url}. "
            "Make sure Ollama is running (ollama serve). "
            f"Details: {exc}"
        ) from exc

    if isinstance(body, dict) and body.get("error"):
        raise RuntimeError(str(body.get("error")))

    raw_response = str(body.get("response", "")).strip()
    if not raw_response:
        raise RuntimeError("Ollama returned an empty response")

    parsed = _extract_json_from_response(raw_response)

    # Ensure all required top-level keys exist with sensible defaults
    parsed.setdefault("document_id", "")
    parsed.setdefault("company", "")
    parsed.setdefault("extraction_mode", "AUTO")
    parsed.setdefault("record_start_regex", "")
    parsed.setdefault("sections", [])
    parsed.setdefault("tables", [])
    parsed.setdefault("tabs", [])

    return parsed


def main() -> None:
    parser = argparse.ArgumentParser(description="Ollama auto-schema extractor")
    parser.add_argument(
        "--model",
        default="qwen3:30b",
        help="Ollama model name",
    )
    parser.add_argument(
        "--base-url",
        default="http://127.0.0.1:11434",
        help="Ollama API base URL",
    )
    args = parser.parse_args()

    try:
        raw = sys.stdin.read().strip()
        payload = json.loads(raw) if raw else {}

        docling_json = payload.get("docling_json")
        if not isinstance(docling_json, dict):
            raise ValueError("'docling_json' must be an object")

        result = query_ollama(args.model, args.base_url, docling_json)
        sys.stdout.write(json.dumps({"result": result}, ensure_ascii=False))
        sys.stdout.flush()
    except Exception as exc:
        sys.stdout.write(json.dumps({"error": str(exc)}, ensure_ascii=False))
        sys.stdout.flush()
        sys.exit(1)


if __name__ == "__main__":
    main()
