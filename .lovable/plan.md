

## Fix: Remove Duplicate Code Block Breaking Sync

### The Problem

The `sync-reply-campaigns` edge function has **duplicate code** that prevents it from loading:

```text
Lines 412-428: First declaration of finalStatus and syncError ✓
Lines 430-446: DUPLICATE declaration of finalStatus and syncError ✗
```

This causes: `SyntaxError: Identifier 'finalStatus' has already been declared`

The function literally cannot boot, so clicking "Sync" does nothing.

---

### The Fix

Delete lines 430-446 (the duplicate block). Keep lines 412-428.

**Before (broken):**
```typescript
// Lines 412-428 - KEEP THIS
const finalStatus = campaignsFailed > 0 && campaignsProcessed === 0 ? "error" : "synced";
const syncError = campaignsFailed > 0 
  ? `Synced ${campaignsProcessed}/${sequences.length} sequences (${campaignsFailed} failed)` 
  : null;
await supabase.from("outbound_integrations").update({...}).eq("id", integrationId);
console.log(`Sync complete: ${campaignsProcessed} campaigns (contacts sync runs per-campaign)`);

// Lines 430-446 - DELETE THIS (exact duplicate)
const finalStatus = ...  // ❌ Already declared!
const syncError = ...
await supabase.from("outbound_integrations").update({...});
console.log(`Full sync complete: ${campaignsProcessed} campaigns`);
```

**After (fixed):**
```typescript
// Update integration status (single block)
const finalStatus = campaignsFailed > 0 && campaignsProcessed === 0 ? "error" : "synced";
const syncError = campaignsFailed > 0 
  ? `Synced ${campaignsProcessed}/${sequences.length} sequences (${campaignsFailed} failed)` 
  : null;

await supabase
  .from("outbound_integrations")
  .update({
    sync_status: finalStatus,
    sync_error: syncError,
    last_synced_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  })
  .eq("id", integrationId);

console.log(`Sync complete: ${campaignsProcessed} campaigns`);

return new Response(...);
```

---

### File to Modify

| File | Change |
|------|--------|
| `supabase/functions/sync-reply-campaigns/index.ts` | Delete lines 430-446 (duplicate status update block) |

---

### After This Fix

1. Edge function will load without syntax error
2. Sync will execute: fetch V3 sequences → fetch V3 stats → save to `synced_campaigns`
3. Status will update to "synced"
4. Dashboard will show email engagement data (sent, replies, etc.)
5. Contacts sync runs separately per-campaign via `sync-reply-contacts`
6. LinkedIn stats from webhooks and CSV uploads remain preserved

