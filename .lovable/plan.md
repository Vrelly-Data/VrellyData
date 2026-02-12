

# Fix Bulk Delete for Large Entry Counts

## Problem

Deleting 1000 entries at once fails with "Bad Request" because the `.in('id', ids)` call generates a URL that exceeds PostgREST's maximum URL length. Each UUID is 36 characters, so 1000 of them creates a query string far too long.

## Solution

Batch the delete operation into chunks of 100 IDs per request inside the `bulkDeleteEntries` mutation in `src/hooks/useAdminSalesKnowledge.ts`.

## Changes

### `src/hooks/useAdminSalesKnowledge.ts`

Update the `bulkDeleteEntries` mutation to:

1. Split the ID array into chunks of 100
2. Execute each chunk sequentially (to avoid hammering the backend)
3. Throw on the first error encountered

```text
mutationFn: async (ids: string[]) => {
  const CHUNK = 100;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const batch = ids.slice(i, i + CHUNK);
    const { error } = await supabase
      .from('sales_knowledge')
      .delete()
      .in('id', batch);
    if (error) throw error;
  }
}
```

No other files need to change. The UI, selection logic, and confirmation dialog all remain the same.
