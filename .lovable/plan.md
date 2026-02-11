
# Auto-Record Campaign Performance to Sales Knowledge

## The Idea

Instead of building a new complex mapping UI, we piggyback on the existing Email and LinkedIn CSV upload flows. After stats are imported to campaigns, the system automatically generates `sales_knowledge` entries (category: `campaign_result`) that capture the performance metrics connected to the campaign's audience data (industries, job titles, company sizes) pulled from `synced_contacts`.

This means:
- You upload a CSV like you already do
- Stats get applied to campaigns (existing behavior)
- **NEW**: A performance snapshot is automatically saved to the Sales Knowledge tab
- The AI Copy Revamp already reads from Sales Knowledge, so it immediately gets access to real performance baselines

## What Gets Recorded

For each campaign that receives stats, a knowledge entry is created like:

```
Title: "HVAC campaign - Performance Baseline (Feb 2026)"
Category: campaign_result
Content:
  Channel: Email + LinkedIn
  Delivered: 54 | Opens: 12 | Replies: 3 | Reply Rate: 5.6%
  LI Connections Sent: 120 | Accepted: 5 | LI Replies: 0
  
  Top Industries: Building Construction (60%), Consumer Services (15%)
  Top Job Titles: Owner (40%), VP Operations (12%)
  Company Sizes: 11-50 (35%), 51-200 (28%)
  
Metrics (structured JSONB):
  { delivered: 54, replies: 3, replyRate: 5.6, ... }
Tags: ["hvac", "building-construction", "linkedin", "email"]
Source Campaign: "HVAC campaign"
```

## How It Works

### 1. New helper: `generatePerformanceSnapshot(campaignId)`

A shared function that:
- Reads the campaign's current stats from `synced_campaigns`
- Queries `synced_contacts` for that campaign to extract top industries, job titles, company sizes, and locations
- Builds a structured knowledge entry with both human-readable content and machine-readable metrics JSONB
- Upserts into `sales_knowledge` (using source_campaign to avoid duplicates -- updates the existing entry if one exists for this campaign)

### 2. Hook into Email Stats Upload

In `useEmailStatsUpload.ts`, after the stats are successfully imported:
- Call `generatePerformanceSnapshot` for each updated campaign
- This happens automatically -- no extra UI needed

### 3. Hook into LinkedIn Stats Upload  

Same approach in `useLinkedInStatsUpload.ts` -- after LinkedIn stats are applied, generate/update the performance snapshot.

### 4. Update `revamp-copy` edge function

Enhance the system prompt to specifically reference `campaign_result` entries when available, telling Claude things like "In the HVAC/Building Construction vertical, email reply rates are ~5.6% and LinkedIn acceptance is ~4.2%."

## Technical Changes

### New file: `src/lib/performanceSnapshot.ts`
- `generatePerformanceSnapshot(campaignId: string)`: Queries campaign stats + contacts, builds and upserts a `sales_knowledge` entry
- Calculates rates (reply rate, open rate, acceptance rate)
- Aggregates contact demographics (top 5 industries, titles, etc.)

### Modified: `src/hooks/useEmailStatsUpload.ts`
- In `onSuccess`, call `generatePerformanceSnapshot` for each updated campaign ID

### Modified: `src/hooks/useLinkedInStatsUpload.ts`  
- Same -- call snapshot generation after successful upload

### Modified: `supabase/functions/revamp-copy/index.ts`
- Update the system prompt to better utilize `campaign_result` entries with structured metrics
- When campaign results exist for similar industries, include them as performance benchmarks

### No new tables or migrations needed
- Uses existing `sales_knowledge` table with existing columns (title, content, category, tags, metrics JSONB, source_campaign)
- Uses existing `synced_contacts` for demographic enrichment
- Uses existing `synced_campaigns` for metrics

## What This Enables

- **Compare by industry**: "Healthcare gets 15% reply rate vs 8% for Finance" -- stored as separate knowledge entries, queryable by tags
- **Compare by copy/sequence**: Each campaign's snapshot references the campaign name, so Claude can correlate with the sequence copy it already has
- **Track over time**: Each upload updates the snapshot with a timestamp, building a history
- **Feed AI**: The revamp-copy function already pulls from sales_knowledge, so performance data automatically influences AI-generated copy
