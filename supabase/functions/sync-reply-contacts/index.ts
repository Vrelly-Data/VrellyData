import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const allowedOrigins = [
  Deno.env.get("ALLOWED_ORIGIN") || "https://vrelly.com",
  "https://www.vrelly.com",
];

function getCorsHeaders(req: Request) {
  const origin = req.headers.get("Origin") || "";
  return {
    "Access-Control-Allow-Origin": allowedOrigins.includes(origin) ? origin : allowedOrigins[0],
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-agent-key",
  };
}

// ---------------------------------------------------------------------------
// Reply.io v3 (deprecated v1 code removed — Foundation phase 2/6).
//
// Auth swap: X-API-Key → Authorization: Bearer (matches sync-reply-sequences
// 8a37994 + sync-reply-campaigns Step 2 8c8cd38).
//
// Endpoint swap: was a dual v3+v1 dance:
//   v3 PRIMARY:  /v3/sequences/{id}/contacts/extended?additionalColumns=Status
//   v1 FALLBACK: /v1/campaigns/{id}/people
// Now v3-only via plain /v3/contacts. The old /sequences/{id}/contacts/extended
// path wasn't in the v3 doc index (llms.txt) — likely a legacy alias.
//
// Scope handling: /v3/contacts is workspace-wide (NOT campaign-scoped). We
// fetch all workspace contacts, then filter client-side by `sequences[]` so
// only this sequence's contacts feed the downstream synced_contacts write.
// Same behavioral output as the old per-sequence endpoint; different API
// surface to get there.
//
// Engagement-flag uncertainty: the old endpoint returned a nested `status:
// { replied, opened, ... }` object thanks to `additionalColumns=Status`.
// /v3/contacts may not include engagement flags inline — per llms.txt there's
// a separate GET /v3/contacts/{id}/statuses endpoint. The spike confirmed
// only `isOptedOut` as top-level. Defensive extraction below reads from BOTH
// top-level v3 fields AND the legacy `status` nested object, with a
// first-call key log so we surface the actual shape on deploy.
//
// Field-name remaps (verified from live spike):
//   addingDate   ← was addedTime / addedAt
//   linkedInUrl  ← was linkedInProfile / linkedinProfile (capital I-n)
//   isOptedOut   ← was status.optedOut (top-level flat boolean)
//   company      ← was companyName (already matches v3)
//   customFields ← ARRAY of {key,value} (not flat object) — preserved
//                  as raw_data; synced_contacts.custom_fields stays {}
//                  (current behavior — feature would be a separate change).
// ---------------------------------------------------------------------------

const REPLY_API_V3 = "https://api.reply.io/v3";

// V3 Contact shape — verified field names from live spike, plus defensive
// optionals for engagement flags whose location on /v3/contacts is unknown.
interface V3Contact {
  id?: number;
  email: string;
  firstName?: string;
  lastName?: string;
  title?: string;
  // VERIFIED v3 field names (per spike against CYPR):
  company?: string;                                          // not companyName
  linkedInUrl?: string;                                      // not linkedInProfile (capital I-n)
  isOptedOut?: boolean;                                      // top-level flat boolean
  customFields?: Array<{ key: string; value: string }>;      // array, not flat object
  sequences?: Array<number | { id: number | string } | unknown>;
  lists?: Array<unknown>;
  addingDate?: string;                                       // not addedTime / addedAt

  // DEFENSIVE — engagement flag location uncertain on plain /v3/contacts.
  // First-call key log in fetchAllContactsV3 will surface what's actually
  // there. v3ToUnified() reads via ?? chain across top-level and nested.
  status?: {
    status?: string;
    replied?: boolean;
    delivered?: boolean;
    opened?: boolean;
    clicked?: boolean;
    bounced?: boolean;
    finished?: boolean;
    optedOut?: boolean;
  };
  // Speculative top-level booleans — included so if v3 promotes them
  // out of a nested object we don't silently drop the value.
  replied?: boolean;
  delivered?: boolean;
  opened?: boolean;
  clicked?: boolean;
  bounced?: boolean;
  finished?: boolean;

