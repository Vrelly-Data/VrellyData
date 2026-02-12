

# Aggregate Contact Activity Logs into Single Campaign Result Entries

## Problem

The CSV being uploaded is a contact-level activity log, not pre-aggregated stats. Each row represents one action for one contact:

| Sequence | Action Type | Contact Email | ... |
|----------|-------------|---------------|-----|
| My Outreach | Message Sent | john@co.com | ... |
| My Outreach | Connection Request | jane@co.com | ... |
| My Outreach | Reply | john@co.com | ... |

The current code creates one database entry per row. Instead, it should **aggregate all rows by Sequence name**, count each Action Type, and save **one entry per sequence**.

## Result

From a CSV with 1,000 rows across 2 sequences, the import would produce **2 entries**:

- **Entry 1**: "Sales Outreach Q1 - Performance Baseline (Feb 2026)"
  - Metrics: `{ message_sent: 1117, connection_request: 750, reply: 100, total_contacts: 500 }`
  - Content: "Message Sent: 1117 | Connection Request: 750 | Reply: 100 | Total Contacts: 500"

- **Entry 2**: "Follow-Up Campaign - Performance Baseline (Feb 2026)"
  - Metrics: `{ message_sent: 200, reply: 45, total_contacts: 180 }`
  - Content: "Message Sent: 200 | Reply: 45 | Total Contacts: 180"

## Technical Changes

### 1. Update detection in `src/lib/statsCSVDetector.ts`

Add a new config field `actionCol` to identify the "Action Type" column (pattern match on "action type", "action", "activity type"). Also add pattern for "Sequence" as the name column (already supported).

### 2. Replace `transformStatsRows` with aggregation logic

Instead of mapping each row to an entry, the new logic will:

1. Group all rows by the value in the Sequence/campaign name column
2. For each group, count occurrences of each unique Action Type value
3. Count unique contacts (by email or Contact Id) as `total_contacts`
4. Build one `SalesKnowledgeInsert` per group with:
   - **title**: Sequence name + " - Performance Baseline (Month Year)"
   - **metrics**: `{ action_type_1: count, action_type_2: count, total_contacts: count }`
   - **content**: Human-readable summary of the counts
   - **category**: `campaign_result`
   - **source_campaign**: The sequence name

### 3. Update `SalesKnowledgeImportDialog.tsx`

The preview table will now show fewer rows (one per sequence instead of one per contact). No structural changes needed -- it already displays `transformedRows` which will now contain aggregated entries.

### What stays the same

- The upload step (file picker) is unchanged
- The preview table UI is unchanged
- The import button and `bulkCreateEntries` call are unchanged
- The `useAdminSalesKnowledge` hook is unchanged

