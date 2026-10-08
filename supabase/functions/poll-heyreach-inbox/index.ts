/*
-- Required schema changes:
ALTER TABLE public.agent_leads ADD COLUMN IF NOT EXISTS heyreach_conversation_id TEXT;
ALTER TABLE public.agent_leads ADD COLUMN IF NOT EXISTS heyreach_account_id INTEGER;
ALTER TABLE public.synced_campaigns ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'reply_io';
*/

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { shouldResurface, fireClassifyReply } from '../_shared/inbox-reply.ts';
import { cleanReplyPreview } from '../_shared/reply-text.ts';
import { sanitizeLinkedinUrlForStorage } from '../_shared/normalize.ts';
import { findLeadByNormalizedLinkedIn } from '../_shared/agent-leads-lookup.ts';
import { isStaleProspectMessage } from '../_shared/stale.ts';
import { decideSurfaceAndClassify, buildSurfaceUpdateFields } from '../_shared/surface.ts';
import { listEnabledCampaignIds, normalizeCampaignId, numericCampaignIds, recordCaptureScopeSkips, type CaptureSkipRecord } from '../_shared/capture-scope.ts';
import { HEYREACH_DRAFTING_ENV, heyreachClassifyGate, isHeyReachDraftingEnabled } from '../_shared/heyreach-drafting.ts';
import {
  applyScope,
  canonicalScope,
  tickWithHeadScan,
  type HeadScanResult,
  type HeadScanStopReason,
  type Phase,
  type StopReason,
  type WalkState,
  DEFAULT_PAGER_OPTIONS,
} from './paging.ts';

const allowedOrigins = [
  'https://vrelly.com',
  'https://www.vrelly.com',
];

function getCorsHeaders(req: Request) {
  const origin = req.headers.get('Origin') || '';
  return {
    'Access-Control-Allow-Origin': allowedOrigins.includes(origin) ? origin : allowedOrigins[0],
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-agent-key',
  };
}

const HEYREACH_API = 'https://api.heyreach.io/api/public';

// DB calls outside item processing (integration/config/scope lookups, state
// saves) are capped at this so a hung supabase-js request cannot push a run past
// the 150s edge limit. On timeout supabase-js resolves with an error.
const DB_TIMEOUT_MS = 5_000;

// Every DB call made while processing one conversation honours the pager's
// per-item signal (itemFetchTimeoutMs, 8s, shared with GetChatroom), so a whole
// item stays inside the 10s minRemainingForNextItemMs guard. The query is
// aborted where supabase-js allows it, and the await is raced against the
// signal, so even a call that ignores the abort (the shared lookup helper)
// cannot hang the item. A timeout throws: the item counts as a failure and
// nothing after the timed-out call is written.
async function itemDb<T>(label: string, signal: AbortSignal, run: (signal: AbortSignal) => PromiseLike<T>): Promise<T> {
  if (signal.aborted) throw new Error(`db_timeout: ${label}`);
  let onAbort = () => {};
  const timedOut = new Promise<never>((_, reject) => {
    onAbort = () => reject(new Error(`db_timeout: ${label}`));
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    return await Promise.race([Promise.resolve(run(signal)), timedOut]);
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}

// ── Capture Scope: recapture + skip probe ───────────────────────────────────
// This poller asks HeyReach only for capture-ENABLED campaigns (campaignIds
// filter), so on its own it never sees a reply capture dropped. The probe
// checks a few capture-off campaigns per run (rotating, oldest-probed first),
// one GetConversationsV2 page each, and records replies from the last 14 days
// in capture_scope_skips. Read-only towards HeyReach.
const RECAPTURE_MAX_LOOKBACK_DAYS = 14;
const PROBE_CAMPAIGNS_PER_RUN = 3;
const PROBE_LOOKBACK_DAYS = 14;
const PROBE_MIN_REMAINING_MS = 20_000;

async function probeCaptureOffHeyReach(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  integration: { id: string; team_id: string },
  apiKey: string,
): Promise<{ probed: number; skips: number }> {
  const { data, error } = await supabase
    .from('synced_campaigns')
    .select('external_campaign_id, name, status, capture_skip_probe_at')
    .eq('integration_id', integration.id)
    .eq('capture_enabled', false)
    .neq('status', 'draft')
    .order('capture_skip_probe_at', { ascending: true, nullsFirst: true })
    .limit(200)
    .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS));
  if (error) {
    console.warn(`[poll-heyreach-inbox] probe: campaign lookup failed: ${error.message}`);
    return { probed: 0, skips: 0 };
  }
  type Row = { external_campaign_id: string; name: string | null; status: string | null; capture_skip_probe_at: string | null };
  const weight = (st: string | null) => {
    const v = (st ?? '').toLowerCase();
    return v === 'in_progress' || v === 'active' ? 0 : v === 'paused' ? 1 : 2;
  };
  const rows = ((data ?? []) as Row[])
    .filter((r) => numericCampaignIds([String(r.external_campaign_id)]).length === 1)
    .sort((a, b) => {
      const w = weight(a.status) - weight(b.status);
      if (w !== 0) return w;
      const at = a.capture_skip_probe_at ? Date.parse(a.capture_skip_probe_at) : 0;
      const bt = b.capture_skip_probe_at ? Date.parse(b.capture_skip_probe_at) : 0;
      return at - bt;
    })
    .slice(0, PROBE_CAMPAIGNS_PER_RUN);
  if (rows.length === 0) return { probed: 0, skips: 0 };

  const cutoff = Date.now() - PROBE_LOOKBACK_DAYS * 86400_000;
  const records: CaptureSkipRecord[] = [];
  for (const row of rows) {
    const id = String(row.external_campaign_id);
    try {
      const res = await fetch(`${HEYREACH_API}/inbox/GetConversationsV2`, {
        method: 'POST',
        headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({
          // Exactly one campaign id: a non-empty list (an empty one means
          // "every campaign") and it attributes each conversation.
          filters: { linkedInAccountIds: [], campaignIds: numericCampaignIds([id]), searchString: '' },
          offset: 0,
          limit: 25,
        }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) {
        console.warn(`[poll-heyreach-inbox] probe: campaign ${id} -> HTTP ${res.status}`);
        continue;
      }
      const page = await res.json().catch(() => ({}));
      // deno-lint-ignore no-explicit-any
      for (const convo of (Array.isArray(page?.items) ? page.items : []) as any[]) {
        if (!convo?.lastMessageText || convo.lastMessageSender === 'ME') continue;
        const at = Date.parse(convo.lastMessageAt ?? '');
        if (Number.isFinite(at) && at < cutoff) continue;
        const profile = convo.correspondentProfile || {};
        records.push({
          integrationId: integration.id,
          teamId: integration.team_id,
          platform: 'heyreach',
          campaignExternalId: id,
          campaignName: row.name,
          contactLinkedinUrl: sanitizeLinkedinUrlForStorage(profile.profileUrl || ''),
          contactName: [profile.firstName, profile.lastName].filter(Boolean).join(' ') || null,
          contactFallbackId: convo.id != null ? String(convo.id) : null,
          occurredAt: Number.isFinite(at) ? new Date(at).toISOString() : null,
          reason: 'capture_disabled',
          source: 'heyreach-probe',
        });
      }
    } catch (e) {
      console.warn(`[poll-heyreach-inbox] probe: campaign ${id} failed (${e instanceof Error ? e.message : String(e)})`);
    }
  }
  const { error: cursorErr } = await supabase
    .from('synced_campaigns')
    .update({ capture_skip_probe_at: new Date().toISOString() })
    .eq('integration_id', integration.id)
    .in('external_campaign_id', rows.map((r) => String(r.external_campaign_id)))
    .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS));
  if (cursorErr) console.warn(`[poll-heyreach-inbox] probe: cursor update failed: ${cursorErr.message}`);
  const skips = await recordCaptureScopeSkips(supabase, records);
  return { probed: rows.length, skips };
}