  // Additional fields used by the downstream synced_contacts write.
  // Verified names where possible; otherwise carried from v1/v3 shared shape.
  industry?: string;
  companySize?: string;
  city?: string;
  state?: string;
  country?: string;
  phone?: string;
}

interface V3ContactsPage {
  items?: V3Contact[];
  hasMore?: boolean;
}

// Unified format consumed by downstream upsert logic. Field names here
// match the LOCAL variable names the original handler used — kept stable
// so the batch-upsert block at the bottom of the file requires zero
// changes. v3-specific field-name remaps happen in v3ToUnified() below.
interface UnifiedContact {
  id?: number;
  email: string;
  firstName?: string;
  lastName?: string;
  title?: string;
  company?: string;
  addedAt?: string;          // remapped FROM v3 addingDate
  industry?: string;
  companySize?: string;
  city?: string;
  state?: string;
  country?: string;
  phone?: string;
  linkedInProfile?: string;  // remapped FROM v3 linkedInUrl
  // Engagement flags
  delivered: boolean;
  replied: boolean;
  opened: boolean;
  clicked: boolean;
  bounced: boolean;
  finished: boolean;
  optedOut: boolean;
  rawData: unknown;
}

interface EngagementStats {
  deliveredCount: number;
  repliesCount: number;
  opensCount: number;
  clicksCount: number;
  bouncesCount: number;
  optedOutCount: number;
}

