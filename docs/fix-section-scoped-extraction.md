# Fix: Section-Scoped Extraction for Manual Schema Builder

## Problem

When a user defines multiple tabs (sections) in the Manual Schema Builder, the extractor does not scope each tab's extraction to its actual region in the PDF. Instead:

1. **Contract-biased mode**: Every tab is mapped to one of 4 hardcoded buckets (`RATES`, `ORIGIN_ARB`, `DEST_ARB`, `HEADER`) via `_resolve_tab_section()`. A custom tab like "Special Rates" resolves to `RATES` and gets the **same 1206 rows** as the main "Rates" tab — all columns are appended to the last row of that shared pool.

2. **Generic mode**: `_extract_generic_from_schema` searches the **entire document text** for every tab. There is no per-tab text scoping, so all tabs extract from overlapping regions.

**Root cause**: There is no mechanism to tell the extractor _where_ in the PDF a tab's data begins and ends.

---

## Solution Overview

Add a **`sectionStartHint`** field at the **tab level** (not field level). This is a user-provided text string that matches a heading or label in the PDF document, telling the extractor where that tab's data starts. The extractor uses all tabs' hints to build non-overlapping text regions, then extracts each tab's rows only from its scoped region.

---

## Changes Required

### 1. Database — Add `sectionStartHint` to `SchemaPresetTab`

**File**: `prisma/schema.prisma`

Add a nullable string column to the `SchemaPresetTab` model:

```prisma
model SchemaPresetTab {
  id               String              @id @default(uuid())
  presetId         String              @map("preset_id")
  name             String
  sectionStartHint String?             @map("section_start_hint")   // ← NEW
  sortOrder        Int                 @default(0)
  createdAt        DateTime            @default(now())
  updatedAt        DateTime            @updatedAt
  preset           SchemaPreset        @relation(fields: [presetId], references: [id], onDelete: Cascade)
  fields           SchemaPresetField[]

  @@index([presetId, sortOrder])
  @@map("schema_preset_tabs")
}
```

**Migration**: `npx prisma migrate dev --name add_section_start_hint_to_tabs`

---

### 2. Backend — Update DTOs and Service

**File**: `src/main/nest/sessions/sessions.controller.ts` (or wherever schema preset CRUD DTOs live)

Add `sectionStartHint?: string` to the tab DTO for create/update schema preset endpoints.

**File**: `src/main/nest/sessions/sessions.service.ts` (or `session-presets`)

When creating/updating `SchemaPresetTab` records, persist `sectionStartHint`.
When returning tab data in `getSchemaPreset`, include `sectionStartHint`.

---

### 3. Frontend — Types and API Client

**File**: `src/renderer/src/api/client.ts`

Add `sectionStartHint?: string` to `SchemaPresetTabPayload`:

```ts
export interface SchemaPresetTabPayload {
  name: string;
  sectionStartHint?: string;   // ← NEW
  fields: SchemaPresetFieldPayload[];
}
```

Add `sectionStartHint` to the create/update request bodies.

---

### 4. Frontend — SchemaBuilderDialog

**File**: `src/renderer/src/components/sessions/SchemaBuilderDialog.tsx`

#### 4a. Update `SchemaPresetTab` interface

```ts
export interface SchemaPresetTab {
  name: string;
  sectionStartHint?: string;   // ← NEW: text heading in PDF where this tab starts
  fields: SchemaPresetField[];
}
```

#### 4b. Rename UI labels

| Current Label | New Label |
|---|---|
| "Sections" (sidebar header) | "Tabs" |
| "Add Section" (button) | "+ Tab" |
| "Section name" (input placeholder) | "Tab name" |

#### 4c. Add `sectionStartHint` input to tab editing

When creating or editing a tab, show a second input field below the tab name:

```
┌─────────────────────────────────────────┐
│ Tab name: [Rates                      ] │
│ Section hint: [6-1. General Rate      ] │
│                                    ✓  ✕ │
└─────────────────────────────────────────┘
```

- **Label**: "Section hint" with a tooltip: "Text from the PDF that marks where this section starts. The extractor will only look for this tab's data after this heading."
- **Placeholder**: `e.g. "6-1. General Rate"`
- **Optional**: If left empty, the tab name is used as fallback hint text.
- **Validation**: Warn (not block) if two tabs have the same hint.

#### 4d. Update tab state management

The `upsertTab()`, `startAddTab()`, `editTab()` functions need to handle `sectionStartHint` alongside the tab name. Add a `tabHintDraft` state variable next to `tabDraft`.

#### 4e. Update `submitAll()` and `onSubmit` payload

Ensure `sectionStartHint` is included when building the preset draft for submission:

