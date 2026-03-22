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

    raise ValueError("LLM response did not contain a valid JSON object")


def query_ollama(model: str, base_url: str, docling_json: dict) -> dict:
    """Send Docling JSON to Ollama and parse structured schema response."""

    prompt = (
        "You are an expert document extraction architect for logistics PDFs. "
        "Given Docling-extracted document structure, infer and return ONLY a valid JSON object "
        "with this exact schema: {document_id, company, sections[], tables[]}.\n"
        "sections: Array of {id, label, bbox, is_active, fields[]}. "
        "Each field: {id, label, bbox, is_active, extractionStrategy}.\n"
        "tables: Array of {id, label, is_active, multi_page, columns[]}. "
        "Each column: {id, label, x_range}.\n"
        "Use concise snake_case ids, infer boundaries from layout, validate structure. "
        "Return ONLY the JSON object, no markdown, code fences, or text.\n\n"
        "DOCLING JSON:\n"
        f"{json.dumps(docling_json, ensure_ascii=False)[:4000]}\n\n"
        "JSON:"
    )

    payload = json.dumps({
        "model": model,
        "prompt": prompt,
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

    raw_response = str(body.get("response", "")).strip()
    parsed = _extract_json_from_response(raw_response)

    # Ensure all required top-level keys exist with sensible defaults
    parsed.setdefault("document_id", "")
    parsed.setdefault("company", "")
    parsed.setdefault("sections", [])
    parsed.setdefault("tables", [])

    return parsed


def main() -> None:
    parser = argparse.ArgumentParser(description="Ollama auto-schema extractor")
    parser.add_argument(
        "--model",
        default="phi4-mini",
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
