import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Use V1 API for reliable contact listing with page-based pagination
const REPLY_API_V1 = "https://api.reply.io/v1";

// V1 Contact response structure
interface V1Contact {
  id: number;
  email: string;
  firstName?: string;
  lastName?: string;
  title?: string;
  company?: string;
  addedAt?: string;
  finished?: boolean;
  replied?: boolean;
  bounced?: boolean;
  opened?: boolean;
  clicked?: boolean;
  optedOut?: boolean;
  // Additional fields
  industry?: string;
  companySize?: string;
  city?: string;
  state?: string;
  country?: string;
  phone?: string;
  linkedInProfile?: string;
}

// Retry wrapper with exponential backoff for rate limiting
async function fetchWithRetry(
  endpoint: string,
  apiKey: string,
  teamId?: string,
  maxRetries: number = 3
): Promise<unknown> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const headers: Record<string, string> = {
        "X-API-Key": apiKey,
        "Accept": "application/json",
        "Content-Type": "application/json",
      };

      if (teamId) {
        headers["X-Reply-Team-Id"] = teamId;
      }

      const response = await fetch(`${REPLY_API_V1}${endpoint}`, { headers });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Reply.io V1 API error (${response.status}): ${errorText}`);
      }

      return response.json();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      if (errorMessage.includes("Too much requests") && attempt < maxRetries) {
        const waitTime = 5000 * attempt;
        console.log(
          `Rate limited on ${endpoint}, waiting ${waitTime / 1000}s before retry ${attempt}/${maxRetries}`,
        );
        await new Promise((resolve) => setTimeout(resolve, waitTime));
        continue;
      }
      throw error;
    }
  }
  throw new Error(`Max retries exceeded for ${endpoint}`);
}

// Map contact to simplified status string
function mapContactStatus(contact: V1Contact): string {
  if (contact.replied) return 'replied';
  if (contact.bounced) return 'bounced';
  if (contact.optedOut) return 'opted_out';
  if (contact.finished) return 'finished';
  if (contact.opened) return 'opened';
  return 'active';
}

// Generate a page signature to detect duplicate pages
function getPageSignature(contacts: V1Contact[]): string {
  if (contacts.length === 0) return 'empty';
  if (!contacts[0]?.email) return 'invalid_first';
  const first = contacts[0].email;
  const last = contacts[contacts.length - 1]?.email || first;
  return `${first}|${last}|${contacts.length}`;
}

// Parse API response - handles both array and object formats
function parseContactsResponse(response: unknown): V1Contact[] {
  if (Array.isArray(response)) {
    return response as V1Contact[];
  }
  if (response && typeof response === 'object') {
    const obj = response as Record<string, unknown>;
    // Log response structure for debugging
    console.log(`API response keys: ${Object.keys(obj).join(', ')}`);
    const rawContacts = obj.people || obj.contacts || obj.items || obj.data;
    if (Array.isArray(rawContacts)) {
      return rawContacts as V1Contact[];
    }
  }
  console.warn(`Unexpected response format: ${typeof response}`);
  return [];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      throw new Error("Missing authorization header");
    }

    const body = await req.json();
    const { campaignId, integrationId } = body;

    if (!campaignId || !integrationId) {
      throw new Error("Missing campaignId or integrationId");
    }

    // Use user's auth to validate access to integration/campaign
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } }
    );

    // Fetch the integration (validates user has access via RLS)
    const { data: integration, error: integrationError } = await userClient
      .from("outbound_integrations")
      .select("id, team_id, api_key_encrypted, reply_team_id")
      .eq("id", integrationId)
      .single();

    if (integrationError || !integration) {
      throw new Error("Integration not found or access denied");
    }

    // Fetch the campaign to get external_campaign_id (validates access via RLS)
    const { data: campaign, error: campaignError } = await userClient
      .from("synced_campaigns")
      .select("id, external_campaign_id, team_id")
      .eq("id", campaignId)
      .single();

    // Use service role for bulk data operations (after access is validated)
    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    if (campaignError || !campaign) {
      throw new Error("Campaign not found");
    }

    const apiKey = integration.api_key_encrypted;
    const teamId = integration.team_id;
    const replyTeamId = integration.reply_team_id;
    const externalCampaignId = campaign.external_campaign_id;

    console.log(`Fetching contacts for campaign ${externalCampaignId} using V1 API with page-based pagination`);

    // Use Map for deduplication - key by email
    const contactsMap = new Map<string, V1Contact>();
    
    // Pagination with page numbers (V1 API uses 1-indexed pages)
    let page = 1;
    const limit = 100;
    const maxPages = 100; // Safety cap: 100 * 100 = 10,000 max
    let hasMore = true;
    
    // Diagnostics
    let totalFetchedRaw = 0;
    let duplicatePagesDetected = 0;
    let emptyPagesInRow = 0;
    let stopReason = 'unknown';
    const seenSignatures = new Set<string>();

    while (hasMore && page <= maxPages) {
      const endpoint = `/campaigns/${externalCampaignId}/people?page=${page}&limit=${limit}`;
      console.log(`Fetching V1 contacts: page=${page}, limit=${limit}`);
      
      let contacts: V1Contact[] = [];
      try {
        const response = await fetchWithRetry(endpoint, apiKey, replyTeamId || undefined);
        contacts = parseContactsResponse(response);
      } catch (err) {
        console.error(`Error fetching page ${page}:`, err);
        // If API fails, stop gracefully
        stopReason = `api_error_page_${page}`;
        break;
      }
      
      totalFetchedRaw += contacts.length;
      console.log(`Fetched ${contacts.length} contacts, raw total: ${totalFetchedRaw}`);

      // Check for empty page
      if (contacts.length === 0) {
        emptyPagesInRow++;
        if (emptyPagesInRow >= 2) {
          stopReason = 'empty_pages';
          console.log('Stopping: received 2 consecutive empty pages');
          break;
        }
        page++;
        continue;
      }
      
      emptyPagesInRow = 0;

      // Check for duplicate page (same signature = paging is stuck)
      const pageSignature = getPageSignature(contacts);
      if (seenSignatures.has(pageSignature)) {
        duplicatePagesDetected++;
        console.warn(`Duplicate page detected! Signature: ${pageSignature}`);
        if (duplicatePagesDetected >= 2) {
          stopReason = 'repeating_page_guard';
          console.log('Stopping: detected 2 duplicate pages - API paging is stuck');
          break;
        }
      }
      seenSignatures.add(pageSignature);

      // Track how many new unique emails we get this page
      const uniquesBefore = contactsMap.size;
      
      // Deduplicate: add to map, newer entries overwrite older
      for (const contact of contacts) {
        if (contact.email) {
          contactsMap.set(contact.email.toLowerCase(), contact);
        }
      }
      
      const newUniques = contactsMap.size - uniquesBefore;
      console.log(`Page ${page}: ${newUniques} new unique contacts (total unique: ${contactsMap.size})`);

      // If we got 0 new uniques for this page, it's likely repeating data
      if (newUniques === 0) {
        duplicatePagesDetected++;
        if (duplicatePagesDetected >= 3) {
          stopReason = 'no_new_contacts_guard';
          console.log('Stopping: 3 pages with 0 new contacts');
          break;
        }
      }

      // Check if this was a full page (might have more)
      if (contacts.length < limit) {
        stopReason = 'partial_page';
        hasMore = false;
      } else {
        page++;
        // Rate limit protection between pages
        await new Promise(resolve => setTimeout(resolve, 300));
      }
    }

    if (page > maxPages) {
      stopReason = 'max_pages_reached';
    }

    const uniqueContacts = Array.from(contactsMap.values());
    console.log(`Paging complete. Reason: ${stopReason}. Raw fetched: ${totalFetchedRaw}, Unique: ${uniqueContacts.length}`);

    // Batch upsert contacts to database
    const BATCH_SIZE = 100;
    let contactsSynced = 0;
    let contactsFailed = 0;

    // NOTE: Engagement stats (sent, replies, opens) are fetched at campaign level
    // via sync-reply-campaigns using V1 /campaigns/{id} endpoint.
    // The V1 /campaigns/{id}/people endpoint does NOT return engagement flags.

    for (let i = 0; i < uniqueContacts.length; i += BATCH_SIZE) {
      const batch = uniqueContacts.slice(i, i + BATCH_SIZE);
      const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(uniqueContacts.length / BATCH_SIZE);
      
      console.log(`Processing batch ${batchNumber}/${totalBatches} (${batch.length} contacts)`);

      const records = batch.map(contact => {
        // Store engagement_data structure for future webhook updates
        // Currently all false since V1 people API doesn't return engagement
        const engagementData = {
          replied: false,
          bounced: false,
          opened: false,
          clicked: false,
          optedOut: false,
          finished: false,
          delivered: false,
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
          raw_data: contact,
          updated_at: new Date().toISOString(),
          // Additional fields
          industry: contact.industry || null,
          company_size: contact.companySize && contact.companySize !== 'Empty' ? contact.companySize : null,
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

    // Verify actual count in database
    const { count: verifiedCount } = await serviceClient
      .from("synced_contacts")
      .select("*", { count: "exact", head: true })
      .eq("campaign_id", campaignId);

    const peopleCount = verifiedCount || uniqueContacts.length;

    // Get existing campaign stats to preserve LinkedIn metrics AND email stats from campaign sync
    const { data: existingCampaign } = await serviceClient
      .from("synced_campaigns")
      .select("stats")
      .eq("id", campaignId)
      .maybeSingle();

    const existingStats = (existingCampaign?.stats as Record<string, unknown>) || {};

    // Update campaign with peopleCount only - preserve all other stats
    // Email stats (sent, replies, etc.) come from sync-reply-campaigns via V1 API
    await serviceClient
      .from("synced_campaigns")
      .update({
        stats: {
          ...existingStats,
          peopleCount, // Only update the contact count
        },
        updated_at: new Date().toISOString(),
      })
      .eq("id", campaignId);

    console.log(`Contacts sync complete: ${contactsSynced} processed, ${contactsFailed} failed, ${peopleCount} verified`);

    return new Response(
      JSON.stringify({
        success: true,
        contactsSynced,
        contactsFailed,
        // Diagnostics for debugging
        diagnostics: {
          totalFetchedRaw,
          uniquePrepared: uniqueContacts.length,
          duplicatePagesDetected,
          stopReason,
          pagesProcessed: page,
        },
        verifiedCount: peopleCount,
        campaignStats: {
          peopleCount,
          sent: deliveredCount,
          delivered: deliveredCount,
          replies: repliesCount,
          opens: opensCount,
        },
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
