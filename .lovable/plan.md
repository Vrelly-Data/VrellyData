
## Enhance Contact Data Collection and Display

### Current State Analysis

From the database, Reply.io provides these fields in `raw_data` that we're **not currently storing as columns**:

| Field | Sample Data | Currently Stored |
|-------|-------------|-----------------|
| `company` | "Dye Lumber" | Yes (column exists) |
| `industry` | "Building Construction" (16% populated) | No (only in raw_data) |
| `companySize` | "Empty" (most empty in Reply) | No (only in raw_data) |
| `city` | "Monticello" | No (only in raw_data) |
| `state` | "IN" | No (only in raw_data) |
| `country` | "US" | No (only in raw_data) |
| `phone` | "+12198690061" | No (only in raw_data) |
| `linkedInProfile` | "linkedin.com/in/..." | No (only in raw_data) |
| `addingDate` | "2026-01-27T19:53:57" | No (only in engagement_data.addedTime) |

**Engagement data already tracked:**
- `replied`, `opened`, `clicked`, `bounced`, `optedOut`, `finished` (booleans)
- `addedTime` (timestamp)

---

### Implementation Plan

#### Phase 1: Database Schema Update

**Add new columns to `synced_contacts` table:**
```sql
ALTER TABLE synced_contacts 
ADD COLUMN IF NOT EXISTS industry TEXT,
ADD COLUMN IF NOT EXISTS company_size TEXT,
ADD COLUMN IF NOT EXISTS city TEXT,
ADD COLUMN IF NOT EXISTS state TEXT,
ADD COLUMN IF NOT EXISTS country TEXT,
ADD COLUMN IF NOT EXISTS phone TEXT,
ADD COLUMN IF NOT EXISTS linkedin_url TEXT,
ADD COLUMN IF NOT EXISTS added_at TIMESTAMPTZ;
```

---

#### Phase 2: Update Edge Function (sync-reply-contacts)

**File:** `supabase/functions/sync-reply-contacts/index.ts`

Extract additional fields from the Reply.io API response:

```typescript
const records = batch.map(person => ({
  // Existing fields...
  
  // NEW: Additional contact data
  industry: person.industry || null,
  company_size: person.companySize !== 'Empty' ? person.companySize : null,
  city: person.city || null,
  state: person.state || null,
  country: person.country || null,
  phone: person.phone || null,
  linkedin_url: person.linkedInProfile || null,
  added_at: person.addingDate || person.addedAt || null,
}));
```

Also update the `ReplyPerson` interface to include all available fields.

---

#### Phase 3: Update Frontend (PeopleTab.tsx)

**Add new columns to the table:**
- Company (already in DB, just not displayed)
- Industry
- Location (City, State, Country combined)
- Phone
- LinkedIn (link)
- Added Date
- Opened (boolean badge)
- Clicked (boolean badge)
- Opted Out (boolean badge)

**Updated table headers:**
```
Name | Email | Company | Title | Industry | Location | Status | Opened | Replied | Added
```

---

#### Phase 4: Update Hooks and CSV Export

**File:** `src/hooks/useSyncedContactsPaged.ts`

Add new fields to the select query:
```typescript
.select('id, email, first_name, last_name, company, job_title, status, 
         campaign_id, engagement_data, industry, city, state, country, 
         phone, linkedin_url, added_at', { count: 'exact' })
```

**File:** `src/hooks/useSyncedContacts.ts`

Update the interface to include new fields.

**CSV Export update:**
```typescript
const headers = [
  'Email', 'First Name', 'Last Name', 'Company', 'Job Title', 
  'Industry', 'City', 'State', 'Country', 'Phone', 'LinkedIn',
  'Status', 'Opened', 'Replied', 'Clicked', 'Opted Out', 'Added Date'
];
```

---

### Files to Modify

| File | Changes |
|------|---------|
| `supabase/functions/sync-reply-contacts/index.ts` | Add new fields to ReplyPerson interface and record mapping |
| `src/hooks/useSyncedContacts.ts` | Update SyncedContact interface with new fields |
| `src/hooks/useSyncedContactsPaged.ts` | Add new fields to select query and export function |
| `src/components/playground/PeopleTab.tsx` | Add Company, Industry, Location, Phone, engagement columns |
| `src/components/playground/ContactsListDialog.tsx` | Update to show new fields |
| **Migration** | Add new columns to synced_contacts table |

---

### Expected Outcome

| Before | After |
|--------|-------|
| 5 columns displayed | 10+ columns with full contact data |
| No industry/location data | Industry, City, State, Country visible |
| No phone/LinkedIn | Phone and LinkedIn columns available |
| Basic engagement (Opened only) | Opened, Replied, Clicked, Opted Out columns |
| Limited CSV export | Full data export with all fields |

---

### Data Availability Note

Some fields like `industry` and `companySize` are only populated if:
1. Reply.io has enriched the contact
2. The user included this data when uploading contacts to Reply

The UI will show "—" for empty values, but the columns will be ready for when this data is available.
