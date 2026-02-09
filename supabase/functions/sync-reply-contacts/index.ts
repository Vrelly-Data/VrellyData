import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// V3 API for extended contacts with engagement data
const REPLY_API_V3 = "https://api.reply.io/v3";
// V1 API as fallback
const REPLY_API_V1 = "https://api.reply.io/v1";

// V3 Extended Contact response structure
// Reply.io returns different field names depending on the endpoint version
interface V3ExtendedContact {
  id?: number;
  contactId?: number; // Sometimes returned instead of id
  email: string;
  firstName?: string;
  lastName?: string;
  title?: string;
  company?: string;
  addedTime?: string;
  addedAt?: string; // Sometimes returned instead of addedTime
  status?: {
    status?: string; // "Active", "Finished", etc.
    replied?: boolean;
    delivered?: boolean;
    opened?: boolean;
    clicked?: boolean;
    bounced?: boolean;
    finished?: boolean;
    optedOut?: boolean;
  };
  // Additional fields
  industry?: string;
  companySize?: string;
  city?: string;
  state?: string;
  country?: string;
  phone?: string;
  linkedInProfile?: string;
  linkedinProfile?: string; // Handle both casings
}

// V1 Contact response structure (fallback)
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
  industry?: string;
  companySize?: string;
  city?: string;
  state?: string;
  country?: string;
  phone?: string;
  linkedInProfile?: string;
}

