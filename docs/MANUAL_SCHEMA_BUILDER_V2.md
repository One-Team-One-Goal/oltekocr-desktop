# Manual Schema Builder v2 — Feature Spec

## Overview

A visual, wizard-style tool that lets **non-technical operators** upload a sample PDF, configure table mappings with computed columns, assign tables to Excel sheets, and save the whole setup as a reusable **schema definition**. Future documents of the same type are processed automatically using the saved schema.

Core loop: **Upload PDF → Extract Tables → Auto-Group → Configure Columns → Assign Sheets → Preview → Save Schema**

---

## Wizard Steps

### Step 1 — Upload Sample PDF

**Screen:** Single drop zone + file picker.

| Element | Label | Notes |
|---------|-------|-------|
| Drop zone | "Drop a sample PDF here, or click to browse" | Accepts `.pdf` only |
| Help text | "Upload one document that represents the format you want to extract from." | Below the drop zone |
| Button | **"Extract Tables"** | Disabled until file is selected; triggers `POST /manual-schemas/extract-blocks` |
| Spinner | "Scanning pages and extracting tables..." | Shown during extraction |

On success → auto-advance to Step 2.

---

### Step 2 — Review Detected Tables

**Screen:** Vertical list of auto-grouped table cards.

Each card shows:
- **Group name** — auto-generated, e.g. "Table Group A (47 rows, pages 1–3)". Editable inline.
- **Column headers** — pills/chips showing the detected column names.
- **Row count + page range** — e.g. "47 rows · Pages 1–3"
- **Preview** — first 3 rows displayed as a mini-table.
- **Expand/Collapse** toggle to see all rows.

**Grouping controls:**
| Element | Label | Behavior |
|---------|-------|----------|
| Badge | "Auto-merged" | Shown when 2+ raw tables were combined into one group |
| Button | **"Split Group"** | Opens sub-view to unmerge specific tables from the group |
| Button | **"Merge With..."** | Select another group to combine with (for when auto-grouping missed a match) |
| Button | **"Rename"** | Inline rename the group |

**Page-level context (KV pairs):**
Below each group card, a collapsible section:
- **"Page Context"** — shows detected key-value pairs associated with this group (e.g. `Carrier: Maersk`, `Effective: 01/01/2026`).
- Users can **edit values** or **remove** irrelevant KV pairs.
- Users can **add custom context** entries.

**Footer:**
| Button | Label | Behavior |
|--------|-------|----------|
| Secondary | **"Re-extract"** | Re-run extraction if results look wrong |
| Primary | **"Configure Columns"** | Advance to Step 3 |

---

### Step 3 — Configure Columns

**Screen:** Left = list of table groups (selector). Right = column configuration for the selected group.

**Group selector (left):**
- Clickable list of group names with row counts.
- Active group is highlighted.

**Column configuration (right):**

#### Existing Columns
Each detected column shown as a row:
| Element | Label | Notes |
|---------|-------|-------|
| Checkbox | ✓ | Include/exclude this column from output |
| Name field | Column name | Pre-filled with detected header; editable |
| Format dropdown | "Format As" | `Text`, `Number`, `Currency`, `Date (MM/DD/YYYY)`, `Date (DD/MM/YYYY)`, `Percentage` |
| Sample field | "Expected Value Example" | User types a sample like `$1,250.00`. System auto-detects format if empty. Used for validation during processing. |

#### Add Computed Column
Button: **"+ Add Column"** → opens a form:

| Field | Label | Options | Notes |
|-------|-------|---------|-------|
| Text input | "Column Name" | — | Required. Name of the new column. |
| Dropdown | "Column Type" | `Copy Column`, `Fixed Value`, `Conditional`, `Extract Pattern`, `Combine Columns` | Determines which sub-form appears |

**Sub-forms by column type:**

##### Copy Column
> "Copy values from an existing column."
- Dropdown: **"Source Column"** → lists all columns in this group.

##### Fixed Value
> "Use the same value for every row."
- Text input: **"Value"** — e.g. `"USD"`, `"Import"`.

##### Conditional
> "Set value based on a condition."

Visual sentence builder (reads like plain English):

