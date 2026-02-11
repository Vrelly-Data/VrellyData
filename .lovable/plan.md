

# Smart Import for Sales Knowledge Base

## Overview

Upgrade the CSV import to handle **any CSV structure** by adding an AI-powered analysis step. The system will send the CSV headers and sample rows to an AI model, which will intelligently map the data to knowledge entries. Admins can review and override the AI's mapping before importing.

The Doc Import already works with any file -- no changes needed there.

## How It Works

### CSV Import (Upgraded Flow)

1. Admin uploads any CSV file (no required column format)
2. PapaParse extracts headers + first 5 sample rows
3. These are sent to a new edge function (`analyze-csv-knowledge`) that calls the AI
4. The AI returns a mapping: which columns map to `title`, `content`, `category`, `tags`, `metrics`, and `source_campaign`
5. The admin sees the AI-suggested mapping in a **mapping review step** with dropdowns to override
6. Once confirmed, all rows are transformed using the mapping and bulk-inserted

### Example: Non-Standard CSV

```text
CSV columns: Subject, Body, Campaign, Open Rate, Reply Rate, Industry

AI mapping result:
  title        -> "Subject"
  content      -> "Body"
  category     -> "email_template" (inferred from Subject/Body pattern)
  source_campaign -> "Campaign"
  tags         -> "Industry" (values become tags)
  metrics      -> { open_rate: "Open Rate", reply_rate: "Reply Rate" }
```

### Fallback: Manual Mapping

If AI analysis fails or the admin prefers manual control, they can skip the AI step and manually assign columns via dropdowns (same mapping UI, just without pre-filled suggestions).

## Technical Details

### New Edge Function: `supabase/functions/analyze-csv-knowledge/index.ts`

- Receives: `{ headers: string[], sampleRows: Record<string, string>[], rowCount: number }`
- Calls Lovable AI (Gemini Flash) with a structured prompt asking it to map CSV columns to the knowledge schema
- Returns: `{ mapping: { title: string, content: string, category: string | null, tags: string | null, metrics: Record<string, string> | null, source_campaign: string | null }, suggestedCategory: KnowledgeCategory }`
- Protected: requires authenticated admin user

### Modified: `src/components/admin/SalesKnowledgeImportDialog.tsx`

Complete rework with a multi-step flow:

```text
Step 1: Upload CSV
  [Drop or select any CSV file]

Step 2: AI Analysis + Mapping Review
  AI suggested mapping:
  Title column:           [Subject        v]
  Content column:         [Body           v]
  Category:               [Email Template v]  (or per-row from column)
  Tags column:            [Industry       v]  (optional)
  Source Campaign column: [Campaign       v]  (optional)
  Metrics columns:        [Open Rate] [Reply Rate]  (optional)

  [Skip AI / Map Manually]    [Apply Mapping]

Step 3: Preview + Confirm
  Preview: 24 valid entries, 2 invalid
  [table preview]
  [Cancel]  [Import 24 Entries]
```

### Modified: `src/hooks/useAdminSalesKnowledge.ts`

- Add `analyzeCSV` async function that calls the edge function
- No mutation needed -- it's a read-only analysis call

## What Does NOT Change

- Doc Import -- already handles any file format
- Manual "Add Entry" -- untouched
- Database schema -- no changes
- Other Admin tabs -- untouched

## Sequencing

1. Create the `analyze-csv-knowledge` edge function (AI analysis)
2. Rework `SalesKnowledgeImportDialog.tsx` into a multi-step flow with mapping review
3. Add the `analyzeCSV` helper to the hook
4. Test with various CSV formats

