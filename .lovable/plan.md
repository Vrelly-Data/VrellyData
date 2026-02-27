
# Replace Integrations Tab with "Coming Soon" Dialog

## What Changes

Instead of showing the full external projects management UI, clicking "Add Project" or "Add Your First Project" on the Integrations tab will show a "Coming Soon" dialog with a subtle working/loading animation.

## Files to Change

### `src/components/settings/ExternalProjectsSettings.tsx`

- Remove the existing add-project dialog logic (form fields, API calls for add/delete/toggle)
- Replace `isAddDialogOpen` dialog content with a simple "Coming Soon" popup containing:
  - An animated spinner/loader icon (using Lucide's `Loader2` with `animate-spin`)
  - "Coming Soon" title
  - A short description like "We're working on integrations. Stay tuned!"
  - A single "Got it" close button
- Keep the overall layout (header + empty state card) so the tab still looks polished
- Remove unused state and handlers (`newProject`, `handleAddProject`, `handleDeleteProject`, `toggleProjectStatus`, `loadProjects`) since nothing is functional yet

### No other files need changes
The Settings page already renders `<ExternalProjectsSettings />` in the integrations tab -- that stays the same.
