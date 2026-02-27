

# Add Saved Audiences Library to People Tab

## What Changes
Add a "Saved Audiences" section at the bottom of the People tab (similar to the "Saved Copies" library in the Copy tab) so users can see and click into audiences they've built with the AI audience builder.

## How It Works
- After building and saving an audience, it already creates a `list` (with entity_type = 'person') and populates it with contacts via `list_items`
- The People tab will query these lists and display them as clickable cards
- Clicking a card opens a dialog showing the contacts in that audience

## Changes

### 1. `src/components/playground/PeopleTab.tsx`
- Import `useLists`, `useListItems` from `@/hooks/useLists`
- Add a "Saved Audiences" section below the contacts table (and also in the empty state), using the same divider + grid card pattern as the Copy tab
- Each card shows: audience name, contact count, and creation date
- Clicking a card opens a new `ViewAudienceDialog`
- Add state for `selectedListId` to control the dialog

### 2. `src/components/playground/ViewAudienceDialog.tsx` (new file)
- A dialog that receives a list ID and name
- Fetches `list_items` for that list using `useListItems`
- Displays a table of contacts (name, title, company, industry, location) from `entity_data`
- Includes a close button and the audience name in the header

### Technical Details
- Reuses existing `useLists('person')` hook -- no new queries needed
- Lists created by the Build Audience flow have description containing "Built from Data Playground" so they can be identified, but we'll show all person lists for simplicity (they're the user's saved audiences regardless of source)
- The `list_items.entity_data` JSON contains: name, title, company, industry, location, email, linkedin -- matching what BuildAudienceDialog saves
