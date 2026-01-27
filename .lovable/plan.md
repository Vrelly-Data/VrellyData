
## Plan: Fix Data Sync and Implement Email vs LinkedIn Metrics

### Investigation Summary

After running a sync and analyzing the logs, I found:

| Finding | Status | Impact |
|---------|--------|--------|
| Unique constraint missing on `synced_contacts` | **Critical** | All contact upserts fail with error 42P10 |
| Steps endpoint returns 404 for some campaigns | **Moderate** | Can't capture step types for archived campaigns |
| Reply.io `/people` endpoint lacks LinkedIn engagement fields | **Limitation** | Need alternative approach for LinkedIn metrics |
| Campaign-level `deliveriesCount` and `repliesCount` are email-only | **Limitation** | LinkedIn metrics require step-based tracking |

### The Reality of Reply.io's API

Based on the actual API response, the person data only includes:
- `linkedInProfile` (URL)
- `linkedInRecruiterUrl`
- `salesNavigatorUrl`

It does **not** include `linkedinConnectionStatus` or `linkedinReplyStatus` in the standard `/campaigns/{id}/people` endpoint. These fields may require:
1. A different API endpoint (`/actions` or `/people/{id}/activities`)
2. Premium Reply.io API access
3. Additional query parameters we're not using

---

### Phase 1: Fix Critical Database Issue

**Add unique constraint to `synced_contacts`**

Currently the upsert fails because `onConflict: "campaign_id,email"` requires a unique constraint on those columns.

```sql
-- Add unique constraint for upsert to work
ALTER TABLE synced_contacts 
ADD CONSTRAINT synced_contacts_campaign_email_unique 
UNIQUE (campaign_id, email);
```

---

### Phase 2: Improve Steps Sync Reliability

**Update sync function to handle 404 gracefully**

Some campaigns (especially archived ones) return 404 for the `/steps` endpoint. The sync should:
1. Log the issue but continue processing
2. Not increment retry attempts for 404s (it's not a rate limit issue)

---

### Phase 3: Calculate Metrics from Available Data

Since we can't get direct LinkedIn reply counts, we'll calculate metrics based on what we have:

**Approach A: Campaign-Level Estimation**
- `deliveriesCount` = Emails sent only (LinkedIn-only campaigns show 0)
- `repliesCount` = Likely email replies only
- Campaigns with name containing "LI" or "LinkedIn" but `deliveriesCount=0` are LinkedIn-only

**Approach B: Step-Type Ratio (after steps sync works)**
- Count email steps vs LinkedIn steps per campaign
- Distribute the campaign's `peopleCount` proportionally
- Use step type ratios to estimate channel breakdown

---

### Phase 4: Enhanced Tooltip Display

Update the stat cards to show the breakdown with clear indicators of what's actual vs estimated:

**Total Messages Sent Tooltip:**
```
┌──────────────────────────────────────┐
│  Messages Breakdown                  │
│  ──────────────────                  │
│  📧 Emails Sent: 627 (from API)     │
│  🔗 LinkedIn Steps: X campaigns     │
│                                      │
│  Note: Reply.io only tracks email   │
│  deliveries at campaign level       │
└──────────────────────────────────────┘
```

**Total Replies Tooltip:**
```
┌──────────────────────────────────────┐
│  Replies Breakdown                   │
│  ────────────────                    │
│  📧 Email Replies: 10 (from API)    │
│  🔗 LinkedIn Replies: Not available │
│                                      │
│  Reply.io API limitation             │
└──────────────────────────────────────┘
```

---

### Files to Modify

| File | Changes |
|------|---------|
| Database migration | Add unique constraint on `synced_contacts(campaign_id, email)` |
| `supabase/functions/sync-reply-campaigns/index.ts` | Handle 404 errors gracefully for steps, log step types properly |
| `src/hooks/usePlaygroundStats.ts` | Calculate email-specific metrics from campaigns with `deliveriesCount > 0` |
| `src/components/playground/PlaygroundStatsGrid.tsx` | Update tooltips to show actual vs estimated metrics with API limitation notes |

---

### Technical Details

**Database Migration:**
```sql
-- Create unique constraint for synced_contacts upsert
ALTER TABLE synced_contacts 
ADD CONSTRAINT synced_contacts_campaign_email_unique 
UNIQUE (campaign_id, email);
```

**Enhanced Stats Calculation:**
```typescript
// Separate email-only campaigns from mixed/LinkedIn campaigns
const emailOnlyCampaigns = campaigns.filter(c => 
  (c.stats?.sent || 0) > 0
);
const linkedinCampaigns = campaigns.filter(c => 
  (c.stats?.sent || 0) === 0 && (c.stats?.peopleCount || 0) > 0
);
```

**Tooltip Update:**
```tsx
const messagesTooltipContent = (
  <div className="space-y-2 text-sm">
    <p className="font-medium border-b pb-1">Messages Breakdown</p>
    <div className="space-y-1">
      <div className="flex justify-between gap-4">
        <span className="text-muted-foreground">📧 Emails Delivered:</span>
        <span className="font-medium">{emailsDelivered}</span>
      </div>
      <div className="flex justify-between gap-4">
        <span className="text-muted-foreground">🔗 LinkedIn Campaigns:</span>
        <span className="font-medium">{linkedinCampaignCount}</span>
      </div>
    </div>
    <p className="text-xs text-muted-foreground pt-1 border-t">
      LinkedIn send counts not available via Reply.io API
    </p>
  </div>
);
```

---

### Future Enhancement: LinkedIn Activities API

To get actual LinkedIn engagement metrics, we could explore:

1. **Reply.io Actions API**: `/actions?type=linkedin_*` may return activity logs
2. **Person Activities**: `/people/{id}/activities` might have per-contact LinkedIn events
3. **Webhooks**: Reply.io webhooks can push LinkedIn events in real-time

This would require additional API research and potentially a separate sync process.

---

### Isolation Confirmation

All changes remain isolated to Data Playground:
- Only modifies `synced_*` tables
- Only touches files in `src/components/playground/` and `src/hooks/usePlayground*.ts`
- No impact on People, Companies, or Audience Builder features
