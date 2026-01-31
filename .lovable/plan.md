

## Fix Contacts Sync: 100 Limit and Missing Fields

### Issues Found

#### 1. Database Shows Only 100 Contacts (Not an API limit)
The edge function logs show it **actually fetched 5,000 contacts** from Reply.io, but only 100 are in the database. This is a database upsert issue - the sync likely timed out before completing all inserts.

**Evidence:**
- Edge function log: `Fetched 5000 contacts from Reply.io`
- Database count: `100 contacts`
- The "Plumbing Campaign" has 98 people in Reply.io but only 100 contacts in DB total across all campaigns

#### 2. Company Field Missing from Reply.io Extended Endpoint
The `/sequences/{id}/contacts/extended` endpoint **does not return company data**. Looking at the API response structure and your actual `raw_data`:

```json
{
  "email": "...",
  "firstName": "Adam",
  "lastName": "Resnick",
  "title": "",           // job title
  "addedAt": "...",
  "status": {...}
}
```

No `company` field exists in this endpoint. The `company` field requires using the **People API** (`/v1/people/{email}`) to get full contact details.

---

### Solution: Two-Part Fix

#### Part 1: Fix the 100 Contact Limit (Timeout Issue)

The edge function times out (3 min limit) trying to insert 5000+ contacts one-by-one. Use **batch upserts** instead:

**File:** `supabase/functions/sync-reply-contacts/index.ts`

```typescript
// BEFORE: Individual upserts (slow, causes timeout)
for (const contact of allContacts) {
  await supabase.from("synced_contacts").upsert({...});
}

// AFTER: Batch upserts (fast, completes in time)
const BATCH_SIZE = 100;
for (let i = 0; i < allContacts.length; i += BATCH_SIZE) {
  const batch = allContacts.slice(i, i + BATCH_SIZE);
  const records = batch.map(contact => ({...}));
  await supabase.from("synced_contacts").upsert(records, {
    onConflict: "campaign_id,email"
  });
}
```

#### Part 2: Fetch Full Contact Details (Including Company)

The extended sequence contacts endpoint doesn't include company. To get company data, we need to either:

**Option A - Enrich from People API (slower but more data):**
Call `/v1/people/{email}` for each contact to get full details including company, phone, LinkedIn URL, etc.

**Option B - Accept limitation (faster sync):**
Keep current approach but clearly document that company comes from custom fields if the user has them.

---

### Dynamic Fields Currently Tracked

| Field | Database Column | Source |
|-------|----------------|--------|
| Email | `email` | Direct from API |
| First Name | `first_name` | `firstName` |
| Last Name | `last_name` | `lastName` |
| Job Title | `job_title` | `title` |
| Company | `company` | **NOT in extended endpoint** |
| Status | `status` | Mapped from `status` object |
| Replied | `engagement_data.replied` | `status.replied` |
| Delivered | `engagement_data.delivered` | `status.delivered` |
| Bounced | `engagement_data.bounced` | `status.bounced` |
| Opened | `engagement_data.opened` | `status.opened` |
| Clicked | `engagement_data.clicked` | `status.clicked` |
| Opted Out | `engagement_data.optedOut` | `status.optedOut` |
| Added At | `engagement_data.addedAt` | `addedAt` |
| Last Step | `engagement_data.lastStepCompletedAt` | `lastStepCompletedAt` |
| Custom Fields | `custom_fields` | `customFields` (if present) |

---

### Implementation Plan

| Step | Change | File |
|------|--------|------|
| 1 | Switch to batch upserts (100 at a time) | Edge function |
| 2 | Add progress logging | Edge function |
| 3 | Optionally enrich with People API for company | Edge function |
| 4 | Update UI to show more fields from engagement_data | PeopleTab.tsx |

---

### Question for You

For the company data, which approach do you prefer?

**A) Enrich contacts** - Make additional API calls to get full contact details (company, phone, LinkedIn). This is slower but gives complete data.

**B) Keep it fast** - Accept that company data isn't available from the sequence contacts endpoint. Users would need to ensure company is in custom fields when adding contacts.

