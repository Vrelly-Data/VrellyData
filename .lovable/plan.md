

## Replace "Out of Office" with "Leaderboard" Feature

### What you're asking for

Replace the "Out of Office" stat card with a "Leaderboard" card that shows the top 50 campaigns across ALL users on the platform, completely anonymized. When clicked, it opens a dialog showing campaign performance stats.

---

## Implementation Overview

### Key Points
- **Anonymous**: No team names, user info, or campaign names will be shown
- **Global**: Queries across all teams using a secure database function
- **Privacy-first**: Uses a server-side function to ensure no data leaks

---

## Database Changes

### New Database Function
Create a secure RPC function that returns anonymized leaderboard data:

```sql
CREATE OR REPLACE FUNCTION get_campaign_leaderboard(p_limit integer DEFAULT 50)
RETURNS TABLE (
  rank integer,
  messages_sent bigint,
  replies bigint,
  reply_rate numeric,
  contacts bigint,
  completion_rate numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    ROW_NUMBER() OVER (ORDER BY 
      CASE WHEN (stats->>'sent')::int > 0 
           THEN ((stats->>'replies')::numeric / (stats->>'sent')::numeric) * 100 
           ELSE 0 END DESC
    )::integer as rank,
    COALESCE((stats->>'sent')::bigint, 0) as messages_sent,
    COALESCE((stats->>'replies')::bigint, 0) as replies,
    CASE WHEN (stats->>'sent')::int > 0 
         THEN ROUND(((stats->>'replies')::numeric / (stats->>'sent')::numeric) * 100, 1) 
         ELSE 0 END as reply_rate,
    COALESCE((stats->>'peopleCount')::bigint, 0) as contacts,
    CASE WHEN (stats->>'peopleCount')::int > 0 
         THEN ROUND(((stats->>'peopleFinished')::numeric / (stats->>'peopleCount')::numeric) * 100, 1) 
         ELSE 0 END as completion_rate
  FROM synced_campaigns
  WHERE is_linked = true
    AND (stats->>'sent')::int > 0  -- Only campaigns with activity
  ORDER BY reply_rate DESC
  LIMIT p_limit;
END;
$$;
```

This function:
- Uses `SECURITY DEFINER` to bypass RLS and query all teams
- Returns ONLY stats - no identifying information
- Excludes campaign names, team IDs, or any PII

---

## Frontend Changes

### Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `src/hooks/useLeaderboard.ts` | Create | Hook to fetch leaderboard data via RPC |
| `src/components/playground/LeaderboardDialog.tsx` | Create | Dialog showing top 50 campaigns table |
| `src/components/playground/PlaygroundStatsGrid.tsx` | Modify | Replace "Out of Office" card with "Leaderboard" card |

---

### New Hook: `useLeaderboard.ts`

```typescript
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface LeaderboardEntry {
  rank: number;
  messages_sent: number;
  replies: number;
  reply_rate: number;
  contacts: number;
  completion_rate: number;
}

export function useLeaderboard() {
  return useQuery({
    queryKey: ['campaign-leaderboard'],
    queryFn: async (): Promise<LeaderboardEntry[]> => {
      const { data, error } = await supabase
        .rpc('get_campaign_leaderboard', { p_limit: 50 });
      
      if (error) throw error;
      return data || [];
    },
  });
}
```

---

### New Component: `LeaderboardDialog.tsx`

A dialog that displays:
- Table with columns: Rank, Messages Sent, Replies, Reply Rate %, Contacts, Completion %
- Clear "Anonymous" badge/notice at the top
- "Data is aggregated across all platform users" disclaimer

---

### UI Changes to Stats Grid

Replace the "Out of Office" card:

```tsx
// BEFORE
<StatCard
  title="Out of Office"
  value={stats?.outOfOfficeCount ?? 0}
  icon={<Clock className="h-5 w-5 text-primary" />}
  description="Auto-replies detected"
/>

// AFTER
<StatCard
  title="Leaderboard"
  value="Top 50"
  icon={<Trophy className="h-5 w-5 text-primary" />}
  description="Anonymous global stats"
  onClick={() => setLeaderboardOpen(true)}
  clickable
/>
```

---

## Privacy & Security

| Aspect | Approach |
|--------|----------|
| Team isolation | RPC function returns no team_id |
| Campaign names | Not returned from function |
| User identity | Not returned from function |
| Data shown | Only: rank, counts, percentages |

---

## Visual Preview

When clicking "Leaderboard", users see:

```text
+--------------------------------------------------+
|  Leaderboard                              [X]    |
|--------------------------------------------------|
|  All data is completely anonymous.               |
|  Rankings based on reply rate.                   |
|--------------------------------------------------|
|  #   Sent    Replies   Rate    Contacts   Done   |
|  1   1,200   96        8.0%    500        85%    |
|  2   800     56        7.0%    300        92%    |
|  3   2,500   150       6.0%    1,000      78%    |
|  ...                                             |
+--------------------------------------------------+
```

---

## Summary

This sets up the basic infrastructure for a global anonymous leaderboard. The scoring system can be refined later - currently it's sorted by reply rate, but we can adjust this to use a weighted scoring formula when you're ready to define it.

