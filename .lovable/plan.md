

# Fix: CSV Column Mapping Display and Validation

## Problem

The mapping step doesn't clearly show the actual CSV column titles and their data. Users can't verify whether the AI mapped correctly because:

1. There's no preview of the CSV data alongside the mapping dropdowns
2. If the AI returns a column name that doesn't exactly match a CSV header (e.g., "open rate" vs "Open Rate"), the Select silently falls back to `NONE`
3. The mapping labels ("Title column", "Content column") describe the target fields but don't show what CSV data will fill them

## Solution

### File: `src/components/admin/SalesKnowledgeImportDialog.tsx`

**1. Add a CSV data preview table above the mapping section**

Show the first 3 rows of raw CSV data so users can see their column titles and sample values before mapping. This goes between the file info bar and the mapping controls in the `mapping` step.

```text
| Subject Line         | Body Text          | Campaign      | Open Rate | Reply Rate |
| "Hey {{first_name}}" | "I noticed your…"  | Healthcare Q1 | 42.5      | 12.3       |
| "Quick question"     | "We help teams…"   | SaaS Outreach | 38.1      | 9.7        |
```

**2. Validate AI-returned column names against actual headers (case-insensitive)**

After receiving the AI mapping, validate each returned column name against the actual CSV headers using case-insensitive matching. If "open rate" is returned but the CSV has "Open Rate", resolve it to "Open Rate".

```typescript
function resolveHeader(aiValue: string | null, csvHeaders: string[]): string | null {
  if (!aiValue) return null;
  // Exact match first
  if (csvHeaders.includes(aiValue)) return aiValue;
  // Case-insensitive match
  const lower = aiValue.toLowerCase().trim();
  const match = csvHeaders.find(h => h.toLowerCase().trim() === lower);
  return match || null;
}
```

Apply this to every field in the sanitized mapping (title, content, tags, sourceCampaign, categoryColumn, and each metric column).

**3. Show sample values next to each mapping dropdown**

Update `MappingRow` to accept and display a sample value from the first row of data, so users can see what data will be imported for each field:

```text
Title column *    [Subject Line  v]    Preview: "Hey {{first_name}}"
Content column *  [Body Text     v]    Preview: "I noticed your company…"
Tags column       [— None —     v]
```

**4. Fix the fallback default category**

Change the fallback default category from `email_template` to `campaign_result` (line 194), since campaign stats is the primary use case.

## No Other Files Change

- Edge function, hook, database, and doc import remain unchanged.