```
When [ Source ▼ ] [ Operator ▼ ] [ Value          ]
 then use [ Then Value      ]
 otherwise use [ Else Value      ]
```

- **Source**: dropdown → any column in this group OR any context key
- **Operator**: `equals`, `not equals`, `contains`, `greater than`, `less than`
- **Value**: text input
- **Then Value / Else Value**: text input

##### Extract Pattern
> "Pull part of a value from a column."

- Dropdown: **"From Column"** → source column
- Dropdown: **"Extract"** → human-readable presets:
  - `First number` → regex `(\d[\d,\.]*)`
  - `Text before " - "` → regex `^(.*?)\s*-`
  - `Text after ": "` → regex `:\s*(.*)`
  - `Text in parentheses` → regex `\(([^)]+)\)`
  - `Everything after last space` → regex `\S+$`
  - `Custom pattern...` → shows a regex input (advanced)

##### Combine Columns
> "Join two or more columns together."
- Multi-select: **"Columns"** → pick 2+ columns
- Text input: **"Separator"** — default `" "`, could be `" - "`, `", "`, etc.

**Column list actions:**
| Button | Label | Behavior |
|--------|-------|----------|
| Drag handle | ⠿ | Reorder columns via drag |
| Icon button | ✕ | Remove this column |
| Icon button | ✎ | Edit column configuration |

**Footer:**
| Button | Label | Behavior |
|--------|-------|----------|
| Secondary | **"Back to Tables"** | Return to Step 2 |
| Primary | **"Assign to Sheets"** | Advance to Step 4 |

---

### Step 4 — Assign to Sheets

**Screen:** Each table group shown with a sheet assignment dropdown.

```
┌──────────────────────────────────────────────────────────┐
│  Table Group: "Rates" (247 rows)                         │
│  Columns: Origin, Destination, 20ft, 40ft, 45ft, ...    │
│  Assign to Sheet: [ Sheet 1: Rates           ▼ ]        │
├──────────────────────────────────────────────────────────┤
│  Table Group: "Origin Charges" (12 rows)                 │
│  Columns: Port, Charge, Amount, Currency                 │
│  Assign to Sheet: [ Sheet 2: Origin Arbs     ▼ ]        │
├──────────────────────────────────────────────────────────┤
│  Table Group: "Destination Charges" (8 rows)             │
│  Columns: Port, Charge, Amount, Currency                 │
│  Assign to Sheet: [ Sheet 3: Dest Arbs       ▼ ]        │
└──────────────────────────────────────────────────────────┘
```

**Sheet management:**
| Element | Label | Behavior |
|---------|-------|----------|
| Dropdown | Sheet name | Lists existing sheets + "＋ New Sheet..." option |
| Inline rename | Click sheet name to edit | e.g. rename "Sheet 1" → "Rates" |
| Toggle | **"Include page context as header rows"** | Per-sheet: prepend KV-pair context above the table data |

