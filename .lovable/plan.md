

# Import Document Feature for Sales Knowledge Base

## Overview

Add an "Import Doc" button alongside the existing "Import CSV" button in the Sales Knowledge toolbar. This lets admins upload PDF or text files (e.g., campaign playbooks, email sequences, sales decks) that get converted into knowledge entries. Each document becomes a single knowledge entry where the admin provides a title (campaign name), selects a category, and the file content is extracted and stored.

## How It Works

1. Admin clicks "Import Doc" in the toolbar
2. A dialog opens where they can:
   - Upload a `.txt`, `.md`, or `.pdf` file
   - Enter a **title** (campaign name for correlation)
   - Select a **category** (email template, campaign result, etc.)
   - Add optional **tags** and **source campaign**
3. For text/markdown files: content is read directly via the browser's FileReader API
4. For PDFs: content is extracted client-side using the `pdf.js` library (lightweight, no backend needed)
5. A preview of the extracted text is shown
6. Admin confirms and the entry is saved to `sales_knowledge`

## Why Campaign-Named Titles Matter

By titling documents with campaign names, the AI can later cross-reference:
- Campaign stats from `synced_campaigns` (reply rates, open rates)
- Email copy from `synced_sequences`
- The knowledge entry content (playbooks, learnings, guidelines)

This creates a connected dataset the LLM can draw from when revamping copy or suggesting audiences.

## Technical Details

### New Dependency

- `pdfjs-dist` -- Mozilla's PDF.js library for client-side PDF text extraction. Lightweight, no server needed.

### New File: `src/components/admin/SalesKnowledgeDocImportDialog.tsx`

A dialog component that:
1. Accepts `.txt`, `.md`, or `.pdf` files via file picker
2. Extracts text content:
   - **TXT/MD**: Uses `FileReader.readAsText()`
   - **PDF**: Uses `pdfjs-dist` to extract text from each page
3. Shows a preview of extracted content (first ~500 chars)
4. Requires admin to fill in: title (campaign name), category, optional tags
5. On confirm, creates a single `sales_knowledge` entry with the full document content

### Modified File: `src/components/admin/SalesKnowledgeTab.tsx`

- Add an "Import Doc" button in the toolbar (between "Import CSV" and the category filter)
- Add state + dialog wiring for the doc import dialog

### No Database Changes

Reuses the existing `sales_knowledge` table. Document content goes into the `content` text column (which already supports markdown/long text).

### UI Layout

```text
Toolbar:
[+ Add Entry] [Import CSV] [Import Doc]  Filter: [All Categories v] [Search...]

Import Doc Dialog:
+------------------------------------------------+
| Import Document                                 |
|                                                |
| File: [Choose .txt, .md, or .pdf]              |
| Selected: campaign_playbook.pdf (3 pages)      |
|                                                |
| Title (Campaign Name):                         |
| [Healthcare Outreach Q1_________________]      |
|                                                |
| Category: [Campaign Result          v]         |
|                                                |
| Tags: [healthcare] [outreach] [+ add]          |
|                                                |
| Source Campaign: [optional______________]       |
|                                                |
| Content Preview:                                |
| +--------------------------------------------+ |
| | "This campaign targeted 2,400 healthcare   | |
| | decision-makers across Series B+ companies | |
| | with a 5-step email sequence..."           | |
| +--------------------------------------------+ |
|                                                |
| [Cancel]              [Save as Entry]          |
+------------------------------------------------+
```

## What Does NOT Change

- Existing CSV import -- untouched
- Manual "Add Entry" flow -- untouched
- Database schema -- no changes needed
- Other Admin tabs -- untouched

## Sequencing

1. Install `pdfjs-dist` dependency
2. Create `SalesKnowledgeDocImportDialog.tsx` with file reading, PDF parsing, and preview
3. Add "Import Doc" button to `SalesKnowledgeTab.tsx` toolbar and wire the dialog

