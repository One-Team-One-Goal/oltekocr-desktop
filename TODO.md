# OltekOCR Desktop — TODO

## In Progress / Hackathon Features

### PDF Extract Mode

- [ ] `pdf_extract.py` — sidecar that uses PyMuPDF `page.get_text()` for digital PDFs
- [ ] Auto-detect: if PDF has embedded text → use PDF Extract, else fall back to RapidOCR
- [ ] Wire `PDF_EXTRACT` session mode through `OcrService` → `pdf_extract.py`
- [ ] Update session creation API to accept `PDF_EXTRACT` mode

### JSON Extract Mode (LLM-based)

- [ ] `llm_extract.py` — sidecar using Ollama (OpenAI-compatible API) for structured extraction
- [ ] Default model: `qwen2.5:7b` (CPU-friendly), swap to `qwen2.5:32b` on powerful hardware
- [ ] Dynamic JSON schema built from `SessionColumn[]` definitions
- [ ] Wire `JSON_EXTRACT` mode through `ExtractionService` → `llm_extract.py`
- [ ] Update `OcrService` to route mode to correct sidecar
- [ ] Settings: add Ollama base URL + model name fields in SettingsDialog

### Queue — Per-document Stop / Cancel

- [ ] Backend: `POST /queue/cancel` endpoint accepting `{ documentIds: string[] }`
- [ ] `QueueService.cancel(ids)` — remove pending docs from queue, reset status to `QUEUED`
- [ ] Frontend already calls `queueApi.cancel()` — just needs the backend wired up

### Session — Play/Stop State Persistence

- [ ] Persist `isRunning` state across page navigations (currently resets on unmount)
- [ ] On session load, check `queueApi.status()` to restore running state

## Backlog

### Excel Import

- [ ] `excel_extract.py` — pandas-based sidecar reading all sheets
- [ ] New source type: `EXCEL` in session creation
- [ ] Map Excel columns to `SessionColumn[]` keys automatically

### Export Improvements

- [ ] Export to JSON format (currently only Excel)
- [ ] Export selected rows only (use row selection state)
- [ ] Bulk export all approved docs across sessions

### UI Polish

- [ ] Keyboard shortcut: `Space` to toggle play/stop in session detail
- [ ] Toast notifications instead of `confirm()` dialogs for delete actions
- [ ] Progress bar in session header showing queue completion %
- [ ] Session list: show mode icon badge (OCR / Table / PDF / JSON)

### Backend

- [ ] `sessions.service.ts` — add `PDF_EXTRACT` and `JSON_EXTRACT` to allowed modes
- [ ] Prisma schema: add `PDF_EXTRACT`, `JSON_EXTRACT` to `SessionMode` enum
- [ ] Run `npx prisma migrate dev` after schema change
