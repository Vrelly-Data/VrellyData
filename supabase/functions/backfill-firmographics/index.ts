// [backfill-firmographics]
//
// One-shot firmographics backfill for a team from existing synced roster data.
// Safe default implementation: reads public.synced_contacts and upserts into
// public.people with COALESCE semantics (write-only for non-empty fields).
//
// Notes:
// - Auth: internal only via x-agent-key (AGENT_API_KEY). No frontend calls.
// - Input: { teamId: string }
// - Behavior: pages the team's synced_contacts and upserts people rows using
//   (team_id, person_key) where person_key = lower(email) OR linkedin_url.
// - This function intentionally avoids direct provider API calls. If needed,
//   extend with Smartlead/Reply pulls similar to sync-smartlead-leads and
//   sync-reply-contacts. Keep COALESCE (write-only) semantics for people.
//
// Response: { teamId, scanned, upserted, skipped_no_key }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sanitizeLinkedinUrlForStorage } from "../_shared/normalize.ts";

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

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    // Internal gate
    const agentKey = req.headers.get("x-agent-key") || "";
    const expected = Deno.env.get("AGENT_API_KEY") || "";
    if (!agentKey || !expected || agentKey !== expected) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { teamId } = await req.json().catch(() => ({}));
    if (!teamId || typeof teamId !== "string") {
      return new Response(JSON.stringify({ error: "Missing teamId" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");

    const PAGE = 500;
    let offset = 0;
    let scanned = 0;
    let upserted = 0;
    let skippedNoKey = 0;

    while (true) {
      const { data: rows, error } = await supabase
        .from("synced_contacts")
        .select("email, linkedin_url, first_name, last_name, company, job_title, industry, company_size, city, state, country, phone, custom_fields")
        .eq("team_id", teamId)
        .order("updated_at", { ascending: false, nullsFirst: false })
        .range(offset, offset + PAGE - 1);
      if (error) throw new Error(error.message);
      const batch = Array.isArray(rows) ? rows : [];
      if (batch.length === 0) break;
      scanned += batch.length;

      // Build people upserts with write-only (include only non-empty)
      const payloads: Array<Record<string, unknown>> = [];
      for (const r of batch) {
        const emailLower =
          typeof (r as any)?.email === "string" && (r as any).email.includes("@")
            ? String((r as any).email).trim().toLowerCase()
            : null;
        const li = sanitizeLinkedinUrlForStorage((r as any)?.linkedin_url ?? null);
        const personKey = emailLower || li;
        if (!personKey) {
          skippedNoKey++;
          continue;
        }
        const fullName = [String((r as any)?.first_name ?? "").trim(), String((r as any)?.last_name ?? "").trim()]
          .filter(Boolean)
          .join(" ");
        const put = (obj: Record<string, unknown>, key: string, val: unknown) => {
          const s = typeof val === "string" ? val : String(val ?? "");
          const t = s.trim();
          if (t && t !== "0") obj[key] = t;
        };
        const p: Record<string, unknown> = {
          team_id: teamId,
          person_key: personKey,
          email: emailLower,
          linkedin_url: li,
        };
        if (fullName) p.full_name = fullName;
        put(p, "company_name", (r as any)?.company);
        put(p, "job_title", (r as any)?.job_title);
        put(p, "industry", (r as any)?.industry);
        put(p, "company_size", (r as any)?.company_size);
        put(p, "city", (r as any)?.city);
        put(p, "state", (r as any)?.state);
        put(p, "country", (r as any)?.country);
        put(p, "phone", (r as any)?.phone);
        // Optional: derive company_phone from custom_fields if present
        try {
          const cf = (r as any)?.custom_fields;
          if (cf && typeof cf === "object") {
            for (const [k, v] of Object.entries(cf as Record<string, unknown>)) {
              const nk = k.trim().toLowerCase().replace(/\s+/g, " ").replace(/[_-]+/g, " ").trim();
              if (["company phone", "company_phone", "hq phone", "company phone number", "switchboard"].includes(nk)) {
                put(p, "company_phone", v as string);
                break;
              }
            }
          }
        } catch {
          // ignore custom_fields parse errors
        }
        payloads.push(p);
      }

      if (payloads.length > 0) {
        const { error: upErr, count } = await supabase
          .from("people")
          // @ts-ignore onConflict supports column-list
          .upsert(payloads, { onConflict: "team_id,person_key", count: "exact" });
        if (upErr) throw new Error(`people upsert failed: ${upErr.message}`);
        if (typeof count === "number") upserted += count;
      }
      offset += batch.length;
      if (batch.length < PAGE) break;
      await new Promise((r) => setTimeout(r, 100));
    }

    return new Response(JSON.stringify({ teamId, scanned, upserted, skipped_no_key: skippedNoKey }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[backfill-firmographics] error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