Multiple groups can be assigned to the same sheet (they'll be stacked with a blank row separator).

**Footer:**
| Button | Label | Behavior |
|--------|-------|----------|
| Secondary | **"Back to Columns"** | Return to Step 3 |
| Primary | **"Preview Output"** | Advance to Step 5 |

---

### Step 5 — Preview & Save

**Screen:** Tabbed Excel-like preview (one tab per sheet). Shows the first ~20 rows with all computed columns applied.

| Element | Label | Behavior |
|---------|-------|----------|
| Tab bar | Sheet names | Switch between sheets |
| Table | Output preview | Read-only table with formatted values |
| Row count | "247 rows total" | Per sheet |
| Alert banner | Validation warnings | e.g. "3 rows have empty 'Origin' values", "Currency format mismatch in row 12" |

**Footer:**
| Button | Label | Behavior |
|--------|-------|----------|
| Secondary | **"Back to Sheets"** | Return to Step 4 |
| Secondary | **"Export Sample"** | Download this preview as `.xlsx` immediately |
| Primary | **"Save Schema"** | Opens save dialog |

**Save dialog:**
| Field | Label | Notes |
|-------|-------|-------|
| Text input | "Schema Name" | Required. e.g. "Maersk Rate Sheet" |
| Dropdown | "Category" | `Contract`, `Invoice`, `Bill of Lading`, `Packing List`, `Rate Sheet`, `Other` |
| Toggle | **"Set as default for this session"** | Auto-attach to current session |
| Button | **"Save"** | Persists the schema definition |

---

## Escape Hatch: Raw JSON

Every step has a small link in the top-right corner:

| Link | Label | Behavior |
|------|-------|----------|
| Text link | **"View as JSON"** | Opens a modal with the full schema definition as editable JSON. Changes here update the visual builder. |

This is for power users who want to copy-paste, import/export, or make bulk edits.

---

## Improved Table Grouping Algorithm

### Problems with Current `groupTables()`

1. **Exact header match only** — `"20' DC"` ≠ `"20'DC"` ≠ `"20ft Dry"`
2. **No user confirmation** — silently merges; no way to undo
3. **Context is captured once** — only the KV pairs before the *first* table in a group are stored
4. **No split capability** — once merged, tables can't be separated

### New Algorithm: `groupTablesV2()`

```
Input: blocks[] sorted by (page, y-position)

1. NORMALIZE headers
   - Trim whitespace
   - Lowercase
   - Strip non-alphanumeric (except spaces)
   - Collapse multiple spaces → single space
   e.g. "20' DC" → "20 dc", "20'DC" → "20dc" (STILL different)

2. COMPUTE SIMILARITY between every pair of table header-sets
   - Use Jaccard similarity on normalized header strings
   - Threshold: ≥ 0.85 similarity → candidate for merge
   - Also check: header count must be within ±2 of each other

3. BUILD CANDIDATE GROUPS
   - Union-Find / greedy clustering on similarity pairs
   - Each cluster becomes a candidate group

4. RECORD PER-TABLE CONTEXT
   - For each raw table, store the KV pairs that appeared
     between the *previous* table (or page start) and this table
   - Context is per-table, not per-group

5. PRESENT TO USER with merge suggestions
   - Show each candidate group with a confidence badge:
     "Exact Match" (100%), "Similar Headers" (85-99%), "Manual Review" (<85%)
   - User can accept, split, or merge differently

6. STORE raw tables + grouping decisions separately
   - `raw_tables[]` — original unmodified extraction
   - `groups[]` — user-confirmed grouping (mutable)
   - This allows re-grouping without re-extraction
```

### Fuzzy Matching on Schema Reuse

When applying a saved schema to a new PDF:

1. Extract tables from new PDF
2. For each table, find the best-matching group in the schema by header similarity
3. If confidence ≥ 90% → auto-map
4. If confidence 70–89% → show confirmation: "This table looks like 'Rates' — correct?"
5. If confidence < 70% → flag as unmatched, user must assign manually

---

## Data Model Changes

### New: `manual_schema_definitions` (replace current)

```sql
CREATE TABLE manual_schema_definitions (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  category        TEXT NOT NULL DEFAULT 'OTHER',  -- CONTRACT, INVOICE, BOL, PACKING_LIST, RATE_SHEET, OTHER
  version         INTEGER NOT NULL DEFAULT 1,
  
  -- Schema content
  groups_config   TEXT NOT NULL DEFAULT '[]',      -- JSON: group definitions with column configs
  sheets_config   TEXT NOT NULL DEFAULT '[]',      -- JSON: sheet assignments
  context_keys    TEXT NOT NULL DEFAULT '[]',      -- JSON: known context KV keys
  
  -- Metadata
  sample_file     TEXT,                             -- path to the sample PDF used to create this schema
  created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

### Group Config JSON Structure

```jsonc
// groups_config
[
  {
    "id": "grp_abc123",
    "name": "Rates",
    "headerSignature": ["origin", "destination", "20ft", "40ft", "45ft"],
    "columns": [
      // detected columns (included/excluded, renamed, formatted)
      {
        "key": "origin",
        "label": "Origin",
        "source": "detected",
        "included": true,
        "format": "text",
        "sampleValue": null
      },
      // computed columns
      {
        "key": "currency",
        "label": "Currency",
        "source": "computed",
        "included": true,
        "computeType": "fixed",         // fixed | conditional | extract | combine | copy
        "computeConfig": {
          "value": "USD"
        },
        "format": "text",
        "sampleValue": "USD"
      },
      {
        "key": "service_type",
        "label": "Service Type",
        "source": "computed",
        "included": true,
        "computeType": "conditional",
        "computeConfig": {
          "source": { "type": "column", "value": "origin" },
          "operator": "contains",
          "compareValue": "Direct",
          "thenValue": "Direct Call",
          "elseValue": "Transshipment"
        },
        "format": "text",
        "sampleValue": "Direct Call"
      }
    ],
    "columnOrder": ["origin", "destination", "currency", "service_type", "20ft", "40ft", "45ft"]
  }
]
```

### Sheets Config JSON Structure

```jsonc
// sheets_config
[
  {
    "name": "Rates",
    "groupIds": ["grp_abc123"],
    "includeContext": true       // prepend KV-pair context as header rows
  },
  {
    "name": "Origin Arbitraries",
    "groupIds": ["grp_def456"],
    "includeContext": false
  }
]
```

---

## API Endpoints

### Replace Existing Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/manual-schemas/extract` | Upload PDF, extract + auto-group tables. Returns `{ sessionId, rawTables[], candidateGroups[], contextKeys[] }` |
| `GET` | `/manual-schemas/sessions/:id` | Get session with current state |
| `PATCH` | `/manual-schemas/sessions/:id/groups` | Update groups (after user confirms/edits merges, renames, splits) |
| `PATCH` | `/manual-schemas/sessions/:id/columns` | Update column configs for a specific group |
| `PATCH` | `/manual-schemas/sessions/:id/sheets` | Update sheet assignments |
| `POST` | `/manual-schemas/sessions/:id/preview` | Generate preview rows for all sheets. Returns `{ sheets: [{ name, columns[], rows[], warnings[] }] }` |
| `POST` | `/manual-schemas/sessions/:id/save` | Save as schema definition. Body: `{ name, category }` |
| `GET` | `/manual-schemas/definitions` | List saved schemas |
| `GET` | `/manual-schemas/definitions/:id` | Get full schema definition |
| `DELETE` | `/manual-schemas/definitions/:id` | Delete a schema |
| `POST` | `/manual-schemas/definitions/:id/apply` | Apply saved schema to a new PDF. Body: `{ filePath }`. Returns match results with confidence scores. |

---

## Button & Label Naming Guide

Consistent, clear naming throughout — no jargon, no ambiguity.

### Wizard Navigation
| Position | Label | Icon | Notes |
|----------|-------|------|-------|
| Step 1 → 2 | **"Extract Tables"** | Play ▶ | Action verb, describes what happens |
| Step 2 → 3 | **"Configure Columns"** | Columns ⊞ | Clear next action |
| Step 3 → 4 | **"Assign to Sheets"** | Grid 📊 | — |
| Step 4 → 5 | **"Preview Output"** | Eye 👁 | Shows result before committing |
| Step 5 final | **"Save Schema"** | Save 💾 | — |
| All steps | **"Back to [Previous Step Name]"** | ← Arrow | Always says *where* you're going back to |

### Table Group Actions
| Label | Context | Avoids |
|-------|---------|--------|
| **"Split Group"** | Separate merged tables | ~~"Unmerge"~~ (technical), ~~"Break"~~ (negative) |
| **"Merge With..."** | Combine two groups | ~~"Join"~~ (SQL connotation), ~~"Combine"~~ (vague) |
| **"Rename"** | Change group display name | ~~"Edit"~~ (too broad) |
| **"Re-extract"** | Run PDF extraction again | ~~"Refresh"~~ (implies cache), ~~"Retry"~~ (implies error) |

### Column Actions
| Label | Context | Avoids |
|-------|---------|--------|
| **"+ Add Column"** | Create a new computed column | ~~"New"~~ (vague), ~~"Create"~~ (too formal) |
| **"Remove"** | Delete a column (with confirmation) | ~~"Delete"~~ (scary) |
| **"Edit"** | Modify column settings | — (universally understood) |
| **"Copy Column"** | Duplicate values from source | ~~"Mirror"~~, ~~"Clone"~~ |
| **"Fixed Value"** | Same value every row | ~~"Static"~~ (technical), ~~"Constant"~~ (math-y) |
| **"Conditional"** | If/then/else logic | ~~"Rule"~~ (vague), ~~"Formula"~~ (spreadsheet jargon) |
| **"Extract Pattern"** | Pull substring from value | ~~"Regex"~~ (technical), ~~"Parse"~~ (developer term) |
| **"Combine Columns"** | Concatenate multiple columns | ~~"Concat"~~ (technical), ~~"Join"~~ (SQL) |

### Sheet Actions
| Label | Context | Avoids |
|-------|---------|--------|
| **"＋ New Sheet"** | Create a new output sheet | ~~"Add Tab"~~ |
| **"Rename Sheet"** | Change sheet name | — |

### Schema Actions
| Label | Context | Avoids |
|-------|---------|--------|
| **"Save Schema"** | Persist the full definition | ~~"Create Template"~~ (overloaded) |
| **"Apply to New Document"** | Reuse schema on different PDF | ~~"Run"~~ (vague), ~~"Use"~~ (too generic) |
| **"Export Sample"** | Download preview as .xlsx | ~~"Download"~~ (could mean the schema itself) |
| **"View as JSON"** | Power-user raw view | ~~"Raw"~~, ~~"Debug"~~ |

---

## Component Breakdown (Frontend)

```
ManualSchemaWizard                      ← main dialog/page, manages wizard state
├── Step1Upload                         ← drop zone + extract trigger
├── Step2ReviewTables                   ← table group cards with merge/split
│   ├── TableGroupCard                  ← single group preview + actions
│   └── MergeSplitDialog                ← modal for merge/split operations
├── Step3ConfigureColumns               ← left group selector + right column editor
│   ├── GroupSelector                   ← clickable group list
│   ├── ColumnList                      ← sortable list of column configs
│   ├── ColumnEditor                    ← edit form for a single column
│   └── AddColumnForm                   ← type selector + sub-forms
│       ├── CopyColumnForm
│       ├── FixedValueForm
│       ├── ConditionalForm             ← visual sentence builder
│       ├── ExtractPatternForm          ← preset picker + custom regex
│       └── CombineColumnsForm
├── Step4AssignSheets                   ← sheet assignment dropdowns
├── Step5Preview                        ← tabbed output preview
│   └── SheetPreviewTable               ← per-sheet data table
├── SchemaJsonModal                     ← raw JSON editor escape hatch
└── SaveSchemaDialog                    ← name + category + save
```

---

## Implementation Phases

### Phase 1 — Core Pipeline (Build First)
- [ ] New `groupTablesV2()` with normalized header matching + Jaccard similarity
- [ ] Updated Python sidecar: return `rawTables[]` with page/position metadata
- [ ] Updated API endpoints (extract, update groups, preview, save)
- [ ] `Step1Upload` + `Step2ReviewTables` (no merge/split yet — just auto-grouping)
- [ ] `Step5Preview` with basic output
- [ ] `SaveSchemaDialog`

### Phase 2 — Column Configuration
- [ ] `Step3ConfigureColumns` with all 5 computed column types
- [ ] Format detection from sample values
- [ ] Validation warnings in preview

### Phase 3 — Sheets & Polish
- [ ] `Step4AssignSheets` with sheet management
- [ ] Multi-sheet Excel export
- [ ] Merge/Split group operations
- [ ] Column drag-reorder

### Phase 4 — Schema Reuse
- [ ] `POST /definitions/:id/apply` — apply schema to new PDF
- [ ] Fuzzy header matching with confidence scores
- [ ] User confirmation flow for ambiguous matches
- [ ] Schema import/export (JSON file)

---

## Open Decisions

1. **Multiple tables → same sheet stacking** — Should tables on the same sheet be separated by a blank row, a labeled header row, or a section divider?
2. **Context inheritance** — When a group spans pages 1–5, should context from page 3 override page 1's context, or should all context be merged?
3. **Column format enforcement** — Should format mismatches block export or just show warnings?
4. **Schema versioning** — When a user edits a saved schema, create a new version or overwrite?
