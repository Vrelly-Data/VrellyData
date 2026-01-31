

## Fix: Reply.io API Returning Same Contacts on Multiple Pages

### Root Cause Identified

The logs reveal the issue:
```
Page 1: fetched 100, new unique: 100, total unique: 100
Page 2: fetched 100, new unique: 0, total unique: 100
No new unique contacts in this page, stopping pagination
```

The Reply.io API is returning the **same 100 contacts** when fetching with `offset=100`. This triggers our "duplicate detection" logic that was meant to prevent infinite loops, but it's stopping pagination prematurely.

**Possible causes:**
1. The API may not have stable ordering for offset pagination
2. The sequence may have contacts that overlap across "pages" due to API behavior
3. There may be a caching issue on the Reply.io side

---

### Solution

The "stop if no new unique contacts" logic is too aggressive. We need to:

1. **Continue pagination based on `hasMore` flag**, not duplicate detection
2. **Still deduplicate** contacts (using the Map), but don't stop early just because one page has duplicates
3. **Only stop when**:
   - `hasMore` is explicitly `false`
   - We receive fewer items than `limit` (last page)
   - We hit the safety cap (10,000 contacts)
   - We receive 0 items (empty page)

---

### Code Changes

**File:** `supabase/functions/sync-reply-contacts/index.ts`

**Before (problematic logic at lines 176-180):**
```typescript
// Stop if no new contacts were found (we're seeing duplicates)
if (newUniqueCount === 0 && contacts.length > 0) {
  console.log("No new unique contacts in this page, stopping pagination");
  break;
}
```

**After (remove premature exit, rely on hasMore):**
```typescript
// Log duplicate detection but DON'T stop - continue checking hasMore
if (newUniqueCount === 0 && contacts.length > 0) {
  console.log(`Page ${iterations} returned only duplicates, but continuing based on hasMore flag`);
}
```

The rest of the pagination logic already handles proper termination:
- `hasMore = response.info?.hasMore ?? (contacts.length === limit)` - respects API signal
- `if (contacts.length < limit) hasMore = false` - detects last page
- `iterations < maxIterations` - safety cap

---

### Expected Outcome

| Before | After |
|--------|-------|
| Stops after 2 pages (200 fetched, 100 unique) | Continues until `hasMore=false` |
| 100 contacts synced | All 1,176 contacts synced |
| Premature exit on duplicate page | Respects Reply.io pagination signal |

---

### Verification Steps

After deployment:
1. Click "Refresh Contacts" for the campaign
2. Check logs show continued pagination beyond page 2
3. Verify final count matches ~1,176 contacts
4. Confirm People tab shows all contacts with pagination

