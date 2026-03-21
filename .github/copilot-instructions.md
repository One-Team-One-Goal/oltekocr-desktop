# OltekOCR Desktop — Copilot Agent Instructions

## Project Overview

**OltekOCR Desktop** is a fully offline, logistics-focused document processing application.
It scans, OCR-processes, extracts structured data, lets operators review/approve results, and exports to Excel/CSV/JSON — all running locally with no cloud dependency.

Built as a hackathon project by Oltek.

---

## Tech Stack

### Desktop Shell

- **Electron 28** — desktop wrapper
- **electron-vite 2** — build tooling (Vite-based)
- **electron-builder 24** — packaging

### Frontend (Renderer — `src/renderer/`)

- **React 18** + TypeScript
- **React Router DOM v6** — client-side routing
- **TailwindCSS v3** + `tailwindcss-animate`
- **Radix UI** — headless primitives (Dialog, Select, Tabs, Checkbox, Tooltip, etc.)
- **shadcn/ui** — component library built on Radix (`components.json` configures it)
- **Lucide React** — icons
- **@tanstack/react-table v8** — data tables
- **Geist** — font
- **react-resizable-panels** — resizable pane layouts
- WebSocket (`useWebSocket` hook) for real-time queue/document updates

### Backend (Main Process — `src/main/nest/`)

Runs **NestJS v10** embedded inside the Electron main process. Listens on `localhost:3847`.

- **NestJS** — HTTP + WebSocket server (platform-ws)
- **NestJS Swagger** — API docs at `/api/docs`
- **Prisma ORM v5** — SQLite database (`data/oltekocr.db`)
- **chokidar** — folder watcher for incoming scans
- **sharp** — image resizing / thumbnail generation
- **exceljs** — Excel export
- **class-validator + class-transformer** — request DTO validation
- **uuid** — ID generation

### Python Sidecars (`src/main/python/`)

Spawned as child processes via `child_process.spawn`. Communicate over stdin/stdout (JSON) and stderr (progress logs).

| Script                    | Purpose                                          |
| ------------------------- | ------------------------------------------------ |
| `ocr_rapidocr.py`         | RapidOCR — image + scanned PDF OCR               |
| `pdf_extract.py`          | Unified PDF extraction dispatcher (--model flag) |
| `pdf_docling.py`          | Docling-specific sidecar (legacy)                |
| `pdf_contract_extract.py` | Specialized logistics contract extraction        |
| `qa_longformer.py`        | Longformer QA for TABLE_EXTRACT field extraction |

### AI / ML Models

- **RapidOCR** — fast OCR for images and scanned PDFs
- **Longformer** (`mrm8488/longformer-base-4096-finetuned-squadv2`) — extractive QA for user-defined fields
- **@xenova/transformers** — JS-side transformer utilities
- **Docling 2.x** — IBM document parser (best for multi-column/table PDFs)
- **pdfplumber** — lightweight table/text extractor
- **PyMuPDF (fitz)** — high-speed PDF text extraction
- **Unstructured.io** — versatile multi-format parser
- **LLM (settings)** — Groq provider, `llama-3.3-70b-versatile` (planned Ollama: `qwen2.5:7b/32b`)

### Database

- **SQLite** via Prisma ORM
- Located at `./data/oltekocr.db`
- Migrations in `prisma/migrations/`

---

## Architecture

```
Electron Main Process
  ├── NestJS HTTP server (port 3847)
  │     ├── REST API consumed by Renderer
  │     └── WebSocket gateway for real-time updates
  ├── Prisma → SQLite (data/oltekocr.db)
  └── Python sidecar processes (spawn per document)

Electron Renderer (React)
  ├── REST API calls → http://localhost:3847/api
  └── WebSocket → ws://localhost:3847

Shared types: src/shared/types.ts (imported by both main and renderer)
```

---

## Core Modules (`src/main/nest/`)

