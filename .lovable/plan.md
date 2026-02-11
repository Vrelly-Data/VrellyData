

# Fix: CSV Import Crashing on Empty Column Values

## Problem

When uploading a CSV, the import dialog crashes with the error:
> "A Select.Item must have a value prop that is not an empty string"

This happens because:
1. CSV files can have empty/blank column headers (e.g., trailing commas creating unnamed columns)
2. The AI mapping response may return empty strings for optional fields like `tags`, `sourceCampaign`, or metric column names
3. Radix UI's `Select.Item` component strictly requires a non-empty `value` prop

## Fix

### File: `src/components/admin/SalesKnowledgeImportDialog.tsx`

**1. Filter out empty headers** (line ~129)

Change `headerOptions` to filter out any blank CSV headers before building the dropdown options:
```typescript
const headerOptions = useMemo(
  () => [
    { value: NONE, label: '-- None --' },
    ...headers.filter((h) => h.trim() !== '').map((h) => ({ value: h, label: h })),
  ],
  [headers]
);
```

**2. Sanitize AI mapping response** (line ~169)

After receiving the AI mapping, ensure no field contains an empty string -- convert empties to `null` (for optional fields) or fall back to the first valid header (for required fields):
```typescript
const sanitized = {
  ...result.mapping,
  title: result.mapping.title || validHeaders[0] || '',
  content: result.mapping.content || validHeaders[1] || validHeaders[0] || '',
  categoryColumn: result.mapping.categoryColumn || null,
  tags: result.mapping.tags || null,
  sourceCampaign: result.mapping.sourceCampaign || null,
  metrics: Object.fromEntries(
    Object.entries(result.mapping.metrics || {}).filter(([, v]) => v && v.trim() !== '')
  ),
};
```

**3. Guard the MappingRow component** (line ~523)

Ensure the `Select` value is never an empty string -- fall back to `NONE`:
```typescript
<Select value={value || NONE} onValueChange={onChange}>
```

**4. Guard metric Select values** (line ~394)

Same fix for metric column dropdowns:
```typescript
<Select value={col || NONE} onValueChange={(v) => updateMetric(name, v)}>
```

## No Other Changes

- Edge function -- unchanged
- Hook -- unchanged
- Database -- unchanged
- Doc import -- unchanged (already working)

