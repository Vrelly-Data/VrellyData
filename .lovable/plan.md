

## Fix: Enable LinkedIn Copy Syncing

### Problem Identified

The Reply.io API returns **different data structures** for different step types:

| Step Type | Copy Location | Current Extraction | Result |
|-----------|---------------|-------------------|--------|
| **Email** | `step.templates[0].body` | Extracted correctly | Works |
| **LinkedIn** | `step.message` | Not extracted | Missing copy |
| **Condition** | No copy content | N/A | Correctly empty |

Looking at the actual data in your database:

**Email step (working):**
```json
{
  "type": "Email",
  "templates": [{ "body": "Hi {{FirstName}}...", "subject": "..." }]
}
```

**LinkedIn step (currently broken):**
```json
{
  "type": "LinkedIn",
  "actionType": "Message",
  "message": "<p>Hi {{FirstName}}, Are you doing any sort of outbound?...</p>"
}
```

The `message` field contains the LinkedIn copy but the edge function ignores it.

---

### Solution

Update the `sync-reply-sequences` edge function to:
1. Check if it's a LinkedIn step (type contains "LinkedIn" or step has `message` field)
2. Extract copy from `step.message` for LinkedIn steps
3. Extract copy from `step.templates[0].body` for Email steps
4. Store the LinkedIn `actionType` (Connect, Message, InMail) for better categorization

---

### Technical Changes

**File**: `supabase/functions/sync-reply-sequences/index.ts`

**Current Logic (broken for LinkedIn):**
```typescript
const template = step.templates?.[0];
const bodyHtml = template?.body || null;
const bodyText = bodyHtml ? stripHtml(bodyHtml) : null;
```

**Updated Logic (handles both):**
```typescript
// LinkedIn steps store message at step level, emails in templates
const isLinkedIn = step.type?.toLowerCase().includes('linkedin') || !!step.message;
const template = step.templates?.[0];

let bodyHtml: string | null = null;
let subject: string | null = null;

if (isLinkedIn && step.message) {
  // LinkedIn message content
  bodyHtml = step.message;
} else if (template?.body) {
  // Email template content
  bodyHtml = template.body;
  subject = template.subject || null;
}

const bodyText = bodyHtml ? stripHtml(bodyHtml) : null;

// More specific step type for LinkedIn
let stepType = step.type?.toLowerCase() || 'email';
if (isLinkedIn && step.actionType) {
  stepType = `linkedin_${step.actionType.toLowerCase()}`;
}
```

**Interface Update:**
```typescript
interface ReplyStep {
  id: number;
  sequenceId: number;
  type: string;
  number: number;
  delayInMinutes?: number;
  executionMode?: string;
  message?: string;          // ADD: LinkedIn message content
  actionType?: string;       // ADD: LinkedIn action type (Connect, Message, InMail)
  templates?: Array<{
    id: number;
    templateId?: number;
    subject?: string;
    body?: string;
  }>;
  stats?: { ... };
}
```

---

### Files to Modify

| File | Changes |
|------|---------|
| `supabase/functions/sync-reply-sequences/index.ts` | Extract LinkedIn `message` field and `actionType` |

---

### Expected Result After Fix

| Step Type | Before | After |
|-----------|--------|-------|
| Email | Copy displayed | Copy displayed |
| LinkedIn Message | Empty (no body) | Copy displayed |
| LinkedIn Connect | Empty | Shows connection request note (if any) |
| LinkedIn InMail | Empty | Copy displayed |
| Condition | Empty (correct) | Empty (correct) |

After re-syncing a campaign, LinkedIn steps will show their message content just like email steps.

