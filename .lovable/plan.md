

# CSV Bulk Import for Sales Knowledge Base

## Overview

Add a CSV import capability to the Sales Knowledge tab so admins can mass-upload training data from a spreadsheet. This reuses the existing CSV parsing library (PapaParse) already in the project.

## How It Works

1. Admin clicks "Import CSV" button (next to "Add Entry")
2. Selects a CSV file with columns matching knowledge entry fields
3. Preview shows parsed entries with validation
4. Admin confirms and all entries are bulk-inserted into `sales_knowledge`

## Expected CSV Format

```text
category,title,content,tags,reply_rate,sent,source_campaign
email_template,"Cold Intro for SaaS CTOs","Hey {{firstName}}, noticed your company...",saas;cto;cold-outreach,12,2400,Healthcare Q1
sales_guideline,"Subject Line Best Practices","Never use 'hope this finds you well'...",email;subject-lines,,,
campaign_result,"Healthcare Outreach Results","2400 sent, 9.2% reply rate...",healthcare;outreach,9.2,2400,Healthcare Outreach Q1
audience_insight,"Fintech Director Converts 3x","Director-level in fintech 51-200...",fintech;director,,,
```

- **category** (required): must be one of `email_template`, `sequence_playbook`, `campaign_result`, `sales_guideline`, `audience_insight`
- **title** (required): entry title
- **content** (required): the actual copy, playbook, or learning (markdown supported)
- **tags** (optional): semicolon-separated list (`;`) since commas conflict with CSV
- **reply_rate** (optional): numeric, stored in metrics JSON
- **sent** (optional): numeric, stored in metrics JSON
- **source_campaign** (optional): campaign name

## Technical Details

### New File: `src/components/admin/SalesKnowledgeImportDialog.tsx`

A dialog component that:
1. Accepts a CSV file via drag-and-drop or file picker
2. Parses it with PapaParse (already installed)
3. Validates each row:
   - `category` must be one of the 5 valid values
   - `title` and `content` must be non-empty
   - Tags are split by `;` into an array
   - `reply_rate` and `sent` are parsed into a `metrics` JSON object
4. Shows a preview table with valid/invalid row counts
5. On confirm, bulk-inserts all valid rows into `sales_knowledge`

### Modified File: `src/components/admin/SalesKnowledgeTab.tsx`

- Add an "Import CSV" button in the toolbar (next to "Add Entry")
- Wire it to open the import dialog

### Modified File: `src/hooks/useAdminSalesKnowledge.ts`

- Add a `bulkCreateEntries` mutation that inserts multiple rows in a single Supabase call

### UI Layout

```text
Toolbar:
[+ Add Entry] [Import CSV]  Filter: [All Categories v] [Search...]

Import Dialog:
+------------------------------------------------+
| Import Sales Knowledge from CSV                 |
|                                                |
| [Drag & drop CSV here or click to browse]      |
|                                                |
| Preview: 24 valid entries, 2 invalid            |
| +--------------------------------------------+ |
| | # | Category       | Title          | OK?  | |
| | 1 | email_template | Cold Intro...  | Yes  | |
| | 2 | (invalid)      | Missing title  | No   | |
| | 3 | sales_guide... | Subject Lines  | Yes  | |
| +--------------------------------------------+ |
|                                                |
| [Cancel]              [Import 24 Entries]      |
+------------------------------------------------+
```

## What Does NOT Change

- Existing "Add Entry" manual flow -- untouched
- Database schema -- no changes needed, reuses existing `sales_knowledge` table
- Other Admin tabs -- untouched

## Sequencing

1. Add `bulkCreateEntries` mutation to `useAdminSalesKnowledge.ts`
2. Create `SalesKnowledgeImportDialog.tsx` with parse, validate, preview, and import
3. Add "Import CSV" button to `SalesKnowledgeTab.tsx` toolbar