// Unified contact structure for processing
interface UnifiedContact {
  id?: number;
  email: string;
  firstName?: string;
  lastName?: string;
  title?: string;
  company?: string;
  addedAt?: string;
  industry?: string;
  companySize?: string;
  city?: string;
  state?: string;
  country?: string;
  phone?: string;
  linkedInProfile?: string;
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

// Engagement counters
interface EngagementStats {
  deliveredCount: number;
  repliesCount: number;
  opensCount: number;
  clicksCount: number;
  bouncesCount: number;
  optedOutCount: number;
}

// V3 API fetch with retry
async function fetchWithRetryV3(
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

      const response = await fetch(`${REPLY_API_V3}${endpoint}`, { headers });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Reply.io V3 API error (${response.status}): ${errorText}`);
      }

      return response.json();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      if (errorMessage.includes("Too much requests") && attempt < maxRetries) {
        const waitTime = 5000 * attempt;
        console.log(`V3 Rate limited, waiting ${waitTime / 1000}s before retry ${attempt}/${maxRetries}`);
        await new Promise((resolve) => setTimeout(resolve, waitTime));
        continue;
      }
      throw error;
    }
  }
  throw new Error(`Max retries exceeded for V3 ${endpoint}`);
}

// V1 API fetch with retry (fallback)
async function fetchWithRetryV1(
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
        console.log(`V1 Rate limited, waiting ${waitTime / 1000}s before retry ${attempt}/${maxRetries}`);
        await new Promise((resolve) => setTimeout(resolve, waitTime));
        continue;
      }
      throw error;
    }
  }
  throw new Error(`Max retries exceeded for V1 ${endpoint}`);
}

// Parse V3 extended contacts response
function parseV3ContactsResponse(response: unknown): V3ExtendedContact[] {
  if (!response || typeof response !== 'object') {
    console.warn(`V3 response is not an object`);
    return [];
  }
  
  const obj = response as Record<string, unknown>;
  console.log(`V3 response keys: ${Object.keys(obj).join(', ')}`);
  
  // Try different possible array locations
  const rawContacts = obj.items || obj.contacts || obj.data || obj.people;
  if (Array.isArray(rawContacts)) {
    return rawContacts as V3ExtendedContact[];
  }
  
  // If response itself is an array
  if (Array.isArray(response)) {
    return response as V3ExtendedContact[];
  }
  
  console.warn(`Could not find contacts array in V3 response`);
  return [];
}

// Parse V1 contacts response (fallback)
function parseV1ContactsResponse(response: unknown): V1Contact[] {
  if (Array.isArray(response)) {
    return response as V1Contact[];
  }
  if (response && typeof response === 'object') {
    const obj = response as Record<string, unknown>;
    const rawContacts = obj.people || obj.contacts || obj.items || obj.data;
    if (Array.isArray(rawContacts)) {
      return rawContacts as V1Contact[];
    }
  }
  return [];
}

// Convert V3 contact to unified format
function v3ToUnified(contact: V3ExtendedContact): UnifiedContact {
  const status = contact.status || {};
  
  // Handle Reply.io's various boolean representations
  const toBool = (val: unknown): boolean => {
    if (typeof val === 'boolean') return val;
    if (typeof val === 'string') return val.toLowerCase() === 'true';
    return false;
  };
  
  // Extract engagement flags
  const replied = toBool(status.replied);
  const opened = toBool(status.opened);
  const clicked = toBool(status.clicked);
  const bounced = toBool(status.bounced);
  const finished = toBool(status.finished);
  const optedOut = toBool(status.optedOut);
  
  // Delivered: use explicit flag, or infer from activity (opened/replied/clicked implies delivered)
  const deliveredExplicit = toBool(status.delivered);
  const hasEmailActivity = opened || replied || clicked;
  const delivered = deliveredExplicit || hasEmailActivity;
  
  return {
    id: contact.id ?? contact.contactId,
    email: contact.email,
    firstName: contact.firstName,
    lastName: contact.lastName,
    title: contact.title,
    company: contact.company,
    addedAt: contact.addedAt ?? contact.addedTime,
    industry: contact.industry,
    companySize: contact.companySize,
    city: contact.city,
    state: contact.state,
    country: contact.country,
    phone: contact.phone,
    linkedInProfile: contact.linkedInProfile ?? contact.linkedinProfile,
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

// Convert V1 contact to unified format
function v1ToUnified(contact: V1Contact): UnifiedContact {
  return {
    id: contact.id,
    email: contact.email,
    firstName: contact.firstName,
    lastName: contact.lastName,
    title: contact.title,
    company: contact.company,
    addedAt: contact.addedAt,
    industry: contact.industry,
    companySize: contact.companySize,
    city: contact.city,
    state: contact.state,
    country: contact.country,
    phone: contact.phone,
    linkedInProfile: contact.linkedInProfile,
    // V1 API does include these flags at contact level
    delivered: false, // V1 doesn't have delivered flag
    replied: contact.replied === true,
    opened: contact.opened === true,
    clicked: contact.clicked === true,
    bounced: contact.bounced === true,
    finished: contact.finished === true,
    optedOut: contact.optedOut === true,
    rawData: contact,
  };
}

// Map contact status string
function mapContactStatus(contact: UnifiedContact): string {
  if (contact.replied) return 'replied';
  if (contact.bounced) return 'bounced';
  if (contact.optedOut) return 'opted_out';
  if (contact.finished) return 'finished';
  if (contact.opened) return 'opened';
  return 'active';
}

// Fetch contacts using V3 extended endpoint (primary)
async function fetchContactsV3Extended(
  sequenceId: string,
  apiKey: string,
  teamId?: string
): Promise<{ contacts: UnifiedContact[]; success: boolean }> {
  const contactsMap = new Map<string, UnifiedContact>();
  let offset = 0;
  const limit = 100;
  const maxPages = 100;
  let hasMore = true;
  
  console.log(`Attempting V3 extended contacts for sequence ${sequenceId}`);
  
  try {
    let isFirstBatch = true;
    
    while (hasMore && offset < maxPages * limit) {
      // CRITICAL: Include additionalColumns=Status to get engagement flags
      const endpoint = `/sequences/${sequenceId}/contacts/extended?limit=${limit}&offset=${offset}&additionalColumns=Status`;
      console.log(`V3 fetch: offset=${offset}, limit=${limit}, with Status column`);
      
      const response = await fetchWithRetryV3(endpoint, apiKey, teamId);
      const contacts = parseV3ContactsResponse(response);
      
      console.log(`V3 returned ${contacts.length} contacts`);
      
      // Diagnostic: log first contact's keys to verify status is present
      if (isFirstBatch && contacts.length > 0) {
        const firstContact = contacts[0];
        const keys = Object.keys(firstContact);
        console.log(`First contact keys: ${keys.join(', ')}`);
        if (firstContact.status) {
          console.log(`Status object keys: ${Object.keys(firstContact.status).join(', ')}`);
          console.log(`Status sample: replied=${firstContact.status.replied}, opened=${firstContact.status.opened}, delivered=${firstContact.status.delivered}`);
        } else {
          console.warn(`WARNING: First contact has no 'status' object - engagement flags will be empty`);
        }
        isFirstBatch = false;
      }
      
      if (contacts.length === 0) {
        hasMore = false;
        break;
      }
      
      // Check for hasMore in response
      const responseObj = response as Record<string, unknown>;
      const info = responseObj.info as Record<string, unknown> | undefined;
      if (info && info.hasMore === false) {
        hasMore = false;
      }
      
      // Deduplicate by email
      for (const contact of contacts) {
        if (contact.email) {
          contactsMap.set(contact.email.toLowerCase(), v3ToUnified(contact));
        }
      }
      
      if (contacts.length < limit) {
        hasMore = false;
      } else {
        offset += limit;
        await new Promise(resolve => setTimeout(resolve, 300));
      }
    }
    
    const uniqueContacts = Array.from(contactsMap.values());
    console.log(`V3 extended: fetched ${uniqueContacts.length} unique contacts with engagement data`);
    return { contacts: uniqueContacts, success: true };
    
  } catch (error) {
    console.warn(`V3 extended contacts failed:`, error);
    return { contacts: [], success: false };
  }
}

// Fetch contacts using V1 endpoint (fallback)
async function fetchContactsV1(
  campaignId: string,
  apiKey: string,
  teamId?: string
): Promise<{ contacts: UnifiedContact[]; success: boolean }> {
  const contactsMap = new Map<string, UnifiedContact>();
  let page = 1;
  const limit = 100;
  const maxPages = 100;
  let hasMore = true;
  
  console.log(`Falling back to V1 contacts for campaign ${campaignId}`);
  
  try {
    while (hasMore && page <= maxPages) {
      const endpoint = `/campaigns/${campaignId}/people?page=${page}&limit=${limit}`;
      console.log(`V1 fetch: page=${page}, limit=${limit}`);
      
      const response = await fetchWithRetryV1(endpoint, apiKey, teamId);
      const contacts = parseV1ContactsResponse(response);
      
      console.log(`V1 returned ${contacts.length} contacts`);
      
      if (contacts.length === 0) {
        hasMore = false;
        break;
      }
      
      // Deduplicate by email
      for (const contact of contacts) {
        if (contact.email) {
          contactsMap.set(contact.email.toLowerCase(), v1ToUnified(contact));
        }
      }
      
      if (contacts.length < limit) {
        hasMore = false;
      } else {
        page++;
        await new Promise(resolve => setTimeout(resolve, 300));
      }
    }
    
    const uniqueContacts = Array.from(contactsMap.values());
    console.log(`V1 fallback: fetched ${uniqueContacts.length} unique contacts`);
    return { contacts: uniqueContacts, success: true };
    
  } catch (error) {
    console.error(`V1 contacts also failed:`, error);
    return { contacts: [], success: false };
  }
}

// Compute engagement stats from contacts
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

    // Use user's auth to validate access
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

    // Fetch the campaign
    const { data: campaign, error: campaignError } = await userClient
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

    const apiKey = integration.api_key_encrypted;
    const teamId = integration.team_id;
    const replyTeamId = integration.reply_team_id;
    const externalCampaignId = campaign.external_campaign_id;

    console.log(`Syncing contacts for campaign ${externalCampaignId}`);

    // Try V3 extended first (has engagement data)
    let { contacts, success: v3Success } = await fetchContactsV3Extended(
      externalCampaignId,
      apiKey,
      replyTeamId || undefined
    );
    
    let usedV3 = v3Success;
    
    // Fall back to V1 if V3 failed
    if (!v3Success || contacts.length === 0) {
      const v1Result = await fetchContactsV1(
        externalCampaignId,
        apiKey,
        replyTeamId || undefined
      );
      contacts = v1Result.contacts;
      usedV3 = false;
    }

    console.log(`Total contacts to sync: ${contacts.length} (source: ${usedV3 ? 'V3 extended' : 'V1 fallback'})`);

    // Compute engagement stats from contacts
    const engagementStats = computeEngagementStats(contacts);
    console.log(`Engagement stats: delivered=${engagementStats.deliveredCount}, replies=${engagementStats.repliesCount}, opens=${engagementStats.opensCount}`);

    // Batch upsert contacts
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

    // Update campaign stats with computed values from contacts
    // Preserve LinkedIn CSV fields (liConnectionsSent, liMessagesReplied, etc.)
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

    return new Response(
      JSON.stringify({
        success: true,
        contactsSynced,
        contactsFailed,
        verifiedCount: peopleCount,
        source: usedV3 ? 'v3_extended' : 'v1_fallback',
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