```ts
tabs: tabs.map(tab => ({
  name: tab.name,
  sectionStartHint: tab.sectionStartHint,
  fields: tab.fields.map(field => ({ ... })),
}))
```

---

### 5. Frontend — `SessionsHome.tsx` (save/update functions)

**File**: `src/renderer/src/components/sessions/SessionsHome.tsx`

Update `saveSchemaPreset()` and `handleEditPresetSubmit()` to include `sectionStartHint` in the tab mapping:

```ts
tabs: preset.tabs.map(tab => ({
  name: tab.name,
  sectionStartHint: tab.sectionStartHint,
  fields: tab.fields.map(field => ({ ... })),
}))
```

---

### 6. Python Extractor — Section-Scoped Extraction

**File**: `src/main/python/pdf_contract_extract.py`

This is the core logic change. Both `extract_tables_from_schema` (contract-biased) and `_extract_generic_from_schema` (generic) need to scope extraction per tab.

#### 6a. New helper: `_build_section_boundaries()`

```python
def _build_section_boundaries(
    full_text: str,
    tabs: List[Dict[str, Any]],
) -> List[Tuple[str, int, int]]:
    """
    Build ordered, non-overlapping (tab_name, start_offset, end_offset) tuples.

    For each tab, find its sectionStartHint (or tab name) in the document text.
    Use fuzzy matching: case-insensitive, ignore extra whitespace, try partial match.
    Sort by document position. Each section ends where the next one begins.
    """
    markers: List[Tuple[str, int]] = []

    for tab in tabs:
        hint = (tab.get("sectionStartHint") or tab.get("name", "")).strip()
        if not hint:
            continue

        # Try exact case-insensitive match first
        match = re.search(re.escape(hint), full_text, re.IGNORECASE)

        # Fuzzy fallback: collapse whitespace, try partial words
        if not match:
            normalized = re.sub(r'\s+', r'\\s+', re.escape(hint))
            match = re.search(normalized, full_text, re.IGNORECASE)

        if match:
            markers.append((tab.get("name", ""), match.start()))

    # Sort by position in document
    markers.sort(key=lambda m: m[1])

    # Build non-overlapping boundaries
    boundaries: List[Tuple[str, int, int]] = []
    for i, (name, start) in enumerate(markers):
        end = markers[i + 1][1] if i + 1 < len(markers) else len(full_text)
        boundaries.append((name, start, end))

    return boundaries
```

#### 6b. Update `extract_tables_from_schema()` (contract-biased mode)

**Current behavior**: Uses `_resolve_tab_section()` to map tab → hardcoded bucket → shared `rates_src`/`origin_src`/`dest_src`.

**New behavior**:

1. Build section boundaries from all tabs' `sectionStartHint` values.
2. For each tab, find its boundary → get the corresponding text region.
3. Run `_legacy_extract_tables()` scoped to that text region (or filter legacy rows by page range that falls within the boundary).
4. Each tab gets **only the rows from its scoped region**.

```python
def extract_tables_from_schema(doc, header, schema_preset):
    if not _is_contract_biased_schema(schema_preset):
        return _extract_generic_from_schema(doc, schema_preset)

    full_text = "\n".join(doc[i].get_text("text") for i in range(len(doc)))
    tabs_config = schema_preset.get("tabs", [])

    # Check if any tab has sectionStartHint — if yes, use scoped extraction
    has_hints = any(
        (t.get("sectionStartHint") or "").strip()
        for t in tabs_config
    )

    if has_hints:
        return _extract_scoped_from_schema(doc, header, schema_preset, full_text)

    # Fallback to existing behavior when no hints are provided
    # ... (existing code)
```

#### 6c. New function: `_extract_scoped_from_schema()`

```python
def _extract_scoped_from_schema(doc, header, schema_preset, full_text):
    """
    Section-scoped extraction: each tab only sees the PDF text
    between its sectionStartHint and the next tab's hint.
    """
    tabs_config = schema_preset.get("tabs", [])
    boundaries = _build_section_boundaries(full_text, tabs_config)
    pdf_pages = [doc[i].get_text("text") for i in range(len(doc))]
    legacy_header = _legacy_extract_header(doc)
    warnings = []
    tabs_out = []

    for tab in tabs_config:
        tab_name = (tab.get("name") or "Tab").strip()
        fields = tab.get("fields", [])

        # Find this tab's text boundary
        scoped_text = full_text  # fallback
        for bname, bstart, bend in boundaries:
            if bname == tab_name:
                scoped_text = full_text[bstart:bend]
                break

        # Extract tables from the scoped text region
        tab_rows = _extract_rows_from_text(
            scoped_text, full_text, pdf_pages,
            fields, legacy_header, warnings
        )

        if not tab_rows:
            # Fallback: one empty row
            tab_rows = [{
                f.get("fieldKey", ""): ""
                for f in fields if f.get("fieldKey", "").strip()
            }]

        tabs_out.append({"name": tab_name, "rows": tab_rows})

    # For backward compat, first 3 tabs map to rates/origin/dest
    rates = tabs_out[0]["rows"] if len(tabs_out) > 0 else []
    origin_arbs = tabs_out[1]["rows"] if len(tabs_out) > 1 else []
    dest_arbs = tabs_out[2]["rows"] if len(tabs_out) > 2 else []
    return rates, origin_arbs, dest_arbs, tabs_out, warnings
```

