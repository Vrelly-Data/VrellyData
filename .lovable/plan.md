

## Fix: Sync Copy and People - Database Constraint and API Field Mapping Issues

### Root Cause Analysis

I've identified the exact issues preventing the sync from working:

---

### Issue 1: Missing Database Unique Constraint for Sequences

The `synced_sequences` table needs a unique constraint for the upsert to work:

| Current State | Required |
|---------------|----------|
| Only primary key on `id` | Unique constraint on `(campaign_id, step_number)` |
| Only regular indexes on `campaign_id`, `team_id` | Composite unique for upsert |

The error `there is no unique or exclusion constraint matching the ON CONFLICT specification` occurs because there's no unique index matching `campaign_id,step_number`.

---

### Issue 2: Wrong Field Name for Step Number

The Reply.io API **does NOT return a `number` field**. Looking at the actual API docs:

```json
[
  {
    "type": "Email",
    "delayInMinutes": 1,
    "executionMode": "Automatic",
    "templates": [...],
    "id": 123      // <-- Only "id", no "number"
  }
]
```

The code uses `step.number` which is always `undefined`. We need to use the **array index + 1** as the step number.

---

### Issue 3: Contacts May Need External ID Constraint

The `synced_contacts` table has a unique constraint on `(campaign_id, email)` which should work. However, the logs show the contacts sync started but no completion message - need to also check if `external_contact_id` is better for uniqueness.

---

### Solution

#### Fix 1: Add Unique Constraint to `synced_sequences`

Create a database migration to add the missing constraint:

```sql
ALTER TABLE synced_sequences
ADD CONSTRAINT synced_sequences_campaign_step_unique 
UNIQUE (campaign_id, step_number);
```

#### Fix 2: Fix Step Number Mapping in Edge Function

Change from using a non-existent `step.number` field to using the array index:

```typescript
// BEFORE (broken):
for (const step of steps) {
  step_number: step.number,  // undefined!
}

// AFTER (fixed):
for (let i = 0; i < steps.length; i++) {
  const step = steps[i];
  const stepNumber = i + 1;  // Use array index + 1
  // ...
  step_number: stepNumber,
}
```

#### Fix 3: Update onConflict for Sequences

After adding the constraint, use a more specific conflict target that includes `external_sequence_id`:

```typescript
.upsert({
  campaign_id: campaignId,
  external_sequence_id: String(step.id),
  step_number: stepNumber,
  // ...
}, {
  onConflict: "campaign_id,step_number",
})
```

---

### Files to Modify

| File | Changes |
|------|---------|
| Database Migration | Add unique constraint `(campaign_id, step_number)` to `synced_sequences` |
| `supabase/functions/sync-reply-sequences/index.ts` | Use array index for step_number instead of undefined `step.number` |

---

### Expected Result After Fix

| Metric | Before | After |
|--------|--------|-------|
| Steps synced | 0 synced, 6 failed | 6 synced, 0 failed |
| Copy Tab | Empty | Shows email templates |
| Error logs | "no unique constraint" | Clean sync logs |