| Module                 | Responsibility                                                                                 |
| ---------------------- | ---------------------------------------------------------------------------------------------- |
| `sessions/`            | Session CRUD, file ingestion, column management                                                |
| `documents/`           | Document CRUD, status updates, image serving, WebSocket gateway                                |
| `ocr/`                 | OCR orchestration — routes to correct Python sidecar based on session mode and extraction type |
| `queue/`               | FIFO sequential processing queue with pause/resume/cancel                                      |
| `extraction/`          | Longformer QA field extraction for TABLE_EXTRACT mode                                          |
| `contract-extraction/` | Specialized contract field parsing (carrier, rates, arbitraries)                               |
| `export/`              | Export to Excel/CSV/JSON; export history tracking                                              |
| `scanner/`             | File-system folder watcher (chokidar); hardware scanner stub                                   |
| `models/`              | Python package registry — check/install pip packages                                           |
| `settings/`            | App settings persisted to `data/settings.json`                                                 |
| `session-presets/`     | Reusable column presets for TABLE_EXTRACT sessions                                             |
| `prisma/`              | PrismaService wrapper                                                                          |

---

## Session Modes

| Mode            | Description                                      | Python Sidecar                |
| --------------- | ------------------------------------------------ | ----------------------------- |
| `OCR_EXTRACT`   | RapidOCR for images/scanned PDFs                 | `ocr_rapidocr.py`             |
| `TABLE_EXTRACT` | Longformer QA on user-defined columns/questions  | `qa_longformer.py`            |
| `PDF_EXTRACT`   | Digital PDF extraction (pluggable model)         | `pdf_extract.py --model <id>` |
| `JSON_EXTRACT`  | LLM-based structured JSON extraction _(planned)_ | `llm_extract.py` (TBD)        |

Selectable PDF extraction models: `docling` (default/recommended), `pdfplumber`, `pymupdf`, `unstructured`.

---

## Document Lifecycle

```
QUEUED → SCANNING → PROCESSING → REVIEW → APPROVED → EXPORTED
                                        ↘ REJECTED
                   (ERROR on failure at any stage)
                   (CANCELLING → QUEUED on cancel)
```

On app restart, any docs stuck in `CANCELLING / SCANNING / PROCESSING` are recovered to `QUEUED`.

---

## Data Model (key fields)

### Session

- `id`, `name`, `mode`, `columns` (JSON `SessionColumn[]`), `sourceType` (FILES/FOLDER), `sourcePath`, `documentType`, `extractionModel`, `status`

### Document

- All OCR results: `ocrFullText`, `ocrMarkdown`, `ocrTextBlocks`, `ocrTables`, `ocrAvgConfidence`
- Quality: `qualityDpi`, `qualityBlurScore`, `qualityIsBlurry`, `qualityIsSkewed`, `qualitySkewAngle`
- Extraction: `extractionType` (AUTO/IMAGE/PDF_TEXT/PDF_IMAGE/EXCEL), `extractedJson`, `extractedRow`, `userEdits`
- Lifecycle: `status`, `verifiedAt`, `verifiedBy`, `exported`, `exportPath`

### SessionColumn

```ts
{
  key: string;
  label: string;
  question: string;
}
```

The `question` field is the natural-language prompt fed to the Longformer QA model.

---

## Frontend Routes

| Path               | Component       | Mode            |
| ------------------ | --------------- | --------------- |
| `/`                | `SessionsHome`  | `PDF_EXTRACT`   |
| `/ocr-extract`     | `SessionsHome`  | `OCR_EXTRACT`   |
| `/keyword-extract` | `SessionsHome`  | `TABLE_EXTRACT` |
| `/sessions/:id`    | `SessionDetail` | —               |

---

## Key Settings

```json
{
  "scanner": { "watchFolder": "./data/scans/incoming", "supportedFormats": [".jpg", ".png", ".pdf", ...] },
  "ocr": { "language": "en", "confidenceThreshold": 85, "pythonPath": "python", "timeout": 120 },
  "export": { "defaultFormat": "excel" },
  "llm": { "provider": "groq", "defaultModel": "llama-3.3-70b-versatile", "temperature": 0.2 }
}
```

---

## Coding Conventions

- **TypeScript** everywhere except Python sidecars
- **Shared types** go in `src/shared/types.ts` — imported by both main and renderer
- **DTOs** use `class-validator` decorators; place in `*.dto.ts` files beside their service
- **NestJS services** are `@Injectable()`, modules declare providers explicitly
- Python sidecars read args via `argparse`, output a single JSON object to stdout, log progress lines to stderr prefixed with `[progress]`
- React components use functional components + hooks; no class components
- Database migrations: `npx prisma migrate dev --name <description>`
- API base URL: `http://localhost:3847/api` (configured in `src/renderer/src/api/client.ts`)