type Counts = {
  seen: number;
  polled: number;
  new: number;
  skippedNoText: number;
  skippedSenderMe: number;
  skippedSameText: number;
};
const newCounts = (): Counts => ({ seen: 0, polled: 0, new: 0, skippedNoText: 0, skippedSenderMe: 0, skippedSameText: 0 });

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  console.log(`[poll-heyreach-inbox] START method=${req.method}`);

  try {
    // Auth: x-agent-key for cron, or JWT for manual trigger
    const agentKey = req.headers.get('x-agent-key');
    const expectedKey = Deno.env.get('AGENT_API_KEY');
    const authHeader = req.headers.get('authorization');

    let filterUserId: string | null = null;

    // Recapture mode (fetch-capture-scope, x-agent-key only): ONE integration,
    // only the given capture-enabled campaigns, conversations from the last
    // lookbackDays (≤14), processed by the same per-conversation capture as
    // the walk. No walk/baseline state is read or written, and no probe runs.
    const reqBody = await req.json().catch(() => ({})) as {
      mode?: string; integrationId?: string; campaignIds?: unknown[]; lookbackDays?: number;
    };
    const isAgent = !!agentKey && agentKey === expectedKey;
    const recapture = isAgent && reqBody?.mode === 'recapture' && reqBody.integrationId && Array.isArray(reqBody.campaignIds)
      ? {
          integrationId: String(reqBody.integrationId),
          campaignIds: new Set(reqBody.campaignIds.map((id) => normalizeCampaignId(id)).filter((id): id is string => !!id)),
          lookbackDays: Math.min(RECAPTURE_MAX_LOOKBACK_DAYS, Math.max(1, Number(reqBody.lookbackDays) || RECAPTURE_MAX_LOOKBACK_DAYS)),
        }
      : null;
    if (recapture) {
      console.log(`[poll-heyreach-inbox] RECAPTURE integration=${recapture.integrationId} campaigns=${recapture.campaignIds.size} lookbackDays=${recapture.lookbackDays}`);
    }
    let probeCampaigns = 0;
    let probeSkips = 0;

    if (agentKey && agentKey === expectedKey) {
      console.log('[poll-heyreach-inbox] auth=agent_key (cron path), filterUserId=null');
      filterUserId = null;
    } else if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.replace('Bearer ', '');
      const userClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
        global: { headers: { Authorization: `Bearer ${token}` } },
      });
      const { data: { user } } = await userClient.auth.getUser();
      if (!user) {
        console.warn('[poll-heyreach-inbox] auth=bearer but getUser returned null → 401');
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      filterUserId = user.id;
      console.log(`[poll-heyreach-inbox] auth=bearer, filterUserId=${filterUserId}`);
    } else {
      console.warn(
        `[poll-heyreach-inbox] auth=missing → 401. agentKey_present=${!!agentKey} agentKey_match=${!!agentKey && agentKey === expectedKey} expectedKey_present=${!!expectedKey} authHeader_present=${!!authHeader}`,
      );
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // HeyReach drafting switch, read per request so unsetting the secret is an
    // instant off switch. Default OFF: only the exact string 'true' enables it.
    const draftingEnabled = isHeyReachDraftingEnabled(Deno.env.get(HEYREACH_DRAFTING_ENV));
    console.log(`[poll-heyreach-inbox] drafting=${draftingEnabled ? 'on' : 'off'} (${HEYREACH_DRAFTING_ENV})`);

    // Fetch active HeyReach integrations (include persistent state)
    let query = supabase
      .from('outbound_integrations')
      .select('id, created_by, team_id, api_key_encrypted, heyreach_poll_state')
      .eq('is_active', true)
      .eq('platform', 'heyreach')
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS));

    if (filterUserId) {
      query = query.eq('created_by', filterUserId);
    }
    if (recapture) {
      query = query.eq('id', recapture.integrationId);
    }

    const { data: integrations, error: intError } = await query;

    if (intError) {
      console.error('Failed to fetch integrations:', intError.message);
      return new Response(JSON.stringify({ error: 'Failed to fetch integrations' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(
      `[poll-heyreach-inbox] Found ${integrations?.length ?? 0} active heyreach integrations` +
        (integrations && integrations.length > 0
          ? ` (ids: ${integrations.map((i) => i.id).join(',')})`
          : ''),
    );

    // Walk and head-scan counters are kept apart: the top-level polled/new/seen/
    // skipped totals count walk work only, and head-scan work is reported under
    // headScan.counts, so page-1 items are not double-counted.
    const walkCounts = newCounts();
    const headCounts = newCounts();
    let integrationsSkippedNoKey = 0;
    // Fail-closed Capture Scope skips (integration id + reason only).
    const captureScopeSkips: Array<{ integrationId: string; reason: 'none_enabled' | 'lookup_error' }> = [];
    let integrationsSkippedNoAgentConfig = 0;

    // Order integrations by lastTick.at ascending, nulls first
    const ordered = (integrations ?? []).slice().sort((a: any, b: any) => {
      const aAt = Date.parse((a?.heyreach_poll_state?.lastTick?.at as string) || '');
      const bAt = Date.parse((b?.heyreach_poll_state?.lastTick?.at as string) || '');
      const aVal = Number.isFinite(aAt) ? aAt : Number.NEGATIVE_INFINITY;
      const bVal = Number.isFinite(bAt) ? bAt : Number.NEGATIVE_INFINITY;
      return aVal - bVal;
    });

    const startedAtMs = Date.now();
    const deadline = startedAtMs + DEFAULT_PAGER_OPTIONS.runBudgetMs;
    const remaining = () => Math.max(0, deadline - Date.now());

    type PerIntegrationSummary = {
      integrationId: string;
      stopReason: StopReason;
      pagesFetched: number;
      conversationsProcessed: number;
      failures: number;
      walkStartedAt: string | null;
      walkOffset: number | null;
      baselineStartedAt: string | null;
      headScan: HeadScanResult;
    };
    const perIntegration: PerIntegrationSummary[] = [];
    let overallStop: StopReason | null = null;
    // Head-scan totals across integrations. stopReason precedence:
    // fetch_error > time_budget > complete > skipped_budget > skipped_walk_at_head.
    const headScanRank: Record<HeadScanStopReason, number> = {
      skipped_walk_at_head: 0,
      skipped_budget: 1,
      complete: 2,
      time_budget: 3,
      fetch_error: 4,
    };
    const headScanTotal: { items: number; failures: number; elapsedMs: number; stopReason: HeadScanStopReason | null; counts: Counts } = {
      items: 0,
      failures: 0,
      elapsedMs: 0,
      stopReason: null,
      counts: headCounts,
    };
    const addHeadScan = (h: HeadScanResult) => {
      headScanTotal.items += h.items;
      headScanTotal.failures += h.failures;
      headScanTotal.elapsedMs += h.elapsedMs;
      if (headScanTotal.stopReason === null || headScanRank[h.stopReason] > headScanRank[headScanTotal.stopReason]) {
        headScanTotal.stopReason = h.stopReason;
      }
    };

    for (const integration of ordered) {
      try {
        const apiKey = integration.api_key_encrypted;
        if (!apiKey) {
          console.warn(`[poll-heyreach-inbox] No API key for integration ${integration.id}`);
          integrationsSkippedNoKey++;
          continue;
        }

        const userId = integration.created_by;
        // Skip starting when not enough remaining budget
        if (remaining() < DEFAULT_PAGER_OPTIONS.minRemainingForNextPageMs) {
          perIntegration.push({
            integrationId: integration.id,
            stopReason: 'time_budget',
            pagesFetched: 0,
            conversationsProcessed: 0,
            failures: 0,
            walkStartedAt: (integration?.heyreach_poll_state?.walk?.startedAt as string) ?? null,
            walkOffset: (integration?.heyreach_poll_state?.walk?.offset as number) ?? null,
            baselineStartedAt: (integration?.heyreach_poll_state?.baselineStartedAt as string) ?? null,
            headScan: { items: 0, failures: 0, elapsedMs: 0, stopReason: 'skipped_budget' },
          });
          continue;
        }

        // Check for active agent config
        const { data: agentConfig, error: agentConfigErr } = await supabase
          .from('agent_configs')
          .select('*')
          .eq('user_id', userId)
          .eq('is_active', true)
          .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS))
          .maybeSingle();

        if (agentConfigErr) {
          console.error(`[poll-heyreach-inbox] agent config lookup failed for user ${userId}: ${agentConfigErr.message} — skipping this tick`);
          integrationsSkippedNoAgentConfig++;
          continue;
        }
        if (!agentConfig) {
          console.log(`[poll-heyreach-inbox] No active agent config for user ${userId}, skipping`);
          integrationsSkippedNoAgentConfig++;
          continue;
        }

        // === Capture Scope gate ==============================================
        // Enforcement point 4 of 4, and the reason HeyReach needed its own
        // stage. This poller is a lead-CREATING path that bypasses points 1-3
        // entirely: it reads the whole inbox rather than reacting to a webhook.
        //
        // It also has no attribution to filter on after the fact — verified
        // against the live API, a GetConversationsV2 conversation carries
        // id/read/groupChat/lastMessage*/linkedInAccountId/correspondentProfile
        // and NO campaign field whatsoever. So the scope must be applied at the
        // REQUEST, via the campaignIds filter. Confirmed additive against prod:
        // 518402 alone = 49, 508828 alone = 39, both = 88; all three with
        // 507230 = 129. It is a true multi-value allow-list, not first-id-wins.
        //
        // THE TRAP: campaignIds: [] means "every campaign". So the scope is
        // FAIL CLOSED via the shared helper (synced_campaigns.capture_enabled
        // keyed by integration_id, the single source of truth for capture):
        //   - lookup error (incl. timeout)         → skip this integration
        //   - no synced rows / none enabled / no   → skip this integration
        //     integer id among the enabled rows
        // A skip means: no HeyReach call (no walk, no head scan), no
        // agent_leads write and NO state write, so the persisted baseline,
        // walk and scope are exactly as they were. It is logged and reported
        // in skipped.captureScope. There is no unfiltered mode.
        const scopeResult = await listEnabledCampaignIds(supabase, String(integration.id), { timeoutMs: DB_TIMEOUT_MS });
        // HeyReach filters on INTEGER campaign ids (row order kept for the request).
        // Recapture narrows the filter to the requested campaigns that are
        // still enabled; it never widens it.
        const campaignIdFilter: number[] = scopeResult.ok
          ? numericCampaignIds(recapture ? scopeResult.ids.filter((id) => recapture.campaignIds.has(id)) : scopeResult.ids)
          : [];
        const scope = canonicalScope(campaignIdFilter);
        if (!scope) {
          const reason = scopeResult.ok ? 'none_enabled' : scopeResult.reason;
          // Nothing enabled is exactly where replies vanish: still probe the
          // capture-off campaigns (not on lookup_error, not in recapture).
          if (!recapture && reason === 'none_enabled' && remaining() > PROBE_MIN_REMAINING_MS) {
            try {
              const probe = await probeCaptureOffHeyReach(supabase, { id: String(integration.id), team_id: String(integration.team_id) }, apiKey);
              probeCampaigns += probe.probed;
              probeSkips += probe.skips;
            } catch (e) {
              console.warn('[poll-heyreach-inbox] skip probe threw (non-fatal):', e instanceof Error ? e.message : String(e));
            }
          }
          console.log(
            `[poll-heyreach-inbox] skip integration ${integration.id} — capture scope ${reason}: ` +
              `no poll, no head scan, no state write this tick`,
          );
          captureScopeSkips.push({ integrationId: String(integration.id), reason });
          continue;
        }
        console.log(
          `[poll-heyreach-inbox] Scoping to ${campaignIdFilter.length} capture-enabled campaign(s) ` +
            `for integration ${integration.id}`,
        );

        // ==== Head scan + budgeted walk with persistent state =================
        // tickWithHeadScan first re-processes page 1 (when a cursor is being
        // resumed) without touching walk state, then runs the walk with the
        // remaining budget. Budget rules are documented in paging.ts.
        const rawState = (integration?.heyreach_poll_state as WalkState) ?? {};
        let stateIn: WalkState = (rawState && typeof rawState === 'object' && 'version' in rawState)
          ? rawState as WalkState
          : { version: 1, baselineStartedAt: null, walk: null };
        // Key the state to the Capture Scope: a changed campaign filter resets
        // the baseline and walk (applyScope in paging.ts). A legacy stored
        // { unfiltered: true } scope is a change, so it resets exactly once.
        {
          const scoped = applyScope(stateIn, scope);
          stateIn = scoped.state;
          if (scoped.changed && (scoped.reset || scoped.previous)) {
            const fmt = (s: { unfiltered?: boolean; campaignIds: number[] } | null) =>
              !s ? 'unrecorded' : (s.unfiltered === true || !s.campaignIds?.length) ? 'unfiltered (legacy)' : `campaigns[${s.campaignIds.join(',')}]`;
            console.log(
              `[poll-heyreach-inbox] capture scope changed for integration ${integration.id}: ` +
                `${fmt(scoped.previous)} -> ${fmt(scope)} — baseline and walk reset`,
            );
          }
        }
        const deps = {
            async fetchPage(offset: number, limit: number, signal: AbortSignal, phase: Phase) {
              const res = await fetch(`${HEYREACH_API}/inbox/GetConversationsV2`, {
                method: 'POST',
                headers: {
                  'X-API-KEY': apiKey,
                  'Content-Type': 'application/json',
                  'Accept': 'application/json',
                },
                body: JSON.stringify({
                  filters: {
                    linkedInAccountIds: [],
                    // Capture Scope: always the non-empty list of enabled
                    // integer ids ([] would mean "all campaigns"; an empty
                    // scope skips the integration above and never gets here).
                    campaignIds: campaignIdFilter,
                    searchString: '',
                  },
                  offset,
                  limit,
                }),
                signal: AbortSignal.any([signal, AbortSignal.timeout(Math.max(1_000, Math.min(DEFAULT_PAGER_OPTIONS.pageFetchTimeoutMs, Math.max(0, remaining() - 5_000))))]),
              });
              if (!res.ok) {
                const t = await res.text().catch(() => '');
                console.error(`[poll-heyreach-inbox] HeyReach API error for integration ${integration.id}: ${res.status} ${t.slice(0, 160)}`);
                throw new Error(`fetch_error_${res.status}`);
              }
              const data = await res.json();
              // Returned uncoerced: the pager validates items/totalCount and
              // treats a malformed, empty or short page as fetch_error.
              const n = Array.isArray(data?.items) ? data.items.length : 'non-array';
              console.log(`[poll-heyreach-inbox] Fetched ${n} conversations (offset=${offset}, total=${data?.totalCount}, phase=${phase})`);
              if (Array.isArray(data?.items)) (phase === 'head' ? headCounts : walkCounts).seen += data.items.length;
              return { items: data?.items, totalCount: data?.totalCount };
            },
            // deno-lint-ignore no-explicit-any
            async processItem(convo: any, signal: AbortSignal, phase: Phase) {
              const counts = phase === 'head' ? headCounts : walkCounts;
              try {
                const conversationId = convo.id;
                const linkedInAccountId = convo.linkedInAccountId;
                const lastMessageText = convo.lastMessageText || '';

                if (!lastMessageText) {
                  counts.skippedNoText++;
                  return;
                }

                if (convo.lastMessageSender === 'ME') {
                  counts.skippedSenderMe++;
                  return;
                }

                const profile = convo.correspondentProfile || {};
                const fullName = [profile.firstName, profile.lastName].filter(Boolean).join(' ') || 'Unknown';
                const linkedinUrlRaw = profile.profileUrl || '';
                const linkedinUrl = sanitizeLinkedinUrlForStorage(linkedinUrlRaw);
                const externalId = conversationId;

                // Without a linkedin_url we have no dedup key (the unique
                // index would let every poll create a new row). Skip and
                // log so we can investigate malformed correspondentProfile
                // payloads in the field.
                if (!linkedinUrl) {
                  console.warn(
                    `[poll-heyreach-inbox] Skipping conversation ${conversationId} — no profileUrl on correspondentProfile`,
                  );
                  return;
                }

                // Existing-lead lookup on (user_id, normalized linkedin_url).
                // If linkedin_url is missing we fall back to external_id so legacy rows still resolve.
                let existingLead: {
                  id: string;
                  last_reply_text: string | null;
                  disposition_tag: string | null;
                  last_surfaced_reply_at: string | null;
                  inbox_status?: string | null;
                } | null = null;
                if (linkedinUrl) {
                  const found = await itemDb('lead_lookup', signal, () => findLeadByNormalizedLinkedIn(supabase, userId, linkedinUrl));
                  existingLead = found
                    ? {
                        id: found.id,
                        last_reply_text: found.last_reply_text ?? null,
                        disposition_tag: found.disposition_tag,
                        last_surfaced_reply_at: found.last_surfaced_reply_at,
                        // @ts-ignore extend shape locally for pending-check
                        inbox_status: (found as any).inbox_status ?? null,
                      } as any
                    : null;
                }
                if (!existingLead && externalId) {
                  const { data, error: lookupErr } = await itemDb('lead_lookup_external_id', signal, (s) =>
                    supabase
                      .from('agent_leads')
                      .select('id, last_reply_text, disposition_tag, last_surfaced_reply_at')
                      .eq('user_id', userId)
                      .eq('external_id', externalId)
                      .abortSignal(s)
                      .maybeSingle()
                  );
                  // A failed (or aborted) lookup must not be read as "no lead":
                  // that would INSERT a duplicate. Fail the item instead.
                  if (lookupErr) throw new Error(`agent_leads_lookup_failed: ${lookupErr.message}`);
                  existingLead = data ?? null;
                }

                if (existingLead && existingLead.last_reply_text === lastMessageText) {
                  counts.skippedSameText++;
                  return;
                }

                counts.polled++;

                // Fetch full chatroom messages
                let replyThread: { role: string; content: string; timestamp: string; channel: string }[] = [];
                try {
                  const chatroomRes = await fetch(
                    `${HEYREACH_API}/inbox/GetChatroom/${linkedInAccountId}/${conversationId}`,
                    {
                      headers: {
                        'X-API-KEY': apiKey,
                        'Accept': 'application/json',
                      },
                      signal: AbortSignal.any([signal, AbortSignal.timeout(DEFAULT_PAGER_OPTIONS.itemFetchTimeoutMs)]),
                    },
                  );

                  if (chatroomRes.ok) {
                    const chatroom = await chatroomRes.json();
                    const messages = chatroom.messages || [];

                    replyThread = messages.map((msg: { sender?: string; body?: string; createdAt?: string }) => ({
                      role: msg.sender === 'ME' ? 'sender' : 'prospect',
                      content: msg.body || '',
                      // Keep raw timestamp; missing stays empty (treated as stale in gate)
                      timestamp: msg.createdAt || '',
                      channel: 'linkedin',
                    }));
                  } else {
                    // Deviation from main: If GetChatroom fails, abort this item by throwing
                    // so the walker counts a failure and the baseline will NOT advance.
                    // This avoids writing last_reply_text with an empty thread and then
                    // skipping on same-text in later runs.
                    throw new Error(`getchatroom_${chatroomRes.status}`);
                  }
                } catch (chatroomErr) {
                  console.error(`[poll-heyreach-inbox] Failed to fetch chatroom for ${conversationId}:`, chatroomErr);
                  // Abort this item for the same reason as above.
                  throw chatroomErr;
                }

                // ---- Surface gate (VERBATIM from main) ---------------------
                // This upsert used to hard-code inbox_status:'pending', so EVERY
                // conversation it wrote became actionable — including history it
                // was seeing for the first time. When the poller's stale-key 401
                // was fixed it ingested 257 previously-invisible conversations for
                // one client, 204 of them over 90 days old and the oldest from
                // 2024, straight into Pending Approval. Backfilled history is not
                // work to do today.
                //
                // Mirrors poll-reply-inbox exactly (shared shouldResurface for the
                // existing-lead case, a 24h recency gate for first sight) so the
                // two pollers agree on what "actionable" means:
                //   existing lead → resurface only on a genuinely NEW inbound that
                //                   is newer than the surface watermark and not
                //                   suppressed by disposition; otherwise LEAVE THE
                //                   STATUS ALONE (omitted from the payload, so a
                //                   dismissal sticks).
                //   new lead      → 'pending' only if the newest message is an
                //                   inbound reply from the last 24h; else
                //                   'mirrored' (in neither inbox tab, still fully
                //                   readable and still resurfaceable later).
                // Newest PROSPECT message timestamp (raw, no fallback to now)
                const newestProspect = replyThread
                  .filter((e) => e.role === 'prospect')
                  .reduce<{ timestamp: string | null } | null>(
                    (a, b) => {
                      const bt = b?.timestamp ? Date.parse(b.timestamp) : NaN;
                      if (!Number.isFinite(bt)) return a;
                      if (!a) return { timestamp: b.timestamp };
                      const at = a.timestamp ? Date.parse(a.timestamp) : NaN;
                      return (!Number.isFinite(at) || bt > at) ? { timestamp: b.timestamp } : a;
                    },
                    null
                  );
                const newestProspectTs = newestProspect?.timestamp ?? null;
                const newestMs = newestProspectTs ? Date.parse(newestProspectTs) : NaN;
                const priorMs = existingLead?.last_surfaced_reply_at
                  ? Date.parse(existingLead.last_surfaced_reply_at)
                  : 0;
                const newerThanPrior = Number.isFinite(newestMs) && newestMs > priorMs;
                // Surface/classify decision (centralized)
                const decision = decideSurfaceAndClassify({
                  dispositionTag: existingLead?.disposition_tag ?? null,
                  isExistingLead: !!existingLead,
                  newestProspectTimestamp: newestProspectTs,
                  priorWatermark: existingLead?.last_surfaced_reply_at ?? null,
                  nowMs: Date.now(),
                });
                const surface = decision.surface;
                const stale = decision.isStale;

                const surfaceFields = buildSurfaceUpdateFields(decision, {
                  isExistingLead: !!existingLead,
                  alreadyPending: existingLead?.inbox_status === 'pending',
                });

                const upsertPayload: Record<string, unknown> = {
                  user_id: userId,
                  agent_config_id: agentConfig.id,
                  external_id: externalId,
                  full_name: fullName,
                  linkedin_url: linkedinUrl,
                  last_reply_text: cleanReplyPreview(lastMessageText),
                  ...(newestProspectTs ? { last_reply_at: newestProspectTs } : {}),
                  reply_thread: replyThread.length > 0 ? replyThread : undefined,
                  ...surfaceFields,
                  channel: 'linkedin',
                  source: 'heyreach',
                  heyreach_conversation_id: conversationId,
                  heyreach_account_id: linkedInAccountId,
                };

                // Deterministic save: update-or-insert with 23505 retry
                let savedRow: Record<string, unknown> | null = null;
                if (existingLead?.id) {
                  const leadId = existingLead.id;
                  const { data: updated, error: updateErr } = await itemDb('agent_leads_update', signal, (s) =>
                    supabase
                      .from('agent_leads')
                      .update(upsertPayload)
                      .eq('id', leadId)
                      .select()
                      .abortSignal(s)
                      .single()
                  );
                  if (updateErr) {
                    console.error(`[poll-heyreach-inbox] UPDATE error for ${externalId}:`, updateErr.message);
                    // Throw (not return) so the walker counts a failure and the baseline does not advance.
                    throw new Error(`agent_leads_update_failed: ${updateErr.message}`);
                  }
                  savedRow = updated as Record<string, unknown>;
                } else {
                  const { data: inserted, error: insertErr } = await itemDb('agent_leads_insert', signal, (s) =>
                    supabase
                      .from('agent_leads')
                      .insert(upsertPayload)
                      .select()
                      .abortSignal(s)
                      .single()
                  );
                  if (insertErr && (insertErr as { code?: string }).code === '23505') {
                    // Race: another writer created the row — reselect and update
                    const raced = await itemDb('lead_reselect', signal, () => findLeadByNormalizedLinkedIn(supabase, userId, linkedinUrl));
                    if (raced?.id) {
                      const racedId = raced.id;
                      const { data: updated2, error: updateErr2 } = await itemDb('agent_leads_update_after_23505', signal, (s) =>
                        supabase
                          .from('agent_leads')
                          .update(upsertPayload)
                          .eq('id', racedId)
                          .select()
                          .abortSignal(s)
                          .single()
                      );
                      if (updateErr2) {
                        console.error(`[poll-heyreach-inbox] UPDATE-after-23505 failed for ${externalId}:`, updateErr2.message);
                        throw new Error(`agent_leads_update_after_23505_failed: ${updateErr2.message}`);
                      }
                      savedRow = updated2 as Record<string, unknown>;
                    } else {
                      console.error(`[poll-heyreach-inbox] 23505 on INSERT but reselect found no row for ${externalId}`);
                      throw new Error('agent_leads_23505_reselect_empty');
                    }
                  } else if (insertErr) {
                    console.error(`[poll-heyreach-inbox] INSERT error for ${externalId}:`, insertErr.message);
                    throw new Error(`agent_leads_insert_failed: ${insertErr.message}`);
                  } else {
                    savedRow = inserted as Record<string, unknown>;
                  }
                }

                // Log the gate decision for observability
                console.log(`[poll-heyreach-inbox] gate: stale=${stale} ts=${newestProspectTs ?? 'null'} willClassify=${decision.willClassify} drafting=${draftingEnabled ? 'on' : 'off'}`);

                // Only reached for conversations of capture-enabled campaigns:
                // the GetConversationsV2 request is filtered to the enabled
                // campaign ids and an empty/failed scope skips the integration
                // above. classify-reply additionally needs surface + fresh
                // (willClassify) and HEYREACH_DRAFTING_ENABLED === 'true'.
                if (surface && savedRow) {
                  const classifyGate = heyreachClassifyGate(decision, draftingEnabled);
                  if (classifyGate.classify) {
                    fireClassifyReply({
                      supabaseUrl,
                      agentKey: expectedKey || '',
                      // deno-lint-ignore no-explicit-any
                      leadId: (savedRow as any).id,
                      replyText: lastMessageText,
                      threadHistory: replyThread,
                      agentConfig,
                      channel: 'linkedin',
                      userId,
                    });
                  } else if (classifyGate.reason === 'drafting_disabled') {
                    console.log(
                      // deno-lint-ignore no-explicit-any
                      `[poll-heyreach-inbox] fresh surfaced reply for lead ${(savedRow as any).id} not classified: ` +
                        `${HEYREACH_DRAFTING_ENV} is not 'true' (HeyReach drafting off)`,
                    );
                  }
                }

                if (savedRow && !existingLead) {
                  counts.new++;

                  // Log activity
                  await itemDb('agent_activity_insert', signal, (s) => supabase.from('agent_activity').insert({
                    user_id: userId,
                    agent_config_id: agentConfig.id,
                    // deno-lint-ignore no-explicit-any
                    lead_id: (savedRow as any).id,
                    lead_name: fullName,
                    lead_company: profile.companyName || '',
                    activity_type: 'reply_received',
                    description: `LinkedIn reply detected via HeyReach polling from ${fullName}${profile.companyName ? ' at ' + profile.companyName : ''}`,
                    metadata: { channel: 'linkedin', intent: 'pending', source: 'heyreach_poll' },
                  }).abortSignal(s));
                }

                // Rate limit between chatroom fetches
                await new Promise(resolve => setTimeout(resolve, 200));

              } catch (convoErr) {
                console.error(`[poll-heyreach-inbox] Error processing conversation ${convo.id}:`, convoErr);
                // failures counted inside walker via thrown error in processItem
                throw convoErr;
              }
            },
            nowMs: () => Date.now(),
            async saveState(next: WalkState) {
              const { error } = await supabase
                .from('outbound_integrations')
                // deno-lint-ignore no-explicit-any
                .update({ heyreach_poll_state: next as any })
                .eq('id', integration.id)
                .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS));
              if (error) throw error;
            },
        };
        if (recapture) {
          // Newest-first through the requested campaigns until older than the
          // lookback. Same processItem as the walk; no state is saved.
          const cutoffMs = Date.now() - recapture.lookbackDays * 86400_000;
          let offset = 0;
          let processed = 0;
          let failures = 0;
          const limit = 100;
          recaptureLoop: while (remaining() > DEFAULT_PAGER_OPTIONS.minRemainingForNextPageMs) {
            const page = await deps.fetchPage(offset, limit, AbortSignal.timeout(30_000), 'head');
            const items = Array.isArray(page?.items) ? page.items : [];
            if (items.length === 0) break;
            for (const convo of items) {
              const lastAt = Date.parse(convo?.lastMessageAt ?? '');
              if (Number.isFinite(lastAt) && lastAt < cutoffMs) break recaptureLoop;
              try {
                await deps.processItem(convo, AbortSignal.timeout(8_000), 'head');
                processed++;
              } catch {
                failures++;
              }
            }
            offset += items.length;
            if (typeof page?.totalCount === 'number' && offset >= page.totalCount) break;
          }
          console.log(`[poll-heyreach-inbox] recapture integration ${integration.id}: processed=${processed} failures=${failures}`);
          perIntegration.push({
            integrationId: integration.id,
            stopReason: 'end_of_list',
            pagesFetched: Math.ceil(offset / limit),
            conversationsProcessed: processed,
            failures,
            walkStartedAt: null,
            walkOffset: null,
            baselineStartedAt: (integration?.heyreach_poll_state?.baselineStartedAt as string) ?? null,
            headScan: { items: 0, failures: 0, elapsedMs: 0, stopReason: 'skipped_budget' },
          });
          continue;
        }

        const tickOpts = { ...DEFAULT_PAGER_OPTIONS, runBudgetMs: remaining() };
        // deno-lint-ignore no-explicit-any
        const walker = await tickWithHeadScan<any>(deps, stateIn, tickOpts);

        // Persist final state from walker (already saved in-page and on stop)
        const { error: finalSaveErr } = await supabase
          .from('outbound_integrations')
          // deno-lint-ignore no-explicit-any
          .update({ heyreach_poll_state: walker.state as any })
          .eq('id', integration.id)
          .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS));
        if (finalSaveErr) {
          console.error('[poll-heyreach-inbox] final saveState error:', finalSaveErr);
        }

        // Summarize
        perIntegration.push({
          integrationId: integration.id,
          stopReason: walker.stopReason,
          pagesFetched: walker.pagesFetched,
          conversationsProcessed: walker.itemsProcessed,
          failures: walker.failures,
          walkStartedAt: walker.state.walk?.startedAt ?? null,
          walkOffset: walker.state.walk?.offset ?? null,
          baselineStartedAt: walker.state.baselineStartedAt ?? null,
          headScan: walker.headScan,
        });
        addHeadScan(walker.headScan);
        // Precedence: fetch_error > time_budget > others
        if (walker.stopReason === 'fetch_error') {
          overallStop = 'fetch_error';
        } else if (walker.stopReason === 'time_budget' && overallStop !== 'fetch_error') {
          overallStop = 'time_budget';
        } else if (!overallStop) {
          overallStop = walker.stopReason;
        }
        // Capture Scope probe of capture-off campaigns, with whatever budget the
        // walk left (best-effort; never blocks the walk).
        if (remaining() > PROBE_MIN_REMAINING_MS) {
          try {
            const probe = await probeCaptureOffHeyReach(supabase, { id: String(integration.id), team_id: String(integration.team_id) }, apiKey);
            probeCampaigns += probe.probed;
            probeSkips += probe.skips;
          } catch (e) {
            console.warn('[poll-heyreach-inbox] skip probe threw (non-fatal):', e instanceof Error ? e.message : String(e));
          }
        }

        console.log(
          `[poll-heyreach-inbox] integration ${integration.id} summary: pages=${walker.pagesFetched}, items=${walker.itemsProcessed}, failures=${walker.failures}, stop=${walker.stopReason}` +
            ` | headScan items=${walker.headScan.items}, failures=${walker.headScan.failures}, elapsedMs=${walker.headScan.elapsedMs}, stop=${walker.headScan.stopReason}`,
        );
      } catch (integrationErr) {
        console.error(`[poll-heyreach-inbox] Error processing integration ${integration.id}:`, integrationErr);
        perIntegration.push({
          integrationId: integration.id,
          stopReason: 'fetch_error',
          pagesFetched: 0,
          conversationsProcessed: 0,
          failures: 0,
          walkStartedAt: (integration?.heyreach_poll_state?.walk?.startedAt as string) ?? null,
          walkOffset: (integration?.heyreach_poll_state?.walk?.offset as number) ?? null,
          baselineStartedAt: (integration?.heyreach_poll_state?.baselineStartedAt as string) ?? null,
          // Stats of a partially-run head scan are not recoverable after a throw.
          headScan: { items: 0, failures: 0, elapsedMs: 0, stopReason: 'fetch_error' },
        });
        if (overallStop !== 'fetch_error') overallStop = 'fetch_error';
      }
    }

    console.log(
      `[poll-heyreach-inbox] Done. polled=${walkCounts.polled} new=${walkCounts.new} seen=${walkCounts.seen} ` +
        `skippedNoText=${walkCounts.skippedNoText} skippedSenderMe=${walkCounts.skippedSenderMe} skippedSameText=${walkCounts.skippedSameText} ` +
        `intSkipNoKey=${integrationsSkippedNoKey} intSkipNoAgentConfig=${integrationsSkippedNoAgentConfig} intSkipCaptureScope=${captureScopeSkips.length}` +
        ` | headScan seen=${headCounts.seen} polled=${headCounts.polled} new=${headCounts.new}`,
    );

    return new Response(
      JSON.stringify({
        success: true,
        polled: walkCounts.polled,
        new: walkCounts.new,
        seen: walkCounts.seen,
        stopReason: overallStop ?? 'end_of_list',
        elapsedMs: Date.now() - startedAtMs,
        headScan: headScanTotal,
        perIntegration,
        integrations: integrations?.length ?? 0,
        skipped: {
          noText: walkCounts.skippedNoText,
          senderMe: walkCounts.skippedSenderMe,
          sameText: walkCounts.skippedSameText,
          integrationsNoKey: integrationsSkippedNoKey,
          integrationsNoAgentConfig: integrationsSkippedNoAgentConfig,
          captureScope: captureScopeSkips,
          captureScopeProbe: { campaigns: probeCampaigns, skipsRecorded: probeSkips },
        },
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    );
  } catch (error) {
    console.error('[poll-heyreach-inbox] Fatal error:', error);
    return new Response(JSON.stringify({ error: 'Internal error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
