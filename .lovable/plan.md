

## Clarify LinkedIn Stats Upload Behavior in UI

### Current State
The dialog has a mode selector ("Replace" / "Add to existing") but provides no explanation of what each mode does.

### Goal
Make it crystal clear that "Replace" mode will overwrite existing LinkedIn stats, which is the desired behavior for re-uploading corrected data.

### Changes

#### 1. Add Descriptive Text Under Mode Selector
Add helper text that explains both modes clearly:

| Mode | Description |
|------|-------------|
| **Replace** | "Overwrites existing LinkedIn stats with the values from this CSV. Email stats are preserved." |
| **Add to existing** | "Adds CSV values on top of existing LinkedIn stats (for cumulative updates)." |

#### 2. Update Mode Labels for Clarity
Rename the options to be more descriptive:
- "Replace" → "Replace LinkedIn Stats"
- "Add to existing" → "Add to Existing Stats"

#### 3. Add Confirmation Message Before Import
When "Replace" mode is selected and matched campaigns exist, show a subtle confirmation:
```
"This will overwrite LinkedIn stats for {matchedCount} existing campaigns."
```

#### 4. Update Dialog Description
Change from:
> "Import historical LinkedIn metrics from a Reply.io report CSV"

To:
> "Import or update LinkedIn metrics. Use 'Replace' to overwrite existing stats with fresh data."

### Files to Modify

| File | Changes |
|------|---------|
| `src/components/playground/LinkedInStatsUploadDialog.tsx` | Add mode descriptions, update labels, add confirmation text |

### Implementation Details

**Mode Section Update (around line 315):**
```tsx
<div className="flex flex-col gap-2">
  <div className="flex items-center gap-2">
    <Label htmlFor="mode" className="text-sm">Mode:</Label>
    <Select value={mode} onValueChange={(v: 'replace' | 'add') => setMode(v)}>
      <SelectTrigger id="mode" className="w-[180px]">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="replace">Replace LinkedIn Stats</SelectItem>
        <SelectItem value="add">Add to Existing Stats</SelectItem>
      </SelectContent>
    </Select>
  </div>
  <p className="text-xs text-muted-foreground">
    {mode === 'replace' 
      ? 'Overwrites existing LinkedIn stats with values from this CSV. Email stats are preserved.'
      : 'Adds CSV values on top of existing LinkedIn stats (for cumulative updates).'}
  </p>
</div>
```

**Confirmation Text Before Import Button (around line 379):**
```tsx
{mode === 'replace' && matchedCount > 0 && (
  <p className="text-xs text-muted-foreground mr-auto">
    This will overwrite LinkedIn stats for {matchedCount} existing campaign{matchedCount > 1 ? 's' : ''}.
  </p>
)}
```

### Expected Result
After these changes:
- Users clearly understand that "Replace" will overwrite their existing LinkedIn stats
- The behavior is explicitly stated, removing any ambiguity
- Users feel confident re-uploading CSVs to correct/update their data
- Email stats preservation is clearly communicated

