

# Simplify Sales Knowledge CSV Import to Always Extract Title + Stats

## What Changes

The current import flow has two paths: a "stats detection" path and an "AI mapping" fallback. This overcomplicates things. Every CSV uploaded to the Sales Knowledge import is campaign stats data, so the flow should always be:

1. Upload CSV
2. System finds the campaign name column (used as title)
3. System pulls all numeric columns as metrics
4. Auto-generates a readable content summary
5. Shows preview -- user confirms import

No AI analysis, no manual mapping screen. The mapping step is removed entirely.

## Technical Changes

### 1. Simplify `src/lib/statsCSVDetector.ts`

- Remove the conditional detection logic (the "return null if not stats" path)
- `detectStatsCSV` always returns a config: it finds the best name column (or falls back to the first text column), and classifies all other columns as numeric or text
- `transformStatsRows` stays the same -- it already does the right thing

### 2. Simplify `src/components/admin/SalesKnowledgeImportDialog.tsx`

- Remove the `'mapping'` step entirely from the flow -- it goes from `'upload'` straight to `'preview'`
- Remove all the column-mapping UI code (the dropdowns, AI analysis trigger, global category selector, etc.)
- After parsing the CSV, always run `detectStatsCSV` + `transformStatsRows` and jump to preview
- Remove the `analyzeCSV` call -- the edge function is never needed here
- Remove the "Edit Mapping" fallback button
- Keep the preview table and import button as-is

### 3. No other files change

- The `useAdminSalesKnowledge` hook stays the same (bulkCreateEntries is still used)
- The edge function `analyze-csv-knowledge` stays deployed (other features may use it later)
- The `statsCSVDetector.ts` utility functions stay in their own file

## Result

The dialog becomes much simpler: a file picker, then a preview table showing what will be imported (title, metrics summary, category), then an import button. Three screens become two.

