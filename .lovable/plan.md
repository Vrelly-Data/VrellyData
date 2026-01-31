

## Fix LinkedIn Copy Not Saving to Database

### What's happening

The LinkedIn message content **is being fetched** from Reply.io (visible in `raw_data->>'message'`), but it's **not being saved** to the `body_html` / `body_text` columns that the Copy tab uses to display content.

### Evidence from database

| step_type | body_html | raw_data->>'message' |
|-----------|-----------|---------------------|
| linkedin | **null** | `"<p>Hi {{FirstName}}, Are you doing any sort of outbound?..."` |
| linkedin | **null** | `"<p>Great to connect {{FirstName}}, Curious how you're approaching growth..."` |

The content exists in `raw_data` but wasn't extracted to the display columns.

---

### Root Cause

The sync function (lines 161-174) has flawed logic:

```typescript
const isLinkedIn = step.type?.toLowerCase().includes('linkedin') || !!step.message;

if (isLinkedIn && step.message) {
  bodyHtml = step.message;  // Only runs if message is truthy
}
```

**Problems:**
1. For LinkedIn **Connect** steps, `step.message` is empty string `""` (falsy) - so `isLinkedIn` becomes false
2. Even when `type` contains "linkedin", the second condition `step.message` can be falsy
3. The step type from Reply.io is `"LinkedIn"` (capital L), but we check `.toLowerCase().includes('linkedin')` which works... but then the body assignment still fails

---

### Solution

Fix the sync function to properly handle LinkedIn steps:

**File:** `supabase/functions/sync-reply-sequences/index.ts`

```typescript
// BEFORE (buggy)
const isLinkedIn = step.type?.toLowerCase().includes('linkedin') || !!step.message;

if (isLinkedIn && step.message) {
  bodyHtml = step.message;
}

// AFTER (fixed)  
const isLinkedIn = step.type?.toLowerCase().includes('linkedin');

if (isLinkedIn) {
  // LinkedIn steps: message is at step level (can be empty for Connect steps)
  if (step.message && step.message.trim()) {
    bodyHtml = step.message;
  }
  // More specific step type based on actionType
  if (step.actionType) {
    stepType = `linkedin_${step.actionType.toLowerCase()}`;
  }
}
```

---

### After Fix: Re-sync Required

Yes, you'll need to **re-sync the copy** after we deploy the fix. The data is already in `raw_data`, but we need to:

1. Deploy the fixed edge function
2. Click "Sync Copy" on the campaigns
3. LinkedIn messages will then populate `body_html` / `body_text`

---

### Summary

| Action | Details |
|--------|---------|
| Fix edge function | Correct LinkedIn detection and message extraction |
| Re-deploy | Automatic after code change |
| Re-sync campaigns | Click "Sync Copy" button for each campaign |

The LinkedIn copy will then appear in the Copy tab alongside email content.

