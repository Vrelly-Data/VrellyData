

## Fix: 5000 Contacts Synced But Only 100 Visible

### Root Cause Identified

The database confirms only **100 contacts exist**, all created on Jan 29 (initial sync). The latest sync on Jan 31 **updated those 100** but failed to insert the remaining 4900 new contacts.

**Evidence:**
- `created_at`: Jan 29 for all 100 contacts
- `updated_at`: Jan 31 (latest sync) for all 100 contacts
- Edge function logs: "5000 synced, 0 failed" (false positive)

### The Problem

The edge function uses `SUPABASE_ANON_KEY` with the user's JWT, which works for RLS. However, the **upsert operation doesn't throw errors when RLS blocks inserts** - it silently skips them while still allowing updates to existing records.

The function counts rows processed, not rows actually inserted, leading to the misleading "5000 synced" message.

---

### Solution: Use Service Role Key for Edge Function

Edge functions that perform bulk data operations should use the `SUPABASE_SERVICE_ROLE_KEY` to bypass RLS, since we've already validated the user's access to the integration and campaign.

#### Changes Required

**1. Update Edge Function to Use Service Role Key**

File: `supabase/functions/sync-reply-contacts/index.ts`

```typescript
// BEFORE: Uses anon key with user auth (RLS blocks bulk inserts)
const supabase = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_ANON_KEY") ?? "",
  { global: { headers: { Authorization: authHeader } } }
);

// AFTER: Use service role for data operations (after validating access)
// First, validate user has access using their auth
const userClient = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_ANON_KEY") ?? "",
  { global: { headers: { Authorization: authHeader } } }
);

// Validate integration/campaign access with user's auth
const { data: integration } = await userClient
  .from("outbound_integrations")
  .select("...")
  .single();

// Then use service role for bulk upserts
const serviceClient = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
);

// Use serviceClient for upserts
await serviceClient.from("synced_contacts").upsert(records, {...});
```

**2. Add Actual Insert Count Verification**

After each batch upsert, query the count to verify rows were actually inserted:

```typescript
const { count } = await serviceClient
  .from("synced_contacts")
  .select("*", { count: "exact", head: true })
  .eq("campaign_id", campaignId);

console.log(`Verified ${count} contacts in database after batch`);
```

---

### Why This Fixes the Issue

| Before | After |
|--------|-------|
| User auth + anon key | User auth for validation + service role for writes |
| RLS silently blocks new inserts | Service role bypasses RLS (safe since we validate first) |
| 100 contacts (original batch) | All 5000+ contacts |
| Misleading success count | Verified actual database count |

---

### Security Consideration

This is secure because:
1. User authentication is still required (validated via `userClient`)
2. Access to the integration is verified before any data operations
3. The `team_id` is taken from the validated integration, not user input
4. Service role is only used for the trusted bulk operation after access is confirmed

---

### After Implementation

1. Deploy the updated edge function
2. Re-sync contacts for a campaign
3. Verify all 5000+ contacts now appear in the People tab

