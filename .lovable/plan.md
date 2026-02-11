

# Sales Knowledge Base -- AI Training Repository

## The Idea

Build a **Sales Knowledge Base** in the Admin section where admins can curate the training data that Vrelly's AI sales agent learns from. This is not a raw data viewer -- it's a structured repository of **proven examples, guidelines, and learnings** that the LLM references when generating copy or suggesting audiences.

Think of it as "the playbook" that powers the AI.

## What Gets Built

### New Admin Tab: "Sales Knowledge"

A fourth tab in the Admin page with a card-based layout for managing knowledge entries. Each entry belongs to a **category**:

| Category | Purpose | Example Entry |
|---|---|---|
| **Email Templates** | High-performing email copy with context | "Cold intro for SaaS CTOs -- 12% reply rate" |
| **Sequence Playbooks** | Full multi-step sequence strategies | "5-step LI+Email for Series A founders" |
| **Campaign Results** | Real campaign outcomes with learnings | "Healthcare campaign: 2,400 sent, 9.2% reply, key insight: short subject lines won" |
| **Sales Guidelines** | Rules, tone, formatting preferences | "Never use 'hope this finds you well'. Always personalize first line." |
| **Audience Insights** | Learnings about which audiences convert | "Director-level in fintech 51-200 employees converts 3x better than VP-level" |

### How It Works

1. Admin clicks "Add Entry" and selects a category
2. Fills in a title, the content (rich text / markdown), optional tags, and optional performance metrics
3. Entry is saved to a `sales_knowledge` table
4. When the AI features (Copy Revamp, People Suggestions) are built, they query this table for relevant context to include in LLM prompts

### Auto-Import from Data Playground (Phase 2)

Later, admins can also "promote" high-performing sequences or campaign results directly from the Data Playground into the knowledge base with one click. But Phase 1 is manual curation.

## Technical Details

### Database: New `sales_knowledge` Table

```text
sales_knowledge
  id              uuid (PK)
  category        text ('email_template' | 'sequence_playbook' | 'campaign_result' | 'sales_guideline' | 'audience_insight')
  title           text (required)
  content         text (the actual copy, playbook, or learning -- markdown supported)
  tags            text[] (e.g. ['saas', 'cold-outreach', 'cto'])
  metrics         jsonb (optional: { reply_rate: 9.2, sent: 2400, opens: 800 })
  source_campaign text (optional: name of the campaign this came from)
  is_active       boolean (default true -- allows soft-disabling entries)
  created_by      uuid
  created_at      timestamptz
  updated_at      timestamptz
```

**RLS**: Admin-only via `is_global_admin(auth.uid())` for all operations.

### Frontend Files

**New files:**
- `src/components/admin/SalesKnowledgeTab.tsx` -- Main tab with entry list, add/edit dialog
- `src/hooks/useAdminSalesKnowledge.ts` -- CRUD hook for the `sales_knowledge` table

**Modified files:**
- `src/pages/Admin.tsx` -- Add "Sales Knowledge" as 4th tab with a BookOpen or Brain icon

### UI Layout

```text
Admin Page
+-----------------------------------------------------------+
| [Templates] [Uploads] [Users] [Sales Knowledge]           |
+-----------------------------------------------------------+
|                                                           |
| [+ Add Entry]     Filter: [All Categories v] [Search...] |
|                                                           |
| +-------------------------------------------------------+ |
| | Email Template                                         | |
| | "Cold Intro for SaaS CTOs"                            | |
| | Tags: saas, cto, cold-outreach                        | |
| | Reply Rate: 12%  |  Created: Feb 10, 2026             | |
| | [Edit] [Delete]                                        | |
| +-------------------------------------------------------+ |
|                                                           |
| +-------------------------------------------------------+ |
| | Sales Guideline                                        | |
| | "Subject Line Best Practices"                         | |
| | Tags: email, subject-lines                            | |
| | [Edit] [Delete]                                        | |
| +-------------------------------------------------------+ |
+-----------------------------------------------------------+
```

### Add/Edit Dialog

```text
+------------------------------------------+
| Add Knowledge Entry                       |
|                                          |
| Category: [Email Template       v]       |
| Title:    [________________________]     |
| Content:  [________________________]     |
|           [________________________]     |
|           [________________________]     |
| Tags:     [saas] [cto] [+ add]          |
| Source Campaign: [optional____________]  |
| Metrics (optional):                      |
|   Reply Rate: [___]  Sent: [___]        |
|                                          |
| [Cancel]              [Save Entry]       |
+------------------------------------------+
```

## How the AI Will Use This Later

When Copy Revamp or Audience Suggestions features are built, the flow will be:

1. Query `sales_knowledge` for relevant entries (filtered by category + tags)
2. Include those entries as context in the LLM prompt
3. The AI generates output informed by real, curated examples

Example prompt context:
> "Here are proven email templates for this audience segment: [entries]. Here are our sales guidelines: [entries]. Generate a new sequence that follows these patterns."

## What Does NOT Change

- Data Playground -- untouched
- Existing Admin tabs -- untouched
- Audience Builder / search functions -- untouched
- synced_campaigns, synced_sequences, synced_contacts tables -- untouched

## Sequencing

1. Create `sales_knowledge` table with RLS (database migration)
2. Create `useAdminSalesKnowledge.ts` hook (CRUD operations)
3. Create `SalesKnowledgeTab.tsx` component (list + add/edit dialog)
4. Add the tab to `Admin.tsx`

