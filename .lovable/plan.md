
## Revamp Copy: Insights Section + Save to Library

### What's Being Added

When a user clicks "Revamp" on a synced sequence step and sees the result, they currently get a basic side-by-side comparison with copy buttons and a close button. This plan adds:

1. **Enriched Insights Section** — "Why This Revamp Works" card with AI-generated reasoning bullets and "Informed by" badges referencing real Sales Repo entries
2. **Save to Library** — same name input + "Save to Library" button pattern as Generate Copy, so revamped copies appear as document cards on the dashboard
3. **Ranking Bug Fix** in `revamp-copy` — the same bug that was fixed in `generate-copy` and `build-audience` exists here too: it still ranks by a single metric (`li_reply_rate` OR `email_reply_rate`) rather than `Math.max(li, email, combined)`, causing your LinkedIn-dominant campaigns to be excluded from the AI context

---

### Current State Issues

**`supabase/functions/revamp-copy/index.ts` has two bugs:**
- Ranking still uses a single metric based on channel type, so LinkedIn campaigns are mostly excluded
- `sequence_playbook` entries are fetched with `.in("source_campaign", topCampaignNames)` which misses them since playbooks have no `source_campaign`

**Current response shape** (only returns 2 fields):
```json
{ "subject": "...", "body": "..." }
```

**`RevampResultDialog.tsx`** — no insights section, no save functionality, no name input.

---

### Part 1: Update `revamp-copy` Edge Function

**Fix ranking** (same fix applied to `generate-copy` and `build-audience`):
```ts
// BEFORE (broken):
const rate = parseFloat(metrics[rankMetric]) || 0;
return { ...entry, _rankRate: rate };

// AFTER (captures LinkedIn campaigns):
const liRate = parseFloat(metrics["li_reply_rate"]) || 0;
const emailRate = parseFloat(metrics["email_reply_rate"]) || 0;
const combinedRate = parseFloat(metrics["combined_reply_rate"]) || 0;
const _rankRate = Math.max(liRate, emailRate, combinedRate);
const _rateSource = liRate >= emailRate && liRate >= combinedRate ? "LinkedIn" : emailRate >= combinedRate ? "Email" : "Combined";
return { ...entry, _rankRate, _rateSource };
```

**Fix playbook fetching** — split into two separate queries:
```ts
// Email templates linked to top campaigns
const { data: linkedDocs } = await supabase...eq("category", "email_template").in("source_campaign", topCampaignNames)

// Playbooks fetched independently (no source_campaign filter)
const { data: playbookDocs } = await supabase...eq("category", "sequence_playbook").limit(2)
linkedCopyDocs = [...(linkedDocs || []), ...(playbookDocs || [])];
```

**Update Claude response schema** — ask for `why_this_works` and `key_insight` in addition to `subject` and `body`:
```json
{
  "subject": "...",
  "body": "...",
  "key_insight": "One data-backed insight from the KB that informed this rewrite",
  "why_this_works": ["reason 1", "reason 2", "reason 3"]
}
```

**Inject `source_insights` server-side** — built from the actual KB entries fetched (top performers + guidelines), not hallucinated by Claude:
```ts
result.source_insights = sourceInsights; // [{title, category}]
```

**Updated system prompt** — instruct Claude to produce `why_this_works` bullets grounded in the KB data it received. If KB is empty, generate plausible reasoning from the copy itself. Increase `max_tokens` from 1024 → 1500 to accommodate the extra fields.

---

### Part 2: Update `RevampResultDialog.tsx`

**New props:**
- Add `campaignName?: string` for generating a meaningful default save name

**New response type:**
```ts
interface RevampResult {
  subject: string | null;
  body: string | null;
  why_this_works?: string[];
  key_insight?: string;
  source_insights?: { title: string; category: string }[];
}
```

**New state:**
- `templateName: string` — pre-filled with `"Revamped — {campaignName} Step {stepNumber} — Feb 2026"` when dialog opens
- `savedGroupId: string | null` — post-save state

**New layout (after the header, before the side-by-side comparison):**

```
┌─ Why This Revamp Works ─────────────────────────────────┐
│  Key Insight: "..."                                     │
│                                                         │
│  Why this approach:                                     │
│  • LinkedIn messages with question openers averaged...  │
│  • Campaigns referencing company-specific pain points.. │
│                                                         │
│  Informed by:  [ Campaign ] PestShare  [ Playbook ] ... │
└─────────────────────────────────────────────────────────┘

[ Name input: "Revamped — Campaign X Step 1 — Feb 2026" ] [ Save to Library ]

┌─ Original ──────────┐  ┌─ Revamped ──────────────────┐
│ Subject: ...        │  │ Subject: ...  [ Copy ]      │
│ Body: ...           │  │ Body: ...     [ Copy ]      │
└─────────────────────┘  └─────────────────────────────┘

[ Close ]
```

The insights card only renders if `why_this_works` or `source_insights` are present (degrades gracefully if KB is empty).

**Save logic** — reuses the existing `useSaveCopyMutation` hook with a single step:
```ts
saveMutation.mutateAsync({
  templateName: templateName.trim(),
  steps: [{
    step: stepNumber,
    day: 1,
    channel: stepType,
    subject: revamped.subject,
    body: revamped.body || '',
  }]
})
```

After save: button shows "Saved ✓" (green, disabled), toast: "Revamped copy saved to your library" — and the doc card appears in the dashboard library.

---

### Part 3: Update `CopyTab.tsx`

Update the local `RevampResult` interface to match the richer response shape, and pass `campaignName` as a prop to `RevampResultDialog`.

---

### Files to Change

| File | Action |
|---|---|
| `supabase/functions/revamp-copy/index.ts` | Fix ranking bug, fix playbook fetch, add why_this_works/key_insight/source_insights to response |
| `src/components/playground/RevampResultDialog.tsx` | Add insights card + save section (name input + save button) |
| `src/components/playground/CopyTab.tsx` | Update RevampResult type, pass campaignName prop |

### No Hook or Schema Changes

`useSaveCopyMutation` already handles single-step saves perfectly — no changes needed. `copy_templates` table schema is unchanged. The revamped copy appears in the same library as generated copies.
