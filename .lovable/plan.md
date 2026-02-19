
## Add Channels Selection to "Create Copy" Form

### Overview

Add a multi-select channel picker to the Create Copy form so users can indicate which outreach channels they use. This information is then passed to the AI to generate channel-appropriate copy (e.g. shorter, no subject line for LinkedIn DMs vs. full email threads).

---

### What Changes

#### File 1: `src/components/playground/CreateCopyDialog.tsx`

**New UI field** — a clickable chip/toggle group between the B2B/B2C toggle and the "Target Titles" field:

- Label: `"Which channels do you use for outreach?"`
- Pre-defined options rendered as toggleable badge chips:
  - Email
  - LinkedIn
  - Twitter message
  - Instagram message
  - Facebook message
- Users click to select/deselect — no typing required (fast UX)
- State: `channels: string[]` (multi-select, no minimum required)
- Pass `channels` alongside existing fields in the `supabase.functions.invoke('generate-copy', ...)` call

The result view already shows steps with a `Mail` icon — that will be updated to show a channel label per step if multiple channels are selected (e.g. "Step 1 — Email", "Step 2 — LinkedIn").

**Updated `GeneratedCopy` interface** — add optional `channel` field to `CopyStep`:
```ts
interface CopyStep {
  step: number;
  day: number;
  subject?: string;  // already optional effectively
  body: string;
  channel?: string;  // new
}
```

**Updated description text** — change the dialog subtitle from "email sequence" to "outreach sequence" to reflect multi-channel.

---

#### File 2: `supabase/functions/generate-copy/index.ts`

**Destructure `channels`** from the request body alongside existing fields.

**Update the system prompt** to:
1. Include the selected channels in the Business Details section: `- Outreach channels: ${channels.join(", ") || "Email"}`
2. Change the generation instruction from "Generate a 3-step email sequence" to:
   - If only Email selected (or none): keep the current 3-step email sequence instruction
   - If multiple channels selected: instruct the AI to generate one sequence step per channel, tailoring tone and format to each (e.g. LinkedIn = shorter, no subject; Email = subject + body; Twitter/Instagram/Facebook = very short, casual)
3. Update the JSON shape instruction to include `"channel"` in each step:
   ```json
   { "step": 1, "day": 1, "channel": "Email", "subject": "...", "body": "..." }
   ```

**Result view** — the step card in the dialog will show the channel badge if present (e.g. `LinkedIn` badge next to `Day 4`), and hide the "Subject" row for non-email channels where it's not applicable.

---

### UI Layout of the New Field

```text
[ Is this B2B or B2C? ]
  [ B2B ]  [ B2C ]

[ Which channels do you use for outreach? ]
  [ Email ✓ ]  [ LinkedIn ]  [ Twitter message ]
  [ Instagram message ]  [ Facebook message ]

[ Target titles... ]
```

Chips use the same active/inactive styling as the B2B/B2C toggle buttons — filled primary when selected, outlined when not. Multiple can be selected simultaneously.

---

### No Database Changes Required

This is a pure UI + edge function prompt update. No schema migrations needed.
