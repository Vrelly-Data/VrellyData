

# Fix Sales Knowledge CSV Import for Stats Data

## Problem

The Sales Knowledge CSV import forces stats CSVs into a schema that doesn't fit. A stats CSV has columns like "Campaign Name", "Delivered count", "Replied count" — there's no "Content" column. The AI mapper tries to force-fit these and produces nonsensical mappings.

## Solution

Add a **smart stats detection** layer to the import flow. When the system detects a stats-style CSV (lots of numeric columns, campaign name column), it should:

1. Skip the manual mapping step entirely
2. Auto-detect the campaign name column as the "title"
3. Auto-detect all numeric columns as metrics
4. Auto-generate the "content" field as a human-readable summary of the metrics
5. Jump straight to the preview step

This means uploading a stats CSV becomes: **upload file -> see preview -> confirm import**. No mapping needed.

## How It Works

After parsing the CSV, before triggering the AI analysis, run a local detection check:

- Count how many columns have predominantly numeric values
- Look for a column matching common campaign name patterns ("campaign", "sequence", "name")
- If more than 50% of columns are numeric AND a campaign name column is found, treat it as a stats CSV

For each row in a detected stats CSV, auto-generate:
- **Title**: `"{Campaign Name} - Performance Baseline (Feb 2026)"`
- **Content**: A readable summary like `"Channel: Email | Delivered: 54 | Opens: 12 | Replies: 3 | Reply Rate: 5.6%"`
- **Category**: `campaign_result` (auto-set)
- **Metrics**: All numeric columns stored as structured JSONB
- **Tags**: Extracted from non-numeric, non-name columns (e.g., industry, channel)

## Technical Details

### Modified: `src/components/admin/SalesKnowledgeImportDialog.tsx`

Add a `detectStatsCSV()` function that runs after parsing:

```text
function detectStatsCSV(headers, data):
  - Find campaign name column (fuzzy match: "campaign", "sequence name", "name")
  - Count numeric columns (check first 5 rows for numeric values)
  - If numericColumns > 50% AND nameColumn found:
    return { isStats: true, nameColumn, numericColumns, textColumns }
```

When stats CSV is detected:
- Skip the AI analysis call (no need for the edge function)
- Auto-transform each row into a `SalesKnowledgeInsert`
- Set step directly to `'preview'` instead of `'mapping'`

Add a `transformStatsRow()` function:

```text
function transformStatsRow(row, config):
  - title = row[nameColumn] + " - Performance Baseline"
  - metrics = { col1: value1, col2: value2, ... } for all numeric columns
  - Calculate derived rates (replyRate = replies/delivered * 100)
  - content = generate readable summary from metrics
  - category = 'campaign_result'
  - tags = values from non-numeric text columns (industry, channel type, etc.)
  return SalesKnowledgeInsert
```

The existing mapping flow remains available as a fallback. If auto-detection is wrong, the user can click "Edit Mapping" to go back to the manual mapping step (existing UI).

### Modified: `supabase/functions/analyze-csv-knowledge/index.ts`

No changes needed — the edge function is simply bypassed for stats CSVs, saving an API call.

## User Experience

```text
Current flow (broken for stats):
  Upload CSV -> AI Analysis -> Manual Mapping (confusing) -> Preview -> Import

New flow (stats detected):
  Upload CSV -> Auto-detect stats -> Preview (ready to go) -> Import
  
  With an "Edit Mapping" escape hatch if detection is wrong.
```

## What stays the same

- Non-stats CSVs (email templates, playbooks, guidelines) still go through the existing AI mapping flow
- The manual mapping UI is unchanged and available via "Edit Mapping"
- The preview and import steps work exactly as before
