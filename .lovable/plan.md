
Goal
- Make Reply “Test Connection” provide a usable Team ID (dropdown when multiple teams; auto-fill when only one is detectable), and make “Sync” stop hanging by ensuring the sync function finishes within backend runtime limits.

What changed previously (in plain English)
- We updated the backend “team discovery” function to look at Reply’s newer API (/v3/sequences) because it contains team identifiers. However, for your account it’s only finding a single team, so the UI correctly shows “Team ID (Optional)” instead of a dropdown. The bigger issue is that clicking “Sync” currently runs an extremely long sync (includes contacts + 10s delay per campaign), so on large accounts it effectively never finishes.

Root causes found
1) No dropdown is expected when the backend only finds 1 team
- AddIntegrationDialog only shows the dropdown when fetch-reply-teams returns:
  - isAgencyAccount = true AND teams.length > 0
- isAgencyAccount is currently computed as teams.length > 1, so if only 1 team is detected, the dropdown won’t show.

2) “Sync” hangs because sync-reply-campaigns is guaranteed to exceed runtime for large accounts
- It fetches all campaigns, then for every campaign:
  - fetches steps
  - fetches all people (paginated)
  - then waits 10 seconds between campaigns
- With 50+ campaigns, the fixed 10s delay alone can exceed 8–10 minutes, so the backend execution will time out and the UI can remain stuck in “syncing”.

Implementation plan (backend + UI)

A) Make “Test Connection” always produce a usable Team ID (even if only one)
Files:
- supabase/functions/fetch-reply-teams/index.ts
- src/components/playground/AddIntegrationDialog.tsx

1) Update fetch-reply-teams response to include a “recommendedTeamId”
- Keep the current V3 /sequences probe.
- Track:
  - distinctTeamIds (Set)
  - sequencesCount
- Behavior:
  - If distinctTeamIds.size > 1:
    - Return teams[] (as today) and isAgencyAccount: true
  - If distinctTeamIds.size === 1:
    - Return teams: [] (or a single-item list) but ALSO return recommendedTeamId with that one ID and isAgencyAccount: false
  - If V3 fails and we fall back to V1 /campaigns ownerEmail:
    - Return recommendedTeamId as null and teams as discovered emails (only as a last-resort diagnostic)

Why
- Your UI currently only “helps” when there are multiple teams. For large accounts, we still need to scope sync. If Reply exposes only one teamId, we can at least auto-fill it so the integration saves with reply_team_id set.

2) Update AddIntegrationDialog to auto-fill the Team ID field when recommendedTeamId is present
- After “Test Connection” succeeds:
  - Call fetch-reply-teams
  - If multiple teams → show dropdown (existing behavior)
  - Else if recommendedTeamId exists → pre-fill manualTeamId with it and show a short message like:
    - “We detected your Team ID and filled it in. This helps large account sync finish reliably.”
- This keeps the “normal user” flow simple:
  - They still just click Test Connection → Connect
  - No confusing dropdown unless there are truly multiple teams

B) Make Sync complete reliably for large accounts (stop timeouts)
Files:
- supabase/functions/sync-reply-campaigns/index.ts
- (optional UI tweaks) src/hooks/useOutboundIntegrations.ts, src/components/playground/IntegrationSetupCard.tsx

3) Change sync-reply-campaigns to a “fast sync” by default
Current: campaigns + steps + contacts + 10s delay per campaign
New default: campaigns only (no per-campaign people/steps), which is enough to populate:
- Synced Campaigns table
- Most dashboard stats (deliveries, replies, opens, peopleCount) come from campaign.stats

Details
- Keep:
  - fetchAllPaginated("/campaigns", ...)
  - upsert into synced_campaigns with stats/raw_data
- Remove/skip by default:
  - /campaigns/{id}/steps
  - /campaigns/{id}/people
  - The fixed 10s delay loop (delete it entirely)

Why this fixes “Sync spinning forever”
- Campaign-only sync should finish quickly even for 50–200 campaigns, staying within the backend timeout. The UI will get a response and will stop showing “syncing”.

4) (Optional but recommended) Add a separate “Deep Sync Contacts” pathway
If you still need contacts/steps:
- Add a second backend function later (or add a parameter to the same one) to sync:
  - steps and/or contacts
  - but only for a limited subset (e.g. active campaigns, or last 10 updated campaigns)
This prevents reintroducing the timeout problem.

5) Improve stuck-state recovery in UI
Even after making sync faster, we should harden UX:
- If a request fails, make sure integration status is refreshed immediately (already does invalidateQueries on error).
- Add a “Reset stuck sync” option when sync_status === "syncing" for too long (can be determined using updated_at without schema changes).
This prevents permanent “syncing…” states if an execution is interrupted.

Testing checklist (end-to-end)
1) On /playground → Connect Platform → Reply.io:
   - Enter API key → Test Connection
   - Expected:
     - If multiple teams exist: dropdown appears
     - If only one team is detectable: Team ID field auto-fills with the detected ID (still labeled optional/recommended)
2) Click Connect
   - Confirm integration row shows “Team: <id>” badge (reply_team_id saved)
3) Click Sync
   - Expected:
     - Sync finishes within seconds to ~1 minute (depending on number of campaigns)
     - Status changes to “Synced”
     - Campaigns appear in “Synced Campaigns”
4) Confirm no infinite spinner; confirm errors surface as a toast and sync_status becomes “error” if anything fails.

Risks / edge cases
- If Reply’s API truly exposes only one teamId for your key, we can’t show multiple “clients” via dropdown. Auto-filling the detected teamId still improves reliability and consistency.
- If contacts are essential for your workflow, we’ll implement Deep Sync as a separate, bounded operation so it cannot wedge the main Sync button.

Scope boundaries (kept)
- No changes to core app data (people/company records). Data Playground remains isolated.
- No changes required to authentication logic; we only adjust these integration-related functions and UI components.
