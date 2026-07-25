// [sync-smartlead-email-accounts v1]
//
// Populates email_sender_mailboxes for a Smartlead integration: one row per
// sending mailbox, auto-mapped to the sender whose sender_profiles.sender_name
// equals the mailbox's Smartlead from_name (case-insensitive/trimmed — same
// rule classify-reply uses). Unmatched from_names land unmapped (sender_name
// NULL) for operator review. Existing sender_name values are PRESERVED (never
// clobber an operator's manual mapping on re-sync).
//
// Auth: JWT (owner) or x-agent-key (cron). Body: { integrationId }.
//
// Smartlead: GET /api/v1/email-accounts/?api_key=KEY (api_key in the query
// string, never logged). Each account carries from_email + from_name.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const SMARTLEAD_API_BASE = "https://server.smartlead.ai/api/v1";

const allowedOrigins = [
  Deno.env.get("ALLOWED_ORIGIN") || "https://vrelly.com",
  "https://www.vrelly.com",
];
function getCorsHeaders(req: Request) {
  const origin = req.headers.get("Origin") || "";
  return {
    "Access-Control-Allow-Origin": allowedOrigins.includes(origin) ? origin : allowedOrigins[0],
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-agent-key",
  };
}
const log = (s: string, d?: unknown) =>
  console.log(`[sync-smartlead-email-accounts] ${s}${d ? ` - ${JSON.stringify(d)}` : ""}`);

const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

interface SmartleadEmailAccount {
  id?: number;
  from_name?: string | null;
  from_email?: string | null;
  [k: string]: unknown;
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const json = (b: unknown, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // Auth: internal cron (x-agent-key) or an owner JWT.
    const agentKey = req.headers.get("x-agent-key");
    const isInternal = !!(agentKey && Deno.env.get("AGENT_API_KEY") && agentKey === Deno.env.get("AGENT_API_KEY"));
    let callerUserId: string | null = null;
    if (!isInternal) {
      const authHeader = req.headers.get("authorization");
      if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
      const userClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user } } = await userClient.auth.getUser();
      if (!user) return json({ error: "Unauthorized" }, 401);
      callerUserId = user.id;
    }

    const body = await req.json().catch(() => ({}));
    const integrationId = (body as { integrationId?: string }).integrationId;
    if (!integrationId) return json({ error: "Missing integrationId" }, 400);

    const supabase = createClient(supabaseUrl, serviceKey);

    let intQ = supabase
      .from("outbound_integrations")
      .select("id, created_by, api_key_encrypted, platform, is_active")
      .eq("id", integrationId)
      .eq("platform", "smartlead");
    if (callerUserId) intQ = intQ.eq("created_by", callerUserId); // owner scope
    const { data: integration } = await intQ.maybeSingle();
    if (!integration?.created_by || !integration.api_key_encrypted) {
      return json({ error: "Smartlead integration not found" }, 404);
    }
    const userId = integration.created_by as string;
    const apiKey = integration.api_key_encrypted as string;

    // 1. Fetch all Smartlead email accounts (paginated; api_key in query).
    const accounts: SmartleadEmailAccount[] = [];
    for (let offset = 0; offset < 5000; offset += 100) {
      const url = new URL(`${SMARTLEAD_API_BASE}/email-accounts/`);
      url.searchParams.set("api_key", apiKey);
      url.searchParams.set("offset", String(offset));
      url.searchParams.set("limit", "100");
      const res = await fetch(url.toString(), { headers: { Accept: "application/json" } });
      if (!res.ok) {
        const errBody = await res.text().catch(() => "");
        log("email-accounts fetch failed", { status: res.status, body: errBody.slice(0, 200) });
        if (offset === 0) return json({ error: `Smartlead email-accounts ${res.status}` }, 502);
        break;
      }
      const pageRaw = await res.json();
      const page: SmartleadEmailAccount[] = Array.isArray(pageRaw) ? pageRaw : (pageRaw?.data ?? []);
      accounts.push(...page);
      if (page.length < 100) break;
    }
    log("Fetched email accounts", { count: accounts.length });

    // 2. Sender names + existing mappings, for auto-map + preserve.
    const { data: senders } = await supabase
      .from("sender_profiles").select("sender_name").eq("user_id", userId);
    const senderByNorm = new Map<string, string>();
    for (const s of senders ?? []) {
      const n = norm(s.sender_name);
      if (n) senderByNorm.set(n, s.sender_name as string);
    }
    const { data: existingRows } = await supabase
      .from("email_sender_mailboxes").select("mailbox_email, sender_name").eq("user_id", userId);
    const existingSenderByMailbox = new Map<string, string | null>();
    for (const r of existingRows ?? []) {
      existingSenderByMailbox.set(norm(r.mailbox_email), (r.sender_name as string | null) ?? null);
    }

    // 3. Upsert one row per mailbox. sender_name = PRESERVE existing, else
    //    auto-match on from_name, else NULL (unmapped).
    const now = new Date().toISOString();
    const rows = accounts
      .filter((a) => a.from_email && String(a.from_email).trim())
      .map((a) => {
        const mailbox = String(a.from_email).trim();
        const fromName = a.from_name ? String(a.from_name).trim() : null;
        const existing = existingSenderByMailbox.get(norm(mailbox));
        const auto = fromName ? senderByNorm.get(norm(fromName)) ?? null : null;
        const sender_name = existing ?? auto; // preserve manual/prior mapping
        return { user_id: userId, mailbox_email: mailbox, from_name: fromName, sender_name, source: "smartlead", updated_at: now };
      });

    let upserted = 0;
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      const { error } = await supabase
        .from("email_sender_mailboxes")
        .upsert(chunk, { onConflict: "user_id,mailbox_email" });
      if (error) { log("upsert failed", { error: error.message }); return json({ error: error.message }, 500); }
      upserted += chunk.length;
    }

    const mapped = rows.filter((r) => r.sender_name).length;
    const unmapped = rows.length - mapped;
    log("Done", { upserted, mapped, unmapped });
    return json({ total: rows.length, upserted, mapped, unmapped });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log("Fatal error", { error: msg });
    return json({ error: msg }, 500);
  }
});
