# OltekOCR Desktop

A logistics document processor built as a desktop application. Scan, OCR, extract structured data, review, and export document records — all locally, with no cloud dependency.

---

## Tech Stack

| Layer                | Technology                                                     |
| -------------------- | -------------------------------------------------------------- |
| Desktop shell        | Electron 28                                                    |
| Frontend             | React 18 + Vite (via electron-vite)                            |
| Styling              | Tailwind CSS v3 + Radix UI primitives                          |
| Backend (in-process) | NestJS (runs inside the Electron main process)                 |
| Database             | SQLite via Prisma ORM                                          |
| OCR engine           | RapidOCR (Python sidecar)                                      |
| Field extraction     | `@xenova/transformers` — local QA model (DistilBERT / RoBERTa) |

---

## Project Structure

```
src/
  main/              # Electron main process
    index.ts         # App entry — bootstraps Electron + NestJS
    data-dirs.ts     # Resolves data/scan/thumbnail directories
    nest/            # NestJS application
      app.module.ts
      documents/     # Document CRUD, image serving, WebSocket gateway
      export/        # Excel/CSV export service
      extraction/    # @xenova/transformers QA field extraction
      ocr/           # RapidOCR orchestration
      prisma/        # Prisma service wrapper
      queue/         # Processing queue (sequential, memory-safe)
      scanner/       # File-system scanner / watcher
      sessions/      # Session management
      settings/      # App settings (JSON file)
    python/
      ocr_rapidocr.py    # Python sidecar spawned per document
  preload/           # Electron preload bridge
  renderer/          # React UI (Vite)
    src/
      api/client.ts  # HTTP + WebSocket API client (port 3847)
      components/
        dashboard/   # Overview stats, document table, filter bar
        sessions/    # Session list, detail, extracted fields table
        layout/      # Sidebar
        ui/          # Radix UI component wrappers
      hooks/         # useDocuments, useQueue, useSettings, useWebSocket
  shared/
    types.ts         # Shared TypeScript types (DocumentRecord, SessionRecord, …)

data/                # Runtime data (git-ignored)
  oltekocr.db        # SQLite database
  settings.json      # Persisted settings
  scans/             # Incoming scan images
  exports/           # Generated export files
prisma/
  schema.prisma      # Database schema
```

---

## Installation & Setup

### 1. Prerequisites

Before you begin, make sure the following are installed on your machine:

| Requirement                                 | Version | Notes                        |
| ------------------------------------------- | ------- | ---------------------------- |
| [Node.js](https://nodejs.org)               | ≥ 18    | LTS recommended              |
| [Python](https://www.python.org/downloads/) | ≥ 3.9   | Required for the OCR sidecar |
| npm                                         | ≥ 9     | Comes with Node.js           |

> **Windows note**: During the Python install, check **"Add Python to PATH"**.

---

### 2. Clone the repository

```bash
git clone https://github.com/your-org/oltekocr-desktop.git
cd oltekocr-desktop
```

---

### 3. Install Node.js dependencies

```bash
npm install
```

This also runs `electron-builder install-app-deps` automatically via the `postinstall` script, which compiles any native Node modules (e.g. `sharp`, `better-sqlite3`) for the correct Electron version.

---

### 4. Set up the Python OCR environment

The OCR engine runs as a Python sidecar. You need `rapidocr-onnxruntime` available.

**Option A — virtual environment (recommended)**

```bash
# Create a venv inside the project (git-ignored)
python -m venv .venv

# Activate it
# Windows:
.venv\Scripts\activate
# macOS / Linux:
source .venv/bin/activate

# Install the OCR dependency
pip install rapidocr-onnxruntime
```

**Option B — global install**

```bash
pip install rapidocr-onnxruntime
```

> If you use a venv, the app will automatically detect it at `.venv/Scripts/python.exe` (Windows) or `.venv/bin/python` (macOS/Linux). If not found, it falls back to the system `python` / `python3` on `PATH`.

---

### 5. Initialise the database

Generate the Prisma client and push the schema to create the SQLite database:

```bash
npx prisma generate
npx prisma db push
```

This creates `data/oltekocr.db`. The `data/` directory is created automatically if it does not exist.

---

### 6. Run in development mode

```bash
npm run dev
```

Electron launches with:

- **Hot-reload** on renderer (React/Vite) changes
- **Auto-restart** of the main process (NestJS) on backend changes

The embedded NestJS server starts on **port 3847** automatically.

---

### 7. Build for production

```bash
npm run build
```

The packaged application installer is written to the `dist/` directory. On Windows this produces an `.exe` installer; on macOS a `.dmg`.

---

### 8. (Optional) First-run model download — TABLE_EXTRACT

If you plan to use **TABLE_EXTRACT** sessions, the local QA model (`@xenova/transformers`) is downloaded on first use and cached in `.model-cache/` (~500 MB). No action is needed — it downloads automatically when you first process a document in a TABLE_EXTRACT session. A stable internet connection is required for that initial download.

---

### Troubleshooting

| Problem                    | Fix                                                                             |
| -------------------------- | ------------------------------------------------------------------------------- |
| `python` not found         | Ensure Python is on `PATH`, or create a `.venv` as shown in step 4              |
| `prisma generate` fails    | Run `npm install` first to ensure the Prisma CLI is present                     |
| Port 3847 already in use   | Stop any other instance of the app and retry                                    |
| OCR returns no text        | Confirm `rapidocr-onnxruntime` is installed in the active Python environment    |
| Model download fails (401) | The QA model requires a public HuggingFace repo; check your internet connection |

---

## Sessions & Modes

Each **Session** groups a set of documents and targets one of two processing modes:

| Mode            | Description                                                                                                                   |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `OCR_EXTRACT`   | Full OCR text extraction — formatted text + raw text + bounding boxes                                                         |
| `TABLE_EXTRACT` | Structured field extraction — define labelled columns with questions; a local QA model reads the OCR text and fills in values |

### TABLE_EXTRACT columns

Columns are defined per-session with a **Label**, **Key** (used as the field identifier in exports), and a **Question** that the QA model answers against the document text (e.g. `"What is the invoice number?"`).

Fields where the model returns a confidence score of **0** are displayed as empty — they can be filled in manually via the row editor.

---

## Manual Field Editing

Any extracted row can be opened by clicking it in the table. The row editor lets you:

- Edit each field value directly
- Use the **crosshair button** (⊕) next to any field to open the **Mini OCR Picker** — a full-size document viewer with clickable bounding boxes and selectable text, so you can manually highlight the correct value and extract it into the field

---

## Document Statuses

| Status       | Meaning                                                      |
| ------------ | ------------------------------------------------------------ |
| `QUEUED`     | Waiting to be processed                                      |
| `SCANNING`   | Image quality check in progress                              |
| `PROCESSING` | OCR + extraction running                                     |
| `DONE`       | Successfully processed                                       |
| `ERROR`      | Processing failed                                            |
| `REVIEW`     | Flagged for manual review (low confidence or quality issues) |

---

## API

The NestJS backend listens on **`http://localhost:3847`** and is only accessible from within the same machine. Key endpoints:

| Method  | Path                        | Description                                                   |
| ------- | --------------------------- | ------------------------------------------------------------- |
| `GET`   | `/api/sessions`             | List all sessions                                             |
| `POST`  | `/api/sessions`             | Create a session                                              |
| `PATCH` | `/api/sessions/:id/columns` | Update session columns (clears extractedRow on all documents) |
| `GET`   | `/api/documents`            | List documents (with filters)                                 |
| `GET`   | `/api/documents/:id`        | Get document detail                                           |
| `GET`   | `/api/documents/:id/image`  | Serve the scanned image                                       |
| `PATCH` | `/api/documents/:id`        | Update document fields                                        |
| `POST`  | `/api/queue/:id`            | Enqueue document for processing                               |
| `POST`  | `/api/export/:sessionId`    | Export session to Excel/CSV                                   |

WebSocket events are broadcast on `ws://localhost:3847` for live progress updates.

---

## Settings

Settings are persisted to `data/settings.json` and editable via the UI (⚙ icon in the sidebar):

- **Confidence threshold** — documents scoring below this percentage are flagged as `REVIEW`
- **Watch folder** — a directory to automatically ingest new files from
- **Export format** — Excel or CSV

---

## License

MIT — © Oltek
