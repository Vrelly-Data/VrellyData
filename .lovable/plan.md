

# Fix CSV/XLSX Campaign Stats Import

## Root Cause

The column detector in `statsCSVDetector.ts` has a pattern `/^sequence/i` that greedily matches **"Sequence ID"** before it ever sees **"Sequence Name"**. This is because `findCol()` iterates headers in order and returns the first match against any pattern.

## Fix 1: Smarter column matching (`src/lib/statsCSVDetector.ts`)

**Change `findCol()` to iterate patterns first, then headers.** This gives priority to more specific patterns (like "Sequence Name") over broad ones (like anything starting with "Sequence").

```text
Current (broken):   for each HEADER -> check all patterns -> return first header that matches
Fixed:              for each PATTERN -> check all headers -> return first match of best pattern
```

**Reorder and tighten NAME_PATTERNS** to prioritize exact name columns:

```text
Before:  /^campaign/i, /^sequence/i, /^name$/i, /^campaign[\s_-]?name/i, /^sequence[\s_-]?name/i
After:   /^campaign[\s_-]?name/i, /^sequence[\s_-]?name/i, /^name$/i, /^campaign$/i, /^sequence$/i
```

The broad `/^campaign/i` and `/^sequence/i` become exact-match `/^campaign$/i` and `/^sequence$/i` so they no longer grab "Sequence ID" or "Campaign ID".

## Fix 2: Add "Import All Sheets" for XLSX (`src/components/admin/SalesKnowledgeImportDialog.tsx`)

Add a `processAllSheets` function and an **"Import All Sheets"** button to the sheet-selector step so users can batch-import every tab at once. Each sheet is independently parsed and all resulting campaign entries are combined into one preview.

## Files Changed

- `src/lib/statsCSVDetector.ts` -- fix `findCol` loop order + tighten NAME_PATTERNS
- `src/components/admin/SalesKnowledgeImportDialog.tsx` -- add "Import All Sheets" button + `processAllSheets` logic

## Expected Result with Your Headers

- **Name column**: "Sequence Name" (correct)
- **Numeric columns**: People, Deliveries, Contacted, Opened, Open Rate, Email Replied, Email Reply Rate, LI Connections, LI Conn Rate, LI Replies, LI Reply Rate, LI Deliveries, Combined Replies, Combined Reply Rate, Combined Deliveries, Finished Rate, Score
- **Text columns**: Client, Status, Created Date
- **One entry per row**, titled like: `"Healthcare CTO Outreach - Performance Baseline (Feb 2026)"`

