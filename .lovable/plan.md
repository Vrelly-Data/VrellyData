

# Flip the Mapping: CSV Columns First

## Problem

The current mapping UI shows abstract target fields ("Title column", "Content column", "Tags column") and asks you to pick CSV columns for each. This is confusing because you don't know what those target fields mean or why they matter. You just uploaded a CSV and want to map YOUR columns.

## Solution

Replace the current mapping UI with the same pattern used in the Platform Data field mapper (`PlatformDataFieldMapper.tsx`): list every CSV column from your upload, show sample data, and give each one a dropdown of target fields to map to.

### What You'll See

```text
Map CSV Columns                                    [12 of 15 mapped]

Your CSV Column              Sample Data                    Map To
---------------------------------------------------------------------------
Sequence                     "LI Only Sequence V1..."       [Title          v]
Action Type                  "Sent auto connection"         [Content        v]
Sender LinkedIn Account      "Acacia Parks PhD..."          [Tags           v]
Connection Status            "Accepted"                     [Skip           v]
Open Rate                    "42.5"                         [Metric: open_rate v]
Reply Rate                   "12.3"                         [Metric: reply_rate v]
...
```

Each row is one of YOUR CSV columns. The dropdown options are the sales knowledge target fields:

- Skip this column
- Title
- Content
- Tags
- Source Campaign
- Category
- Metric (prompts for metric name like "open_rate")

### Technical Changes

**File: `src/components/admin/SalesKnowledgeImportDialog.tsx`**

1. **Replace the current mapping section** (the MappingRow-based UI) with a CSV-columns-first layout modeled on `PlatformDataFieldMapper`:
   - List every CSV column header as a row
   - Show sample values from the first 2 data rows
   - Each row gets a dropdown with the sales knowledge target fields
   - Mapped rows get green styling; unmapped rows are dimmed
   - An X button to clear a mapping

2. **Define the target fields list** for the dropdown:
   - `skip` -- Skip this column (default)
   - `title` -- Title (required, only one column can map here)
   - `content` -- Content (required, only one column can map here)  
   - `category` -- Category
   - `tags` -- Tags
   - `source_campaign` -- Source Campaign
   - `metric` -- Metric (when selected, prompt for metric name like "open_rate", "reply_rate")

3. **Add a global category selector** above or below the column list (since category often applies to all rows, not a specific column). Keep the option to also map a column to category if the CSV has one.

4. **Update the AI analysis result handler** to translate the AI's response into this new column-first format. The AI still returns which CSV columns map to which fields -- we just display it differently.

5. **Keep the existing `transformRow` logic** -- the underlying ColumnMapping interface stays the same, only the UI changes. The new column-first UI writes to the same `mapping` state object.

6. **Remove the old `MappingRow` component** since it's no longer needed.

7. **Validation**: Show a badge like "2 of 15 mapped" and require at least Title and Content to be mapped before allowing preview.

### No other files change

- Edge function, hook, database, and doc import all stay the same
- The `PlatformDataFieldMapper` is not modified -- we just follow its pattern