#### 6d. Update `_extract_generic_from_schema()` similarly

Apply the same section boundary logic. When `sectionStartHint` is present on tabs, scope each tab's chunks to its boundary region instead of searching the entire `full_text`.

---

### 7. Schema Preset JSON Serialization

**File**: `src/main/nest/contract-extraction/contract-extraction.service.ts`

Ensure `sectionStartHint` is included when serializing the schema preset to pass to the Python sidecar via `--schema-json`. The service already passes the full preset object via `JSON.stringify(schemaPreset)`, so as long as the DB query includes the field, it should flow through automatically.

Verify the Prisma query in the service includes `sectionStartHint` in the `select` or includes it by default.

---

### 8. `_parse_schema_preset()` in Python

**File**: `src/main/python/pdf_contract_extract.py`

Update `_parse_schema_preset()` to preserve `sectionStartHint` at the tab level when parsing the incoming JSON:

```python
tab_obj = {
    "name": str(tab.get("name", "Tab")).strip(),
    "sectionStartHint": str(tab.get("sectionStartHint", "")).strip(),  # ← NEW
    "fields": parsed_fields,
}
```

---

## Fuzzy Matching Strategy

The `_build_section_boundaries()` function should handle human error gracefully:

1. **Exact case-insensitive** match first: `re.search(re.escape(hint), text, re.IGNORECASE)`
2. **Whitespace-normalized** fallback: collapse multiple spaces/newlines in hint to `\s+`
3. **Partial word match** fallback: if hint is "General Rate", try matching "general\s+rate" without requiring exact surrounding text
4. **Warning on no match**: If a hint can't be found, log a warning and fall back to full text for that tab (don't silently fail)

---

## Non-Overlapping Guarantee

Section boundaries are determined by document order, not tab order in the schema:

```
PDF Document:
  ┌─────────────────────────────────────┐
  │ ... preamble text ...               │
  │                                     │
  │ 6-1. General Rate                   │  ← "Rates" tab starts here
  │ ┌───────────────────────────────┐   │
  │ │ rate table rows...            │   │
  │ └───────────────────────────────┘   │
  │                                     │
  │ 6-2. Special Rate                   │  ← "Special Rates" tab starts here
  │ ┌───────────────────────────────┐   │    (Rates region ENDS here)
  │ │ special rate rows...          │   │
  │ └───────────────────────────────┘   │
  │                                     │
  │ 6-3. Origin Arbitrary               │  ← "Origin Arb" tab starts here
  │ ┌───────────────────────────────┐   │    (Special Rates region ENDS here)
  │ │ origin arb rows...           │   │
  │ └───────────────────────────────┘   │
  └─────────────────────────────────────┘
```

Each tab only extracts from its own region. No overlap.

---

## Implementation Order

1. **Database migration** — add `section_start_hint` column
2. **Backend DTO/service** — persist and return `sectionStartHint`
3. **Frontend types** — update `SchemaPresetTab`, `SchemaPresetTabPayload`
4. **SchemaBuilderDialog UI** — add hint input, rename labels
5. **SessionsHome.tsx** — pass `sectionStartHint` through save/update
6. **Python `_parse_schema_preset()`** — preserve hint at tab level
7. **Python `_build_section_boundaries()`** — new helper
8. **Python `extract_tables_from_schema()`** — integrate scoped extraction
9. **Python `_extract_generic_from_schema()`** — integrate scoped extraction
10. **Test** — create a schema with 2+ tabs with different hints, verify each tab gets only its region's rows

---

## UI Rename Summary

| Location | Old | New |
|---|---|---|
| Sidebar header text | "Sections" | "Tabs" |
| Add button | "Add Section" | "+ Tab" |
| Inline edit placeholder | "Section name" | "Tab name" |
| Field-level `sectionHint` | Keep as-is | Keep as-is (separate concept) |

**Note**: The field-level `sectionHint` (on `SchemaPresetField`) stays unchanged — it still serves as a per-field hint for legacy bucket routing when no tab-level `sectionStartHint` is provided. The new tab-level `sectionStartHint` takes priority when present.
