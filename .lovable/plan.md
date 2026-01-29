

## Fix: Campaign Status, Contacts & Copy Sync Issues

### Issues Identified

#### Issue 1: Campaign Status Not Updating
The edge function `sync-reply-campaigns` was updated with the new status mappings (including code 7 = "finished"), but the fix needs to be verified and possibly the campaigns need to be re-synced. The database shows campaigns with "unknown" status from the last sync.

#### Issue 2: Edge Functions Not Registered in config.toml
The new edge functions `sync-reply-contacts` and `sync-reply-sequences` are **NOT** registered in `supabase/config.toml`. This means they may have JWT verification enabled by default and could fail authentication.

```toml
# Missing from config.toml:
[functions.sync-reply-contacts]
verify_jwt = true

[functions.sync-reply-sequences]
verify_jwt = true
```

#### Issue 3: Wrong Response Parsing in Edge Functions

**sync-reply-sequences** (Line 148):
```typescript
// WRONG: expects { steps: [] }
const response = await fetchWithRetry(...) as { steps?: ReplyStep[] };
const steps = response.steps || [];

// CORRECT: Reply.io returns a plain array
const steps = await fetchWithRetry(...) as ReplyStep[];
```

**sync-reply-contacts** (Line 143-145):
```typescript
// WRONG: expects { contacts: [], hasMore: boolean }
const response = await fetchWithRetry(...) as { contacts?: ReplyContact[]; hasMore?: boolean };
const contacts = response.contacts || [];

// CORRECT: Reply.io returns { items: [], info: { hasMore: boolean } }
const response = await fetchWithRetry(...) as { items?: ReplyContact[]; info?: { hasMore?: boolean } };
const contacts = response.items || [];
hasMore = response.info?.hasMore || false;
```

### Solution

#### Fix 1: Register Edge Functions in config.toml
Add the missing function entries to `supabase/config.toml`:

```toml
[functions.sync-reply-contacts]
verify_jwt = true

[functions.sync-reply-sequences]
verify_jwt = true
```

#### Fix 2: Correct Response Parsing in sync-reply-sequences

Update to parse the response as a direct array:
```typescript
// Fetch steps from Reply.io V3 API - returns direct array, not { steps: [] }
const steps = await fetchWithRetry(endpoint, apiKey, replyTeamId || undefined) as ReplyStep[];
console.log(`Fetched ${steps.length} steps from Reply.io`);
```

#### Fix 3: Correct Response Parsing in sync-reply-contacts

Update to use `items` and `info.hasMore`:
```typescript
const response = await fetchWithRetry(endpoint, apiKey, replyTeamId || undefined) as { 
  items?: ReplyContact[]; 
  info?: { hasMore?: boolean } 
};

const contacts = response.items || [];
allContacts = [...allContacts, ...contacts];

hasMore = response.info?.hasMore || false;
```

### Files to Modify

| File | Changes |
|------|---------|
| `supabase/config.toml` | Add `sync-reply-contacts` and `sync-reply-sequences` function entries |
| `supabase/functions/sync-reply-sequences/index.ts` | Fix response parsing (array not object) |
| `supabase/functions/sync-reply-contacts/index.ts` | Fix response parsing (`items` not `contacts`, `info.hasMore` not `hasMore`) |

### Post-Fix Testing Steps

1. **Re-deploy edge functions** (automatic after file changes)
2. **Re-sync campaigns** from the Playground tab to update statuses
3. **Navigate to Copy tab** and select a campaign to sync sequence steps
4. **Navigate to People tab** and select a campaign to sync contacts

### Expected Results After Fix

| Feature | Before | After |
|---------|--------|-------|
| Campaign statuses | "unknown" for some campaigns | Correct: "active", "paused", "finished" |
| Copy/Sequences sync | "Fetched 0 steps" | Actual email templates synced |
| Contacts sync | "Fetched 0 contacts" | Actual contacts synced |

