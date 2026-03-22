# OltekOCR Desktop - AGENTS

Purpose: provide compact, high-signal context for new sessions with minimal token usage.

## Mission
- Offline desktop OCR and structured extraction for logistics documents.
- Stack: Electron shell + NestJS backend + React renderer + Python sidecars.
- Data: SQLite via Prisma at data/oltekocr.db.

## Runtime Topology
- Electron main boots NestJS on localhost:3847.
- Renderer calls REST at /api and subscribes to WebSocket updates.
- OCR/extraction is delegated to Python scripts in src/main/python.

## Fast File Map
- Shared contracts: src/shared/types.ts
- Nest root: src/main/nest/app.module.ts
- OCR orchestrator: src/main/nest/ocr/ocr.service.ts
- Queue orchestration: src/main/nest/queue/queue.service.ts
- Session APIs: src/main/nest/sessions/
- Document APIs + gateway: src/main/nest/documents/
- Contract extraction logic: src/main/nest/contract-extraction/
- Renderer routes: src/renderer/src/App.tsx
- API client: src/renderer/src/api/client.ts
- Session UI: src/renderer/src/components/sessions/
- DB schema: prisma/schema.prisma

## Session Modes
- OCR_EXTRACT: RapidOCR sidecar (ocr_rapidocr.py)
- TABLE_EXTRACT: Longformer QA sidecar (qa_longformer.py)
- PDF_EXTRACT: Unified PDF extractor (pdf_extract.py --model ...)
- JSON_EXTRACT: planned

## Route Map
- / -> SessionsHome (PDF_EXTRACT)
- /ocr-extract -> SessionsHome (OCR_EXTRACT)
- /keyword-extract -> SessionsHome (TABLE_EXTRACT)
- /pdf-sessions/:id -> PdfSessionDetail
- /sessions/:id -> SessionDetail

## Backend Modules
- prisma, settings, scanner, sessions, session-presets
- documents, ocr, queue, export, models, contract-extraction

## Python Sidecar Contract
- Parse args with argparse.
- Return exactly one JSON object on stdout.
- Emit progress on stderr prefixed with [progress].
- Exit code 1 on error with JSON error payload.

## Dev Commands
- npm run dev
- npm run build
- npm run prisma:generate
- npm run prisma:push
- npm run typecheck:node
- npm run typecheck:web

## Python Environment
- Preferred venv: .venv/
- Setup script: scripts/setup-python.ps1
- Dependency lock list: requirements-python.txt

## Working Rules
- Keep shared types in src/shared/types.ts.
- Use class-validator DTOs in backend controller/service modules.
- Preserve existing API shapes unless task explicitly requires changes.
- Prefer minimal, targeted edits; avoid unrelated refactors.

## Token-Efficient Workflow
- Read only files related to the current task path first.
- For backend tasks: inspect module + service + dto + shared type.
- For frontend tasks: inspect route component + api client + shared type.
- For OCR tasks: inspect ocr.service.ts and the matching Python sidecar.
- Run type checks only for affected side (node or web) before broad checks.

## Common Pitfalls
- If npm dev fails with missing Rollup native package on Windows, install matching @rollup/rollup-win32-x64-msvc version.
- If Nest boots but Prisma errors with missing tables, run npm run prisma:push.
- PowerShell must use path prefix for local scripts: .\script.ps1.
