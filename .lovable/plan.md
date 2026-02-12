

# Make the Sales Repo a Smart Intelligence Engine

## The Real Problem

You have 324 campaign results (and growing), plus you're about to add hundreds of copy docs. Users will be working on their OWN campaigns — not the ones in the repo. The AI needs to intelligently select the most relevant, highest-performing entries to learn from, not grab 15 random ones from 324+.

## What Needs to Change

### 1. Smarter Retrieval in `revamp-copy` Edge Function

**File: `supabase/functions/revamp-copy/index.ts`**

Replace the single "grab 15 random entries" query with a **three-tier retrieval strategy**:

**Tier 1 — Top Performers by Channel** (up to 5 entries)
When revamping an email step, pull the top 5 campaign results ranked by email reply rate. When revamping a LinkedIn step, rank by LI reply rate. This gives the AI concrete examples of what actually works.

```text
Query: SELECT * FROM sales_knowledge
  WHERE category = 'campaign_result'
  AND is_active = true
  ORDER BY (metrics->>'email_reply_rate')::float DESC   -- or li_reply_rate for LinkedIn
  LIMIT 5
```

**Tier 2 — Copy Docs Linked to Top Performers** (up to 5 entries)
Pull sequence playbooks and email templates whose `source_campaign` matches any of the top-performing campaign names from Tier 1. This gives the AI the actual copy that drove those results.

```text
Query: SELECT * FROM sales_knowledge
  WHERE category IN ('email_template', 'sequence_playbook')
  AND source_campaign IN (names from tier 1)
  AND is_active = true
  LIMIT 5
```

**Tier 3 — General Best Practices** (up to 5 entries)
Fill remaining slots with sales guidelines and audience insights for tone/style context.

```text
Query: SELECT * FROM sales_knowledge
  WHERE category IN ('sales_guideline', 'audience_insight')
  AND is_active = true
  LIMIT 5
```

**Why this works:** The AI sees "this campaign had a 25% reply rate" + "here's the actual copy they used" + "here are our general best practices." It can now reason about WHY certain copy worked and apply those patterns.

### 2. Auto-Link Copy Docs to Campaign Stats

**File: `src/components/admin/SalesKnowledgeDocImportDialog.tsx`**

When uploading a copy doc, auto-populate `source_campaign` from the title. This creates the link between a copy doc and its corresponding campaign result entry.

- Upload "Healthcare CTO Outreach.pdf" as a Sequence Playbook
- Title auto-fills: "Healthcare CTO Outreach"
- Source Campaign auto-fills: "Healthcare CTO Outreach"
- The stats entry already has source_campaign: "Healthcare CTO Outreach"
- Tier 2 retrieval now connects them automatically

### 3. Better Prompt Engineering

Update the system prompt in the edge function to explicitly instruct the AI to:
- Reference specific performance data ("campaigns with 15%+ reply rates used short subject lines")
- Compare patterns across top performers vs underperformers
- Apply learnings from the copy docs that drove the best results
- Cite which campaign results informed its suggestions

## How It All Connects

```text
User revamps an EMAIL step:

  Tier 1: "Here are your 5 best email campaigns by reply rate"
    -> Campaign A: 25% reply rate, 500 sent
    -> Campaign B: 18% reply rate, 300 sent
    -> ...

  Tier 2: "Here's the actual copy from those winning campaigns"
    -> Campaign A copy doc (the email sequences they used)
    -> Campaign B copy doc
    -> ...

  Tier 3: "Here are general guidelines"
    -> Sales guidelines, tone rules, audience insights

  AI now thinks: "Campaign A got 25% replies using short subject lines 
  and a question-based opener. Campaign B got 18% with a value-first 
  approach. Let me apply these patterns to the user's copy."
```

## Files Changed

1. `supabase/functions/revamp-copy/index.ts` — Three-tier retrieval + better prompt
2. `src/components/admin/SalesKnowledgeDocImportDialog.tsx` — Auto-fill source_campaign from title

## What This Unlocks

- The more campaigns you add to the repo, the smarter the AI gets
- It always learns from winners, not random entries
- It connects performance data to actual copy patterns
- Users get AI suggestions backed by real data, not generic advice
- This is the foundation for future features like "show me what worked for [industry]" or "generate copy based on our top 10 campaigns"

