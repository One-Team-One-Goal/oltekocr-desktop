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


def _call_ollama_json(
    model: str,
    base_url: str,
    prompt: str,
    *,
    num_predict: int,
    timeout_sec: int = 600,
) -> dict:
    payload = json.dumps({
        "model": model,
        "prompt": prompt,
        "format": "json",
        "stream": False,
        "options": {
            "temperature": 0.0,
            "num_predict": num_predict,
        },
    }).encode("utf-8")

    url = f"{base_url}/api/generate"
    req = urllib.request.Request(url, data=payload, headers={"Content-Type": "application/json"})

    try:
        with urllib.request.urlopen(req, timeout=timeout_sec) as resp:
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

    return _extract_json_from_response(raw_response)


def query_ollama(model: str, base_url: str, docling_json: dict, selected_sections: list[str] | None = None) -> dict:
    """Generate schema in two stages to reduce model load and improve stability."""

    selected_sections = selected_sections or []
    focus_meta = docling_json.get("__focus") if isinstance(docling_json, dict) else None
    focus_note = ""
    if isinstance(focus_meta, dict):
        pages = focus_meta.get("focusedPages")
        if isinstance(pages, list) and pages:
            focus_note = f"Focused page window: {pages}. "

    section_note = (
        "Target ONLY these selected sections when designing fields/tables: "
        + ", ".join(selected_sections)
        + "."
        if selected_sections
        else "Use all relevant sections from the provided document content."
    )

    context_json = json.dumps(docling_json, ensure_ascii=False)[:12000]

    stage1_prompt = (
        "You are extracting a compact task plan for document parsing. "
        "Return ONLY valid JSON. Do not include prose or markdown.\n"
        f"{focus_note}{section_note}\n"
        "Output shape:\n"
        "{\n"
        "  document_id: string,\n"
        "  company: string,\n"
        "  extraction_mode: 'AUTO',\n"
        "  record_start_regex: string,\n"
        "  extraction_tasks: [\n"
        "    {\n"
        "      id: string, section_id: string, section_label: string, objective: string, is_active: boolean,\n"
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
        "  ]\n"
        "}\n"
        "Rules:\n"
        "- Keep extraction_tasks concise and high-value.\n"
        "- Do not output every table header as a field.\n"
        "- Prefer robust fields needed for downstream schema.\n"
        "- At least one task with at least one field must be returned for structured docs.\n\n"
        "CONTEXT JSON:\n"
        f"{context_json}\n\n"
        "JSON:"
    )

    stage1 = _call_ollama_json(
        model,
        base_url,
        stage1_prompt,
        num_predict=1200,
        timeout_sec=420,
    )

    stage1_tasks = stage1.get("extraction_tasks")
    if not isinstance(stage1_tasks, list):
        stage1_tasks = []

    stage2_prompt = (
        "You are building final schema tabs from an extraction task plan. "
        "Return ONLY valid JSON.\n"
        "Output shape:\n"
        "{\n"
        "  sections: [{id:string,label:string,fields:[field]}],\n"
        "  tables: [{id:string,label:string,is_active:boolean,multi_page:boolean,columns:[field]}],\n"
        "  tabs: [{name:string,fields:[field]}]\n"
        "}\n"
        "Where field matches:\n"
        "{id,label,field_key,regex_rule,extraction_strategy,data_type,section_hint,context_hint,context_label,mandatory,post_processing}\n"
        "Rules:\n"
        "- Build tabs primarily from extraction tasks and their fields.\n"
        "- tabs must not be empty if extraction_tasks are present.\n"
        "- Keep sections/tables concise.\n"
        "- Do not emit duplicate fields across tabs.\n\n"
        "EXTRACTION TASKS JSON:\n"
        f"{json.dumps(stage1_tasks, ensure_ascii=False)[:10000]}\n\n"
        "JSON:"
    )

    stage2 = _call_ollama_json(
        model,
        base_url,
        stage2_prompt,
        num_predict=1200,
        timeout_sec=420,
    )

    parsed = {
        "document_id": stage1.get("document_id", ""),
        "company": stage1.get("company", ""),
        "extraction_mode": stage1.get("extraction_mode", "AUTO"),
        "record_start_regex": stage1.get("record_start_regex", ""),
        "extraction_tasks": stage1_tasks,
        "sections": stage2.get("sections", []),
        "tables": stage2.get("tables", []),
        "tabs": stage2.get("tabs", []),
    }

    # Fallback: if stage2 fails to provide tabs, synthesize tabs from tasks.
    if not isinstance(parsed.get("tabs"), list) or len(parsed.get("tabs", [])) == 0:
        task_tabs = []
        for idx, task in enumerate(stage1_tasks):
            if not isinstance(task, dict):
                continue
            fields = task.get("fields")
            if not isinstance(fields, list) or not fields:
                continue
            label = str(task.get("section_label") or task.get("objective") or f"Task {idx + 1}")
            task_tabs.append({"name": label, "fields": fields})
        parsed["tabs"] = task_tabs

    # Ensure all required top-level keys exist with sensible defaults
    parsed.setdefault("document_id", "")
    parsed.setdefault("company", "")
    parsed.setdefault("extraction_mode", "AUTO")
    parsed.setdefault("record_start_regex", "")
    parsed.setdefault("extraction_tasks", [])
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

        selected_sections = payload.get("selected_sections")
        if not isinstance(selected_sections, list):
            selected_sections = []
        selected_sections = [str(s).strip() for s in selected_sections if str(s).strip()]

        result = query_ollama(args.model, args.base_url, docling_json, selected_sections)
        sys.stdout.write(json.dumps({"result": result}, ensure_ascii=False))
        sys.stdout.flush()
    except Exception as exc:
        sys.stdout.write(json.dumps({"error": str(exc)}, ensure_ascii=False))
        sys.stdout.flush()
        sys.exit(1)


if __name__ == "__main__":
    main()
