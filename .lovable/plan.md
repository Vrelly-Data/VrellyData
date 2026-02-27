

# Fix Missing Contact Data in Data Playground AI Audience Builder

## Problem
The `build-audience` edge function (used only by the Data Playground's People tab AI builder) maps contact fields too narrowly. It checks `d.email` and `d.linkedin`, but the actual database stores emails under `businessEmail`/`personalEmail` and LinkedIn under `linkedinUrl`. Every contact has this data -- it's just not being read.

This does NOT affect the main Audience Builder page, which has its own separate data pipeline.

## Fix

### `supabase/functions/build-audience/index.ts` (lines 213-224)

Update the prospect mapping to include all known field name variants:

```text
Current:
  email: d.email || null,
  linkedin: d.linkedin || null,

Fixed:
  email: d.email || d.businessEmail || d.personalEmail || null,
  linkedin: d.linkedin || d.linkedinUrl || null,
```

Also improve location mapping to check additional fields:

```text
Current:
  location: [d.city, d.country].filter(Boolean).join(", ") || "---",

Fixed:
  location: [d.city || d.personCity, d.country || d.personCountry].filter(Boolean).join(", ") || "---",
```

### Scope
- Only the `build-audience` edge function is touched
- No changes to the main Audience Builder, database, or any other component
- Contacts saved going forward will have full email/LinkedIn data in `list_items.entity_data`
- Previously saved audiences will still show old (incomplete) data since it was already persisted

