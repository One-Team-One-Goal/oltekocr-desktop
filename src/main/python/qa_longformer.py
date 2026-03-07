"""
qa_longformer.py — Longformer QA sidecar for TABLE_EXTRACT

Reads JSON payload from stdin:
{
  "context": "...ocr text...",
  "columns": [{"key": "invoice_no", "question": "What is the invoice number?"}]
}

Writes JSON to stdout:
{
  "results": {
    "invoice_no": {"answer": "12345", "score": 0.93}
  }
}

On error:
{"error": "..."}
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass
from typing import Any

import torch
from transformers import AutoModelForQuestionAnswering, AutoTokenizer


@dataclass
class QAResult:
    answer: str
    score: float


def chunk_text_words(text: str, chunk_words: int = 850, overlap_words: int = 120) -> list[str]:
    words = text.split()
    if len(words) <= chunk_words:
        return [text]

    chunks: list[str] = []
    start = 0
    step = max(1, chunk_words - overlap_words)
    while start < len(words):
        chunks.append(" ".join(words[start : start + chunk_words]))
        start += step
    return chunks


def decode_best_span(tokenizer: Any, input_ids: torch.Tensor, start_logits: torch.Tensor, end_logits: torch.Tensor) -> QAResult:
    start_probs = torch.softmax(start_logits, dim=-1)
    end_probs = torch.softmax(end_logits, dim=-1)

    start_idx = int(torch.argmax(start_probs).item())
    end_idx = int(torch.argmax(end_probs).item())
    if end_idx < start_idx:
        end_idx = start_idx

    max_span = 24
    if end_idx - start_idx > max_span:
        end_idx = start_idx + max_span

    score = float((start_probs[start_idx] * end_probs[end_idx]).item())
    answer_ids = input_ids[0, start_idx : end_idx + 1]
    answer = tokenizer.decode(answer_ids, skip_special_tokens=True).strip()

    if not answer:
        return QAResult(answer="", score=0.0)
    return QAResult(answer=answer, score=score)


def run_qa(model_id: str, context: str, columns: list[dict[str, str]]) -> dict[str, dict[str, float | str]]:
    tokenizer = AutoTokenizer.from_pretrained(model_id)
    model = AutoModelForQuestionAnswering.from_pretrained(model_id)
    model.eval()

    chunks = chunk_text_words(context)
    results: dict[str, dict[str, float | str]] = {}

    with torch.no_grad():
        for col in columns:
            key = str(col.get("key", "")).strip()
            question = str(col.get("question", "")).strip()
            if not key:
                continue
            if not question:
                results[key] = {"answer": "", "score": 0.0}
                continue

            best = QAResult(answer="", score=0.0)
            for chunk in chunks:
                encoded = tokenizer(
                    question,
                    chunk,
                    return_tensors="pt",
                    truncation="only_second",
                    max_length=4096,
                )

                output = model(**encoded)
                result = decode_best_span(
                    tokenizer,
                    encoded["input_ids"],
                    output.start_logits[0],
                    output.end_logits[0],
                )

                if result.score > best.score:
                    best = result

            results[key] = {"answer": best.answer, "score": round(best.score, 6)}

    return results


def main() -> None:
    parser = argparse.ArgumentParser(description="Longformer QA sidecar")
    parser.add_argument(
        "--model",
        default="mrm8488/longformer-base-4096-finetuned-squadv2",
        help="HF model id",
    )
    args = parser.parse_args()

    try:
        raw = sys.stdin.read().strip()
        payload = json.loads(raw) if raw else {}

        context = str(payload.get("context", ""))
        columns = payload.get("columns", [])
        if not isinstance(columns, list):
            raise ValueError("'columns' must be an array")

        results = run_qa(args.model, context, columns)
        sys.stdout.write(json.dumps({"results": results}, ensure_ascii=False))
        sys.stdout.flush()
    except Exception as exc:
        sys.stdout.write(json.dumps({"error": str(exc)}, ensure_ascii=False))
        sys.stdout.flush()
        sys.exit(1)


if __name__ == "__main__":
    main()
