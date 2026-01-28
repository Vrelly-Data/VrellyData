

## Fix: Fetch Campaigns Across ALL Agency Teams

### Root Cause

For Reply.io agency accounts, the V1 `/campaigns` endpoint returns campaigns scoped to the authenticated context. Even when we omit the `X-Reply-Team-Id` header, the API only returns campaigns for the "default" team (383171 in your case - 62 campaigns).

To see all 200+ campaigns across your agency, we need to:
1. Discover ALL team IDs in your agency account
2. Fetch campaigns from EACH team separately
3. Merge the results

### Solution: Multi-Team Campaign Aggregation

Update the `fetch-available-campaigns` edge function to:
1. First call `fetch-reply-teams` logic to discover all teams
2. Loop through each team and fetch their campaigns
3. Combine all campaigns with their team context
4. Return the merged list to the UI

### Technical Implementation

**1. Update `fetch-available-campaigns/index.ts`**

When `skipTeamFilter` is true:
- Use V3 `/sequences` endpoint to discover all unique teamIds/ownerIds
- For each discovered team, call `/campaigns?limit=100` with that team's `X-Reply-Team-Id`
- Merge all campaign results
- Add a `teamId` field to each campaign so users know which team it belongs to

```text
+-------------------+     +----------------------+     +-------------------+
| skipTeamFilter=   |---->| Discover all teams   |---->| Fetch campaigns   |
| true              |     | via V3 /sequences    |     | for EACH team     |
+-------------------+     +----------------------+     +-------------------+
                                                              |
                          +-------------------------------+   |
                          | Merge all campaigns           |<--+
                          | Add team context to each      |
                          +-------------------------------+
                                      |
                                      v
                          +-------------------------------+
                          | Return 200+ campaigns         |
                          | from all agency teams         |
                          +-------------------------------+
```

**2. Update UI to Show Team Context**

In `ManageCampaignsDialog.tsx`, when showing all campaigns:
- Display which team each campaign belongs to
- Allow filtering by team
- Show grouped count (e.g., "62 from Team A, 80 from Team B, 60 from Team C")

**3. Handle Rate Limits**

Reply.io has rate limits, so when fetching from multiple teams:
- Add small delays between team fetches (300ms)
- Show progress in UI ("Fetching from team 1 of 4...")
- Handle partial failures gracefully

### Files to Modify

| File | Change |
|------|--------|
| `supabase/functions/fetch-available-campaigns/index.ts` | Add multi-team discovery and aggregation |
| `src/components/playground/ManageCampaignsDialog.tsx` | Show team badges on campaigns when showing all |
| `src/hooks/useAvailableCampaigns.ts` | Update types to include team context |

### Expected Result

After implementation:
- With team filter ON: 62 campaigns (current team only)
- With team filter OFF: 200+ campaigns (all teams aggregated)

### Trade-offs

**Pros:**
- See ALL campaigns across your agency
- No manual team switching needed
- Can link campaigns from any team

**Cons:**
- Initial "Show All" fetch takes longer (multiple API calls)
- May hit rate limits with very large accounts (10+ teams)
- Edge function timeout risk for accounts with 500+ campaigns across 10+ teams

### Alternative: Team Selector Dropdown

Instead of auto-fetching all teams, we could add a team dropdown that lets you switch between teams manually. This would be faster but requires more clicks.

