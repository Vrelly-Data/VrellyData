
## Fix: CSV Import for Knowledge Base Entries (Guidelines, Insights, Playbooks)

### Root Cause

The Import CSV button in the Sales Knowledge tab routes everything through `statsCSVDetector.ts`, which is designed exclusively for **campaign activity logs** — it looks for sequence names, action types, and numeric metrics. It has no awareness of the knowledge-base schema columns (`category`, `title`, `content`, `tags`, `source_campaign`).

When you uploaded your guidelines and insights CSV with headers `category | title | content | tags | source_campaign | reply_rate | sent`, the detector:
1. Found no matching campaign-name column (none of the patterns matched `title` as a name column)
2. Treated `category`, `title`, `content`, `tags`, `source_campaign` as text columns and ignored them
3. Treated `reply_rate` and `sent` as the only meaningful data (numeric cols)
4. Generated broken/empty entries

### What Needs to Change

The fix has two parts:

**Part 1: Add a Knowledge Base CSV detection path to `statsCSVDetector.ts`**

Add a `detectKnowledgeBaseCSV` function that checks whether a CSV looks like a KB schema file (has a `title` AND `content` column). If detected, use a completely different transform path:

```ts
// Detection: check for KB schema columns
export function isKnowledgeBaseCSV(headers: string[]): boolean {
  const normalized = headers.map(h => h.toLowerCase().trim());
  const hasTitle = normalized.some(h => h === 'title');
  const hasContent = normalized.some(h => h === 'content');
  return hasTitle && hasContent;
}
```

The `transformKnowledgeBaseRows` function maps rows directly using robust column matching:

- `category` column → map to valid `KnowledgeCategory` (case-insensitive, handle "Sales Guideline" → `sales_guideline`, "Audience Insight" → `audience_insight`, etc.)
- `title` column → `title`
- `content` column → `content`
- `tags` column → split on commas or semicolons → `tags[]`
- `source_campaign` column → `source_campaign`
- `reply_rate` + `sent` (and any other numeric columns) → stored in `metrics`
- Rows missing `title` OR `content` are marked invalid

Column matching uses normalized comparison (lowercase + trim) to handle spacing variations.

**Category mapping (case-insensitive fuzzy match):**

| CSV value | Stored as |
|---|---|
| "Sales Guideline" | `sales_guideline` |
| "Audience Insight" | `audience_insight` |
| "Email Template" | `email_template` |
| "Sequence Playbook" | `sequence_playbook` |
| "Campaign Result" | `campaign_result` |
| Any unknown value | defaults to `sales_guideline` |

**Part 2: Update `SalesKnowledgeImportDialog.tsx` to use the new path**

In `processData`, check `isKnowledgeBaseCSV(headers)` first. If true, use `transformKnowledgeBaseRows`. Otherwise, fall back to the existing `detectStatsCSV` / `transformStatsRows` path (preserving all existing campaign stats behavior).

Also update the upload UI hint text to make clear both formats are supported:
- Current: "Drop or select a CSV or Excel file with campaign stats — we'll extract the title and metrics"
- New: "Drop or select a CSV with campaign stats OR knowledge base entries (category, title, content columns)"

And update the preview table toast message to distinguish:
- Campaign stats: "Found X campaign results"
- KB entries: "Found X knowledge base entries (guidelines, insights, etc.)"

### What Your CSV Produces After the Fix

For each of your 19 rows:

| Row | Category detected | title | content | tags | metrics |
|---|---|---|---|---|---|
| Row 1 | `sales_guideline` | "Cold Email Best Practices for SaaS..." | Full text | `["cold email","SaaS",...]` | `{}` |
| Row 11 | `audience_insight` | "SaaS VP Sales Persona: Pain Points..." | Full text | `["SaaS","VP Sales",...]` | `{}` |
| ... | ... | ... | ... | ... | ... |

All 19 entries will be valid and importable in one click.

### Technical Details

**Files to change:**

| File | Change |
|---|---|
| `src/lib/statsCSVDetector.ts` | Add `isKnowledgeBaseCSV()` detection function + `transformKnowledgeBaseRows()` transform |
| `src/components/admin/SalesKnowledgeImportDialog.tsx` | Use `isKnowledgeBaseCSV` to branch to the new transform path; update UI hint text and toast messages |

**No database changes needed.** The `sales_knowledge` table schema already has all the columns this data maps to.

**No changes to the existing campaign stats path** — your 324 existing campaign imports and all future campaign log imports will continue to work exactly as before.
