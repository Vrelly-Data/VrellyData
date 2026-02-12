

# Add XLSX Import Support to Sales Knowledge

## Overview

Add support for `.xlsx` (Excel) file imports alongside the existing CSV import in the Admin Sales Knowledge section. This requires adding a lightweight XLSX parsing library and updating the import dialog to handle both file types.

## Changes

### 1. Install `xlsx` (SheetJS) library

Add the `xlsx` package which provides browser-side Excel file parsing. It's lightweight and has no dependencies.

### 2. Update `SalesKnowledgeImportDialog.tsx`

- Change the file `accept` attribute from `.csv` to `.csv,.xlsx,.xls`
- Update the label text to mention Excel files
- Add logic to detect the file extension:
  - If `.csv` -- use the existing PapaParse flow
  - If `.xlsx` or `.xls` -- use the `xlsx` library to read the first sheet, convert it to a JSON array of objects (same format PapaParse produces), then pass it through the same `detectStatsCSV` and `transformStatsRows` pipeline

### 3. No other files change

The `statsCSVDetector.ts` aggregation logic works on plain `Record<string, string>[]` arrays, so it doesn't care whether the data came from CSV or Excel. The preview table, import button, and hook all remain the same.

## Technical Details

```text
handleFile(file: File)
  |
  +--> if .csv  --> Papa.parse(file) --> results.data
  |                                         |
  +--> if .xlsx --> XLSX.read(buffer) ------+
       sheet_to_json(firstSheet)            |
                                            v
                              detectStatsCSV(headers, data)
                              transformStatsRows(data, config)
                                            |
                                            v
                                    setTransformedRows(...)
```

The xlsx parsing snippet:

```text
import * as XLSX from 'xlsx';

const buffer = await file.arrayBuffer();
const workbook = XLSX.read(buffer, { type: 'array' });
const sheet = workbook.Sheets[workbook.SheetNames[0]];
const data = XLSX.utils.sheet_to_json<Record<string, string>>(sheet, { defval: '' });
const headers = Object.keys(data[0] || {});
```

