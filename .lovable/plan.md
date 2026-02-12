

# Multi-Sheet XLSX Import Support

## Problem

The current XLSX import only reads the first sheet (`workbook.SheetNames[0]`). When the file contains multiple tabs, data from other sheets is ignored.

## Solution

Add a **sheet selector step** between upload and preview. When an XLSX file with multiple sheets is detected, the user picks which sheet to import. Single-sheet files skip straight to preview (current behavior).

## Changes

### `src/components/admin/SalesKnowledgeImportDialog.tsx`

1. **Add a new step** `'select-sheet'` to the `Step` type: `'upload' | 'select-sheet' | 'preview'`

2. **Add state** for the parsed workbook and sheet names:
   - `workbook: XLSX.WorkBook | null`
   - `sheetNames: string[]`
   - `selectedSheet: string`

3. **Update `handleFile`** for XLSX:
   - Parse the workbook and store it in state
   - If only 1 sheet, process it immediately (current behavior)
   - If multiple sheets, transition to `'select-sheet'` step

4. **Add sheet selector UI** (new step between upload and preview):
   - Show a list of sheet names as selectable buttons or a dropdown
   - "Continue" button processes the selected sheet through `processData`

5. **Update `reset`** to clear workbook/sheet state

6. **Update dialog title** to reflect the new step

### No other files change

The `processData`, `detectStatsCSV`, and `transformStatsRows` pipeline stays the same -- only the source sheet selection is new.

## UI Flow

```text
Upload file
    |
    +--> CSV ---------------------> Preview & Confirm
    |
    +--> XLSX (1 sheet) ----------> Preview & Confirm
    |
    +--> XLSX (multiple sheets)
              |
              v
         Select Sheet (dropdown + Continue button)
              |
              v
         Preview & Confirm
```

