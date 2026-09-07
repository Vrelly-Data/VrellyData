// [reconcile-smartlead-webhooks v1]
//
// Small orchestrator that lets the UI reconcile Smartlead webhooks after a
// Manage Campaigns save without exposing x-agent-key to the browser.
// - Auth: Bearer user JWT (must own the integration via created_by)
// - Action: calls setup-smartlead-webhook internally with x-agent-key
//
// Status scope defaults to live campaigns only (in_progress). Callers may pass
// { statuses: [...] } to widen if needed.
//
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
      "authorization, x-client-info, apikey, content-type",
  };
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // Auth — require a user JWT
    const authHeader = req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const integrationId = (body as { integrationId?: string }).integrationId;
    const statuses: string[] = Array.isArray((body as { statuses?: string[] }).statuses)
      ? (body as { statuses: string[] }).statuses
      : ["in_progress"];
    const campaignIds: string[] = Array.isArray((body as { campaignIds?: string[] }).campaignIds)
      ? (body as { campaignIds: string[] }).campaignIds.map(String)
      : [];
    if (!integrationId) {
      return new Response(JSON.stringify({ error: "Missing integrationId" }), {
        status: 400,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    // Verify the user owns the integration and that it's Smartlead
    const db = createClient(supabaseUrl, serviceKey);
    const { data: integration, error: intErr } = await db
      .from("outbound_integrations")
      .select("id, platform, created_by")
      .eq("id", integrationId)
      .eq("created_by", user.id)
      .single();
    if (intErr || !integration) {
      return new Response(JSON.stringify({ error: "Integration not found or access denied" }), {
        status: 404,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }
    if (integration.platform !== "smartlead") {
      return new Response(JSON.stringify({ error: "Only Smartlead integrations are supported" }), {
        status: 400,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    // Proxy call to setup-smartlead-webhook with server auth
    const agentKey = Deno.env.get("AGENT_API_KEY");
    if (!agentKey) {
      return new Response(JSON.stringify({ error: "Server auth not configured" }), {
        status: 500,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const res = await fetch(`${supabaseUrl}/functions/v1/setup-smartlead-webhook`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-agent-key": agentKey,
      },
      body: JSON.stringify(
        campaignIds.length > 0
          ? { integrationId, campaignIds }
          : { integrationId, statuses }
      ),
    });
    const text = await res.text();
    const payload = (() => {
      try { return JSON.parse(text); } catch { return { raw: text }; }
    })();

    return new Response(JSON.stringify({
      success: res.ok || payload?.success === true,
      status: res.status,
      result: payload,
    }), { status: 200, headers: { ...cors, "Content-Type": "application/json" } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[reconcile-smartlead-webhooks] error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});

