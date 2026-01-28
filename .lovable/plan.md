

## Improve Reply.io Workspace Clarity in UI

Now that we understand Reply.io API keys are workspace-specific, we need to update the UI to make this crystal clear and guide users on how to access campaigns from other workspaces.

### Changes Overview

#### 1. Update ManageCampaignsDialog Warning Message

**Current behavior (lines 209-216):**
Shows a vague warning: "Only detected 1 team. If you expect multiple client teams, team discovery may be failing."

**New behavior:**
Replace with a clear, actionable message explaining the API key scope:

```
"Your API key only has access to this workspace ({campaigns.length} campaigns).
Reply.io uses separate API keys per workspace. To see campaigns from other 
client workspaces, add each workspace as a separate integration."
```

Add a button to quickly navigate to "Add Integration" from this warning.

#### 2. Update AddIntegrationDialog Help Text

**Current behavior (line 353-354):**
Shows generic text about agency accounts.

**New behavior:**
Update the help text to clearly explain:
- Each Reply.io workspace has its own API key
- To track multiple workspaces, add multiple integrations
- Where to find the API key in Reply.io (Settings → API)

#### 3. Add Workspace Name Display to IntegrationSetupCard

Show which workspace each integration belongs to by displaying the workspace name (first campaign's team name or ID) on the integration card. This helps users identify which workspace each integration represents.

#### 4. Add "Add Another Workspace" Quick Action

When viewing a Reply.io integration that only has access to one workspace, add a subtle prompt suggesting they can add another integration for other workspaces.

### Files to Modify

| File | Changes |
|------|---------|
| `src/components/playground/ManageCampaignsDialog.tsx` | Update single-team warning to explain workspace-scoped API keys; add "Add Integration" button |
| `src/components/playground/AddIntegrationDialog.tsx` | Improve help text explaining workspace-specific API keys |
| `src/components/playground/IntegrationSetupCard.tsx` | Show workspace name; add "Add Another Workspace" hint for Reply.io |

### Detailed Changes

#### ManageCampaignsDialog.tsx (lines 209-217)

Replace the vague warning with:

```tsx
{discoveredTeamsCount !== undefined && discoveredTeamsCount <= 1 && (
  <div className="flex flex-col gap-2 text-sm bg-amber-500/10 p-3 rounded-md border border-amber-500/20">
    <div className="flex items-center gap-2">
      <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
      <span className="font-medium text-amber-700 dark:text-amber-400">
        Single Workspace Detected
      </span>
    </div>
    <p className="text-muted-foreground text-xs">
      Your API key only has access to this workspace ({campaigns.length} campaigns). 
      Reply.io uses separate API keys per workspace. To track campaigns from other 
      client workspaces, add each one as a separate integration.
    </p>
    <Button
      variant="outline"
      size="sm"
      className="w-fit mt-1"
      onClick={() => {
        onOpenChange(false);
        // Trigger add integration dialog (via callback prop or event)
      }}
    >
      <Plus className="h-3 w-3 mr-1" />
      Add Another Workspace
    </Button>
  </div>
)}
```

#### AddIntegrationDialog.tsx (lines 340-356)

Update the optional Team ID section with clearer messaging:

```tsx
{platform === 'reply.io' && validationStatus === 'valid' && !isAgencyAccount && (
  <div className="grid gap-2 p-3 bg-muted/50 rounded-md">
    <div className="flex items-center gap-2 text-sm font-medium">
      <Building2 className="h-4 w-4" />
      Workspace API Key Detected
    </div>
    <p className="text-xs text-muted-foreground">
      This API key has access to one Reply.io workspace. Each workspace in Reply.io 
      has its own API key. To sync campaigns from multiple workspaces, add each 
      workspace as a separate integration.
    </p>
    {manualTeamId && (
      <div className="flex items-center gap-2 text-xs">
        <span className="text-muted-foreground">Workspace ID:</span>
        <Badge variant="secondary">{manualTeamId}</Badge>
      </div>
    )}
  </div>
)}
```

#### IntegrationSetupCard.tsx

Add a note under Reply.io integrations that shows only one workspace is linked, with a quick action to add another:

```tsx
{integration.platform.toLowerCase() === 'reply.io' && (
  <div className="text-xs text-muted-foreground mt-1">
    {integration.reply_team_id 
      ? `Workspace: ${integration.reply_team_id}` 
      : 'Single workspace'
    }
    {' · '}
    <button 
      className="text-primary hover:underline"
      onClick={() => setDialogOpen(true)}
    >
      Add another workspace
    </button>
  </div>
)}
```

### Expected Result

After these changes:
1. Users immediately understand that Reply.io API keys are workspace-specific
2. Clear guidance on how to add other workspaces (add more integrations)
3. No more confusion about "Show All Teams" not finding all campaigns
4. Each integration clearly shows which workspace it represents

### Technical Notes

- Remove or hide the "Show All Teams" toggle for Reply.io since it's misleading (workspace API keys can't access other workspaces)
- Keep the team discovery logic for future use if Reply.io ever provides agency-level keys
- Consider storing the workspace name (from the first campaign) in the integration record for display