---

## Development Commands

```bash
npm run dev              # Start Electron + Vite dev server
npm run build            # Production build
npm run prisma:generate  # Regenerate Prisma client after schema changes
npm run prisma:push      # Push schema changes without migration
npx prisma migrate dev   # Create and apply a migration
npm run prisma:studio    # Open Prisma Studio
npm run typecheck:node   # Type-check main process
npm run typecheck:web    # Type-check renderer
```

Python venv is at `.venv/` — activate with `.venv\Scripts\Activate.ps1` (Windows).

---

## Current Work In Progress (TODO.md)

### Active / Hackathon

- **Extraction Panel** ✅ — collapsible right-side panel in `SessionDetail` for PDF_EXTRACT sessions; column checkboxes, section tables, approve/reject/reprocess actions; scalable `DOC_TYPE_RENDERERS` registry in `ExtractionPanel.tsx`
- **JSON Extract mode** — `llm_extract.py` using Ollama (`qwen2.5:7b`); dynamic schema from `SessionColumn[]`; Ollama URL + model in Settings
- **Queue cancel** — `POST /queue/cancel` with `{ documentIds }`, `QueueService.cancel(ids)`; frontend already wired
- **Session play/stop persistence** — restore `isRunning` from `queueApi.status()` on page load

### Backlog

- Excel Import (`EXCEL` source type, pandas sidecar)
- Export: JSON format, selected rows only, bulk export all approved
- UI: Space to toggle play/stop, toast notifications, progress bar in session header, mode icon badges
- Backend: add `PDF_EXTRACT`/`JSON_EXTRACT` to Prisma `SessionMode` enum + migrate
- ExtractionPanel: add future doc types by registering new entries in `DOC_TYPE_RENDERERS` in `ExtractionPanel.tsx`

---

## Extraction Panel — How It Works

The `ExtractionPanel` (`src/renderer/src/components/sessions/ExtractionPanel.tsx`) is a collapsible right-side panel in `SessionDetail`. It appears only for `PDF_EXTRACT` sessions.

### Usage Flow

1. User uploads PDF(s) to a PDF_EXTRACT session
2. Queue processes → `ContractExtractionService` → stores `extractedJson = { type: "CONTRACT", header, rates, originArbs, destArbs }`
3. In SessionDetail, user **single-clicks** a document row → panel opens showing extracted data
4. Panel shows column checkboxes — user can check/uncheck to show/hide columns
5. Each section table (Rates, Origin Arbitraries, Destination Arbitraries) updates live
6. User can Approve, Reject, or Reprocess from the panel footer
7. Double-clicking a row still opens the full-screen `ContractReviewDialog` for detailed review

### Adding a New Document Type

Edit `DOC_TYPE_RENDERERS` in `ExtractionPanel.tsx`:

```ts
DOC_TYPE_RENDERERS["INVOICE"] = {
  label: "Invoice",
  getHeaderFields: (data) => [...],
  sections: [
    {
      key: "lineItems",
      label: "Line Items",
      getRows: (d) => d.lineItems as Record<string, string>[],
      columns: INVOICE_COLS,
    },
  ],
};
```

The `type` key must match `extractedJson.type` stored by the extraction service.

---

## Important File Locations

| File                                   | Purpose                                              |
| -------------------------------------- | ---------------------------------------------------- |
| `src/shared/types.ts`                  | All shared TypeScript types                          |
| `src/main/nest/app.module.ts`          | Root NestJS module — register new modules here       |
| `src/main/nest/ocr/ocr.service.ts`     | Main OCR orchestrator — routes documents to sidecars |
| `src/main/nest/queue/queue.service.ts` | Processing queue logic                               |
| `src/renderer/src/api/client.ts`       | All frontend API calls                               |
| `src/renderer/src/App.tsx`             | React router — add new routes here                   |
| `prisma/schema.prisma`                 | Database schema                                      |
| `data/settings.json`                   | Runtime settings (git-ignored)                       |
