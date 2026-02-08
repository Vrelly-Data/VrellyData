

## Fix: Dashboard Not Auto-Refreshing After Background Sync

### Current Problem

The sync **is working correctly** - I verified the database has:
- 6 campaigns synced and linked
- 574 contacts synced with stats (sent: 574, peopleCount: 574)

But the dashboard shows 0 because:

1. Campaign sync completes → triggers query invalidation → dashboard shows 0 (contacts not synced yet)
2. Contact sync starts in background (takes 30-60 seconds due to rate limiting)
3. Contact sync completes → **no query invalidation** → dashboard still shows stale data

The `startContactsSync` function invalidates queries **after the for-loop**, but by the time the user looks at the dashboard, React Query has already fetched stale data.

### Solution

Add a final query invalidation **after all campaigns have been synced** and add a slight delay to ensure the database has committed:

```text
Current flow:
1. sync-reply-campaigns completes
2. invalidateQueries() fires → React Query fetches (contacts not synced yet)
3. startContactsSync runs per-campaign (async, takes 30-60s)
4. invalidateQueries() fires again at end → but page may be stale

Fixed flow:
1. sync-reply-campaigns completes  
2. startContactsSync runs per-campaign (async)
3. After EACH campaign syncs → invalidateQueries() (incremental updates)
4. User sees stats updating progressively
```

### Technical Changes

**File: `src/hooks/useOutboundIntegrations.ts`**

Update `startContactsSync` to invalidate queries after **each** campaign syncs (not just at the end):

```typescript
const startContactsSync = (integrationId: string) => {
  void (async () => {
    try {
      const { data: campaigns, error } = await supabase
        .from('synced_campaigns')
        .select('id')
        .eq('integration_id', integrationId)
        .eq('is_linked', true);

      if (error) throw error;
      if (!campaigns?.length) return;

      for (const campaign of campaigns) {
        const { error: syncError } = await supabase.functions.invoke('sync-reply-contacts', {
          body: { campaignId: campaign.id, integrationId },
        });

        if (syncError) {
          console.warn('Contact sync failed:', syncError);
        }

        // Invalidate after EACH campaign to show progressive updates
        queryClient.invalidateQueries({ queryKey: ['synced-campaigns'] });
        queryClient.invalidateQueries({ queryKey: ['playground-stats'] });
      }

      // Final invalidation for contacts list
      queryClient.invalidateQueries({ queryKey: ['synced-contacts'] });
    } catch (err) {
      console.warn('Contacts auto-sync error:', err);
    }
  })();
};
```

### Additional UX Improvement

Add a "syncing contacts" indicator so users know the background sync is running:

The integration card could show "Syncing contacts..." during background sync, but this requires tracking state across the async operation. For now, the progressive invalidation will update the dashboard in real-time as each campaign's contacts are synced.

### Quick Workaround (For Now)

**Hard refresh the page** - the data IS in the database, it's just the React Query cache that's stale. Press `Cmd/Ctrl + Shift + R` or click the browser refresh button.

### Files to Modify

| File | Change |
|------|--------|
| `src/hooks/useOutboundIntegrations.ts` | Move query invalidation inside the for-loop so dashboard updates progressively |