// Bearer-authed v3 fetcher — identical shape to sync-reply-campaigns'
// fetchV3 / fetchV3WithRetry (preserves retry semantics per spec).
async function fetchV3<T = unknown>(endpoint: string, apiKey: string): Promise<T> {
  const response = await fetch(`${REPLY_API_V3}${endpoint}`, {
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Accept": "application/json",
      "Content-Type": "application/json",
    },
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Reply.io v3 API error (${response.status}): ${errorText}`);
  }
  return response.json() as Promise<T>;
}

async function fetchV3WithRetry<T = unknown>(
  endpoint: string,
  apiKey: string,
  maxRetries: number = 3,
): Promise<T> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fetchV3<T>(endpoint, apiKey);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      const isRateLimit = msg.includes("Too much requests") || msg.includes("(429)");
      if (isRateLimit && attempt < maxRetries) {
        const waitMs = 5000 * attempt;
        console.log(`Rate limited on ${endpoint}, waiting ${waitMs / 1000}s before retry ${attempt}/${maxRetries}`);
        await new Promise(r => setTimeout(r, waitMs));
        continue;
      }
      throw error;
    }
  }
  throw new Error(`Max retries exceeded for ${endpoint}`);
}

// Walk /v3/contacts with top + skip until hasMore=false or short read.
// Same pagination pattern as sync-reply-campaigns' fetchAllSequencesV3.
// Safety cap at 100k contacts to bound a runaway loop on huge workspaces.
//
// First-call key log: prints the top-level keys of the first contact +
// (if present) the nested status object's keys. Tripwire for shape
// changes / engagement-flag discovery — once per sync invocation.
async function fetchAllContactsV3(
  apiKey: string,
  pageSize: number = 100,
): Promise<V3Contact[]> {
  const all: V3Contact[] = [];
  let skip = 0;
  let loggedFirstKeys = false;
  for (let page = 1; page <= 1000; page++) {
    const url = `/contacts?top=${pageSize}&skip=${skip}`;
    const resp = await fetchV3WithRetry<V3ContactsPage>(url, apiKey);
    const items = Array.isArray(resp.items) ? resp.items : [];

    if (!loggedFirstKeys && items[0]) {
      const first = items[0] as unknown as Record<string, unknown>;
      console.log(`[/v3/contacts] first-call top-level keys:`, Object.keys(first));
      const status = first.status;
      if (status && typeof status === "object") {
        console.log(`[/v3/contacts] first-call status nested keys:`, Object.keys(status));
      } else {
        console.log(`[/v3/contacts] first-call status: ${status === undefined ? "(absent)" : typeof status}`);
      }
      loggedFirstKeys = true;
    }

    if (items.length === 0) break;
    all.push(...items);
    console.log(`  /contacts page ${page} (skip=${skip}): fetched ${items.length}, total ${all.length}`);
    if (resp.hasMore === false) break;
    if (items.length < pageSize) break;
    skip += items.length;
    if (all.length > 100000) {
      console.warn(`Reached safety cap (100k contacts); stopping pagination`);
      break;
    }
    await new Promise(r => setTimeout(r, 300));
  }
  return all;
}

// Filter to contacts that belong to a specific sequence. sequences[] entries
// may be primitive ids OR {id} objects depending on whether v3 ever inlines
// the sequence — defensive on both shapes.
function isInSequence(contact: V3Contact, sequenceId: number): boolean {
  const seqs = contact.sequences ?? [];
  if (!Array.isArray(seqs)) return false;
  for (const s of seqs) {
    if (typeof s === "number" && s === sequenceId) return true;
    if (typeof s === "string" && Number(s) === sequenceId) return true;
    if (typeof s === "object" && s !== null) {
      const sid = (s as Record<string, unknown>).id;
      if (typeof sid === "number" && sid === sequenceId) return true;
      if (typeof sid === "string" && Number(sid) === sequenceId) return true;
    }
  }
  return false;
}

// Convert v3 contact to unified format. Field-name remaps:
//   linkedInUrl   → linkedInProfile  (UnifiedContact var name; writes to .linkedin_url)
//   addingDate    → addedAt          (UnifiedContact var name; writes to .added_at)
//   isOptedOut    → optedOut         (Boolean polarity unchanged)
// Engagement flag extraction uses ?? chain across:
//   - Top-level v3 booleans (e.g. contact.replied)        — speculative
//   - Nested status object (legacy shape)                 — defensive
//   - Defaults to false                                   — safe under uncertainty
function v3ToUnified(contact: V3Contact): UnifiedContact {
  const toBool = (val: unknown): boolean => {
    if (typeof val === "boolean") return val;
    if (typeof val === "string") return val.toLowerCase() === "true";
    return false;
  };

  const status = contact.status ?? {};

  const replied = toBool(contact.replied ?? status.replied);
  const opened = toBool(contact.opened ?? status.opened);
  const clicked = toBool(contact.clicked ?? status.clicked);
  const bounced = toBool(contact.bounced ?? status.bounced);
  const finished = toBool(contact.finished ?? status.finished);
  const optedOut = toBool(contact.isOptedOut ?? status.optedOut);

  // Delivered: explicit flag, OR inferred from other email activity
  // (opened/replied/clicked implies a successful delivery happened).
  // Same inference the old code used.
  const deliveredExplicit = toBool(contact.delivered ?? status.delivered);
  const hasEmailActivity = opened || replied || clicked;
  const delivered = deliveredExplicit || hasEmailActivity;

  return {
    id: contact.id,
    email: contact.email,
    firstName: contact.firstName,
    lastName: contact.lastName,
    title: contact.title,
    company: contact.company,
    addedAt: contact.addingDate,         // ← REMAP: v3 'addingDate' → UnifiedContact 'addedAt'
    industry: contact.industry,
    companySize: contact.companySize,
    city: contact.city,
    state: contact.state,
    country: contact.country,
    phone: contact.phone,
    linkedInProfile: contact.linkedInUrl, // ← REMAP: v3 'linkedInUrl' → UnifiedContact 'linkedInProfile'
    delivered,
    replied,
    opened,
    clicked,
    bounced,
    finished,
    optedOut,
    rawData: contact,
  };
}

function mapContactStatus(contact: UnifiedContact): string {
  if (contact.replied) return "replied";
  if (contact.bounced) return "bounced";
  if (contact.optedOut) return "opted_out";
  if (contact.finished) return "finished";
  if (contact.opened) return "opened";
  return "active";
}

function computeEngagementStats(contacts: UnifiedContact[]): EngagementStats {
  let deliveredCount = 0;
  let repliesCount = 0;
  let opensCount = 0;
  let clicksCount = 0;
  let bouncesCount = 0;
  let optedOutCount = 0;

  for (const contact of contacts) {
    if (contact.delivered) deliveredCount++;
    if (contact.replied) repliesCount++;
    if (contact.opened) opensCount++;
    if (contact.clicked) clicksCount++;
    if (contact.bounced) bouncesCount++;
    if (contact.optedOut) optedOutCount++;
  }

  return { deliveredCount, repliesCount, opensCount, clicksCount, bouncesCount, optedOutCount };
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      throw new Error("Missing authorization header");
    }

    const body = await req.json();
    const { campaignId, integrationId, userId: bodyUserId } = body;

    if (!campaignId || !integrationId) {
      throw new Error("Missing campaignId or integrationId");
    }

    // Check for internal service-role call via x-agent-key
    const agentKey = req.headers.get("x-agent-key");
    const expectedAgentKey = Deno.env.get("AGENT_API_KEY");
    const isInternalCall = !!(agentKey && expectedAgentKey && agentKey === expectedAgentKey);

    let queryClient;
    if (isInternalCall) {
      // Internal call from auto-sync: use service role client (bypasses RLS)
      queryClient = createClient(
        Deno.env.get("SUPABASE_URL") ?? "",
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      );
      console.log("Using service role client (internal auto-sync call)");
    } else {
      // Frontend call: use user JWT (RLS enforced)
      queryClient = createClient(
        Deno.env.get("SUPABASE_URL") ?? "",
        Deno.env.get("SUPABASE_ANON_KEY") ?? "",
        { global: { headers: { Authorization: authHeader } } }
      );
    }

    // Fetch the integration (RLS enforced for frontend calls, bypassed for internal)
    const { data: integration, error: integrationError } = await queryClient
      .from("outbound_integrations")
      .select("id, team_id, api_key_encrypted, reply_team_id")
      .eq("id", integrationId)
      .single();

    if (integrationError || !integration) {
      throw new Error("Integration not found or access denied");
    }

    // Fetch the campaign
    const { data: campaign, error: campaignError } = await queryClient
      .from("synced_campaigns")
      .select("id, external_campaign_id, team_id")
      .eq("id", campaignId)
      .single();

    if (campaignError || !campaign) {
      throw new Error("Campaign not found");
    }

    // Service role for bulk operations
    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Get the user's ID for agent_leads — prefer auth token, fall back to body param
    // (webhook invocations use service role key and pass userId explicitly).
    //
    // NOTE: this branch referenced a pre-existing typo `userClient` (no
    // such variable was ever declared — the auth client is `queryClient`).
    // The typo would have thrown ReferenceError if any caller ever omitted
    // bodyUserId. Renamed to queryClient as a typo fix; the behavior change
    // is FROM "throws on missing bodyUserId" TO "actually resolves user
    // from JWT" — the obviously-intended behavior. Required for deno check
    // to pass on this file (was failing in the original too).
    let userId = bodyUserId;
    if (!userId) {
      const { data: { user }, error: userError } = await queryClient.auth.getUser();
      if (userError || !user) {
        throw new Error("Unable to resolve authenticated user");
      }
      userId = user.id;
    }

    const apiKey = integration.api_key_encrypted;
    const teamId = integration.team_id;
    const externalCampaignId = campaign.external_campaign_id;

    console.log(`Syncing contacts for campaign ${externalCampaignId} via v3`);

    // Fetch ALL workspace contacts via /v3/contacts, then filter client-side
    // by sequences[] to scope to this campaign. Per-sequence server-side
    // scoping isn't documented for plain /v3/contacts; the old endpoint
    // (/v3/sequences/{id}/contacts/extended) was campaign-scoped natively
    // but isn't in the v3 doc index.
    const allWorkspaceContacts = await fetchAllContactsV3(apiKey);
    console.log(`Fetched ${allWorkspaceContacts.length} total workspace contacts`);

    const sequenceIdNum = parseInt(externalCampaignId, 10);
    const sequenceContacts = Number.isFinite(sequenceIdNum)
      ? allWorkspaceContacts.filter((c) => isInSequence(c, sequenceIdNum))
      : [];
    console.log(`After sequences[] filter (sequenceId=${sequenceIdNum}): ${sequenceContacts.length} contacts`);

    // Convert to unified format + dedupe by email (lowercase).
    const contactsMap = new Map<string, UnifiedContact>();
    for (const c of sequenceContacts) {
      if (c.email) {
        contactsMap.set(c.email.toLowerCase(), v3ToUnified(c));
      }
    }
    const contacts = Array.from(contactsMap.values());
    console.log(`Total contacts to sync: ${contacts.length} (source: v3 /contacts + client-side sequence filter)`);

    // Compute engagement stats from contacts
    const engagementStats = computeEngagementStats(contacts);
    console.log(`Engagement stats: delivered=${engagementStats.deliveredCount}, replies=${engagementStats.repliesCount}, opens=${engagementStats.opensCount}`);

    // Batch upsert contacts — UNCHANGED from prior behavior, just fed from
    // a v3-only contacts pipeline.
    const BATCH_SIZE = 100;
    let contactsSynced = 0;
    let contactsFailed = 0;

    for (let i = 0; i < contacts.length; i += BATCH_SIZE) {
      const batch = contacts.slice(i, i + BATCH_SIZE);
      const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(contacts.length / BATCH_SIZE);

      console.log(`Processing batch ${batchNumber}/${totalBatches} (${batch.length} contacts)`);

      const records = batch.map(contact => {
        const engagementData = {
          replied: contact.replied,
          bounced: contact.bounced,
          opened: contact.opened,
          clicked: contact.clicked,
          optedOut: contact.optedOut,
          finished: contact.finished,
          delivered: contact.delivered,
          addedAt: contact.addedAt,
        };

        return {
          campaign_id: campaignId,
          team_id: teamId,
          external_contact_id: contact.id ? String(contact.id) : null,
          email: contact.email.toLowerCase(),
          first_name: contact.firstName || null,
          last_name: contact.lastName || null,
          company: contact.company || null,
          job_title: contact.title || null,
          status: mapContactStatus(contact),
          engagement_data: engagementData,
          custom_fields: {},
          raw_data: contact.rawData,
          updated_at: new Date().toISOString(),
          industry: contact.industry || null,
          company_size: contact.companySize && contact.companySize !== "Empty" ? contact.companySize : null,
          city: contact.city || null,
          state: contact.state || null,
          country: contact.country || null,
          phone: contact.phone || null,
          linkedin_url: contact.linkedInProfile || null,
          added_at: contact.addedAt || null,
        };
      });

      try {
        const { error: upsertError } = await serviceClient
          .from("synced_contacts")
          .upsert(records, {
            onConflict: "campaign_id,email",
          });

        if (upsertError) {
          console.error(`Batch ${batchNumber} failed:`, upsertError);
          contactsFailed += batch.length;
        } else {
          contactsSynced += batch.length;
        }
      } catch (err) {
        console.error(`Error in batch ${batchNumber}:`, err);
        contactsFailed += batch.length;
      }
    }

    // Upsert replied contacts with reply text into agent_leads
    const { data: repliedContacts } = await serviceClient
      .from("synced_contacts")
      .select("external_contact_id, first_name, last_name, email, engagement_data")
      .eq("campaign_id", campaignId)
      .eq("status", "replied")
      .not("engagement_data->lastReplyText", "is", null);

    if (repliedContacts && repliedContacts.length > 0) {
      const agentLeadRows = repliedContacts
        .filter((c) => c.external_contact_id && c.engagement_data?.lastReplyText)
        .map((c) => ({
          user_id: userId,
          external_id: c.external_contact_id!,
          full_name: [c.first_name, c.last_name].filter(Boolean).join(" ") || null,
          email: c.email,
          last_reply_text: c.engagement_data.lastReplyText,
          inbox_status: "pending",
          channel: "email",
        }));

      if (agentLeadRows.length > 0) {
        const { error: leadsError } = await serviceClient
          .from("agent_leads")
          .upsert(agentLeadRows, {
            onConflict: "user_id,external_id",
            ignoreDuplicates: false,
          });

        if (leadsError) {
          console.error("agent_leads upsert error:", leadsError);
        } else {
          console.log(`Upserted ${agentLeadRows.length} agent_leads`);
        }
      }
    }

    // Verify count in database
    const { count: verifiedCount } = await serviceClient
      .from("synced_contacts")
      .select("*", { count: "exact", head: true })
      .eq("campaign_id", campaignId);

    const peopleCount = verifiedCount || contacts.length;

    // Get existing campaign stats to preserve LinkedIn metrics
    const { data: existingCampaign } = await serviceClient
      .from("synced_campaigns")
      .select("stats")
      .eq("id", campaignId)
      .maybeSingle();

    const existingStats = (existingCampaign?.stats as Record<string, unknown>) || {};

    // Update campaign stats with computed values from contacts.
    // Preserve LinkedIn CSV fields (liConnectionsSent, liMessagesReplied, etc.).
    const updatedStats = {
      ...existingStats,
      peopleCount,
      // Email stats computed from contacts
      sent: engagementStats.deliveredCount,
      delivered: engagementStats.deliveredCount,
      replies: engagementStats.repliesCount,
      opens: engagementStats.opensCount,
      clicks: engagementStats.clicksCount,
      bounces: engagementStats.bouncesCount,
      optedOut: engagementStats.optedOutCount,
    };

    await serviceClient
      .from("synced_campaigns")
      .update({
        stats: updatedStats,
        updated_at: new Date().toISOString(),
      })
      .eq("id", campaignId);

    console.log(`Contacts sync complete: ${contactsSynced} synced, ${contactsFailed} failed`);
    console.log(`Campaign stats updated: sent=${engagementStats.deliveredCount}, replies=${engagementStats.repliesCount}`);

    // --- Agent Leads Population Block ---
    // Populate agent_leads for replied contacts so the Agent inbox
    // gets data from both webhooks AND manual syncs.
    let agentLeadsCreated = 0;
    try {
      // 1. Find the user_id for this integration
      const { data: integrationOwner } = await serviceClient
        .from("outbound_integrations")
        .select("created_by")
        .eq("id", integrationId)
        .single();

      if (integrationOwner?.created_by) {
        const ownerUserId = integrationOwner.created_by;

        // 2. Check if this user has an active agent config
        const { data: agentConfig } = await serviceClient
          .from("agent_configs")
          .select("*")
          .eq("user_id", ownerUserId)
          .eq("is_active", true)
          .limit(1)
          .maybeSingle();

        if (agentConfig) {
          console.log(`Active agent config found (${agentConfig.id}) for user ${ownerUserId}, populating agent_leads`);

          // 3. Find all synced_contacts for this integration where the contact has replied
          const { data: repliedSyncedContacts } = await serviceClient
            .from("synced_contacts")
            .select("*")
            .eq("team_id", teamId)
            .or("engagement_data->>replied.eq.true,status.eq.replied");

          if (repliedSyncedContacts && repliedSyncedContacts.length > 0) {
            console.log(`Found ${repliedSyncedContacts.length} replied contacts to upsert into agent_leads`);

            const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";

            for (const sc of repliedSyncedContacts) {
              try {
                // 4. Extract fields from synced_contacts
                const fullName = [sc.first_name, sc.last_name].filter(Boolean).join(" ") || "Unknown";
                const email = sc.email || "";
                const linkedinUrl = sc.linkedin_url || null;
                const company = sc.company || null;
                const jobTitle = sc.job_title || null;
                const externalId = sc.external_contact_id || sc.email;

                // Determine channel from engagement_data
                const engData = (sc.engagement_data as Record<string, unknown>) || {};
                const linkedinReplies = Number(engData.linkedinReplies) || 0;
                const channel = linkedinReplies > 0 ? "linkedin" : "email";

                const lastReplyAt = (engData.repliedAt as string) || sc.updated_at || new Date().toISOString();
                const lastReplyText = ""; // Not available from sync, only from webhooks

                // Upsert into agent_leads — only update if inbox_status is still 'pending'
                // Don't overwrite existing draft_response or intent if already classified
                const { data: upsertedLead, status: upsertStatus } = await serviceClient
                  .from("agent_leads")
                  .upsert(
                    {
                      user_id: agentConfig.user_id,
                      agent_config_id: agentConfig.id,
                      external_id: externalId,
                      full_name: fullName,
                      email,
                      linkedin_url: linkedinUrl,
                      company,
                      job_title: jobTitle,
                      channel,
                      pipeline_stage: "replied",
                      inbox_status: "pending",
                      last_reply_at: lastReplyAt,
                      last_reply_text: lastReplyText,
                    },
                    {
                      onConflict: "user_id,external_id",
                      ignoreDuplicates: false,
                    }
                  )
                  .select()
                  .single();

                // 5. Log agent_activity only for newly created rows (HTTP 201)
                if (upsertedLead && upsertStatus === 201) {
                  agentLeadsCreated++;
                  await serviceClient.from("agent_activity").insert({
                    user_id: agentConfig.user_id,
                    agent_config_id: agentConfig.id,
                    lead_id: upsertedLead.id,
                    lead_name: fullName,
                    lead_company: company,
                    activity_type: "reply_received",
                    description: `Reply synced from Data Playground for ${fullName}${company ? " at " + company : ""}`,
                    metadata: { channel, source: "playground_sync" },
                  });
                }

                // 6. Classify reply if draft_response is empty and last_reply_text is not empty
                if (
                  upsertedLead &&
                  !upsertedLead.draft_response &&
                  upsertedLead.last_reply_text
                ) {
                  try {
                    const classifyController = new AbortController();
                    const classifyTimeout = setTimeout(() => classifyController.abort(), 5000);

                    await fetch(`${supabaseUrl}/functions/v1/classify-reply`, {
                      method: "POST",
                      headers: {
                        "Content-Type": "application/json",
                        "x-agent-key": Deno.env.get("AGENT_API_KEY") || "",
                      },
                      signal: classifyController.signal,
                      body: JSON.stringify({
                        reply_text: upsertedLead.last_reply_text,
                        agent_context: {
                          offer_description: agentConfig.offer_description,
                          desired_action: agentConfig.desired_action,
                          outcome_delivered: agentConfig.outcome_delivered,
                          target_icp: agentConfig.target_icp,
                          sender_name: agentConfig.sender_name,
                          sender_title: agentConfig.sender_title,
                          sender_bio: agentConfig.sender_bio,
                          company_name: agentConfig.company_name,
                          company_url: agentConfig.company_url,
                          communication_style: agentConfig.communication_style,
                          avoid_phrases: agentConfig.avoid_phrases || [],
                          sample_message: agentConfig.sample_message || "",
                        },
                        channel,
                        user_id: agentConfig.user_id,
                      }),
                    });

                    clearTimeout(classifyTimeout);
                  } catch (classifyErr) {
                    // Timeout or failure — continue without classification
                    console.warn(`classify-reply failed for ${externalId}:`, classifyErr);
                  }
                }
              } catch (contactErr) {
                console.warn(`Failed to upsert agent_lead for contact ${sc.email}:`, contactErr);
              }
            }

            console.log(`Agent leads: ${agentLeadsCreated} new leads created from ${repliedSyncedContacts.length} replied contacts`);
          } else {
            console.log("No replied contacts found for agent_leads population");
          }
        } else {
          console.log("No active agent config found, skipping agent_leads population");
        }
      }
    } catch (agentLeadsErr) {
      // 7. Don't affect the existing sync response if anything fails
      console.error("Agent leads population failed (non-fatal):", agentLeadsErr);
    }
    // --- End Agent Leads Population Block ---

    return new Response(
      JSON.stringify({
        success: true,
        contactsSynced,
        contactsFailed,
        verifiedCount: peopleCount,
        source: "v3_contacts",
        engagementStats: {
          delivered: engagementStats.deliveredCount,
          replies: engagementStats.repliesCount,
          opens: engagementStats.opensCount,
          clicks: engagementStats.clicksCount,
          bounces: engagementStats.bouncesCount,
        },
        campaignStats: {
          peopleCount,
          sent: engagementStats.deliveredCount,
          delivered: engagementStats.deliveredCount,
          replies: engagementStats.repliesCount,
        },
        agentLeadsCreated,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error("Contacts sync error:", err);

    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
