

# Batch Upload System for Large CSV Files

## The Problem

The current upload processes everything in a single browser-side operation and a single database call. This works for files under ~10K rows but will crash for 100K+.

## Changes Required

### 1. Batch the Database Upsert

**File: `src/hooks/useFreeData.ts`**

Replace the single `.upsert()` call with a chunked loop:
- Split records into batches of 1,000
- Upsert each batch sequentially
- Track progress (0% to 100%) via a callback
- If any batch fails, report which batch and continue or stop

### 2. Add Progress UI to Upload Dialog

**File: `src/components/admin/FreeDataTab.tsx`**

- Add a progress bar (using existing Progress component) during upload
- Show "Uploading batch 3 of 47... (6,000 / 47,000 records)"
- Disable the Cancel button during upload to prevent data corruption
- Show final summary: "47,000 records uploaded, 3,200 companies extracted"

### 3. Stream CSV Parsing for Large Files

**File: `src/lib/csvImportMapper.ts`**

PapaParse (already installed) supports streaming mode. For files over 50K rows:
- Use `Papa.parse(file, { step: ... })` instead of loading everything into memory
- Count rows during stream to show file size before mapping
- Only load first 1,000 rows for the mapping preview step
- Process remaining rows in chunks during upload

## Technical Details

### Batch Upload Flow

```text
User selects 100K row CSV
  |
  v
Parse first 1,000 rows for preview/mapping (fast, <1 second)
  |
  v
User maps fields, clicks Upload
  |
  v
Stream-parse full CSV in chunks of 1,000 rows
  For each chunk:
    1. Transform rows using field mappings
    2. Generate deterministic IDs
    3. Extract companies
    4. Upsert people batch to free_data
    5. Upsert company batch to free_data
    6. Update progress bar
  |
  v
Show summary: "100,000 people + 23,000 companies uploaded"
```

### Batch Size Rationale

- 1,000 records per batch keeps each request under 2MB payload
- Each batch takes ~1-2 seconds to upsert
- 100K records = ~100 batches = ~2-3 minutes total
- Progress bar updates every batch so user sees movement

## Files Changed

1. `src/hooks/useFreeData.ts` -- Add batched upload with progress callback
2. `src/components/admin/FreeDataTab.tsx` -- Add progress bar UI during upload
3. `src/lib/csvImportMapper.ts` -- Add streaming parse option for large files

## What This Enables

- Upload 100K+ records without browser crashes
- Clear progress feedback during long uploads
- Foundation for million-record uploads in the future
- No database or schema changes needed

