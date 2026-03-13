"""
qa_ollama.py — Ollama LLM QA sidecar for TABLE_EXTRACT

Reads JSON payload from stdin:
{
  "context": "...ocr text...",
  "columns": [{"key": "invoice_no", "question": "What is the invoice number?"}]
}

Writes JSON to stdout:
{
  "results": {
    "invoice_no": {"answer": "12345", "score": 1.0}
  }
}

On error:
{"error": "..."}
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.request
import urllib.error


def query_ollama(model: str, context: str, columns: list[dict[str, str]], base_url: str) -> dict[str, dict[str, float | str]]:
    """Send a single prompt to Ollama and parse structured answers."""

    # Build a prompt that asks for all columns at once
    column_lines = []
    for col in columns:
        key = str(col.get("key", "")).strip()
        question = str(col.get("question", "")).strip()
        if not key or not question:
            continue
        column_lines.append(f'- "{key}": {question}')

    if not column_lines:
        return {}

    prompt = (
        "You are a precise data extraction assistant. "
        "Given the following document text, answer each question with ONLY the extracted value. "
        "If a value cannot be found, respond with an empty string.\n\n"
        "DOCUMENT TEXT:\n"
        f"{context}\n\n"
        "QUESTIONS:\n"
        + "\n".join(column_lines)
        + "\n\n"
        "Respond ONLY with a valid JSON object mapping each key to its extracted answer. "
        'Example: {"invoice_no": "12345", "date": "2024-01-15"}\n'
        "JSON:"
    )

    payload = json.dumps({
        "model": model,
        "prompt": prompt,
        "stream": False,
        "options": {
            "temperature": 0.0,
            "num_predict": 1024,
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

    raw_response = body.get("response", "").strip()

    # Try to parse JSON from the response
    results: dict[str, dict[str, float | str]] = {}

    # Extract JSON from the response (handle markdown code blocks)
    json_str = raw_response
    if "```" in json_str:
        # Extract content between code fences
        parts = json_str.split("```")
        for part in parts[1::2]:  # odd indices are inside fences
            cleaned = part.strip()
            if cleaned.startswith("json"):
                cleaned = cleaned[4:].strip()
            json_str = cleaned
            break

    try:
        parsed = json.loads(json_str)
        if isinstance(parsed, dict):
            for col in columns:
                key = str(col.get("key", "")).strip()
                if not key:
                    continue
                value = parsed.get(key, "")
                results[key] = {
                    "answer": str(value) if value is not None else "",
                    "score": 1.0 if value else 0.0,
                }
    except json.JSONDecodeError:
        # Fallback: try to extract answers line by line
        for col in columns:
            key = str(col.get("key", "")).strip()
            results[key] = {"answer": "", "score": 0.0}

    # Ensure all columns have an entry
    for col in columns:
        key = str(col.get("key", "")).strip()
        if key and key not in results:
            results[key] = {"answer": "", "score": 0.0}

    return results


def main() -> None:
    parser = argparse.ArgumentParser(description="Ollama QA sidecar")
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

        context = str(payload.get("context", ""))
        columns = payload.get("columns", [])
        if not isinstance(columns, list):
            raise ValueError("'columns' must be an array")

        results = query_ollama(args.model, context, columns, args.base_url)
        sys.stdout.write(json.dumps({"results": results}, ensure_ascii=False))
        sys.stdout.flush()
    except Exception as exc:
        sys.stdout.write(json.dumps({"error": str(exc)}, ensure_ascii=False))
        sys.stdout.flush()
        sys.exit(1)


if __name__ == "__main__":
    main()
