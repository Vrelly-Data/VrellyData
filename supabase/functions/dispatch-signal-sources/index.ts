// dispatch-signal-sources — the ONE scheduled entry point for Signals.
//
// pg_cron 'dispatch-signal-sources' calls this hourly (Vault agent_api_key,
// like dispatch-agent-audiences). It selects active sources that are due by
// cadence (./due.ts) and invokes each source's own edge function
// (signal_sources.function_name) with the same key. Each source function
// writes its own signal_runs row and source health, so this function only
// decides WHO runs. Body { dry_run: true } returns the selection only;
// { source_key } runs that one source now regardless of cadence.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { authorizeSignalsCaller, signalsCors } from "../_shared/signals.ts";
import { isSourceDue } from "./due.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: signalsCors });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...signalsCors, "Content-Type": "application/json" } });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const agentKey = Deno.env.get("AGENT_API_KEY") ?? "";
  const supabase = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const auth = await authorizeSignalsCaller(req, supabase, agentKey);
  if (!auth.ok) return json({ error: "Unauthorized" }, 401);

  const body = await req.json().catch(() => ({}));
  const now = Date.now();
  const { data: sources, error } = await supabase
    .from("signal_sources")
    .select("key, function_name, cadence, is_active, last_run_at, last_run_status")
    .eq("is_active", true);
  if (error) return json({ error: error.message }, 500);

  const selected = (sources ?? []).filter((s) =>
    body?.source_key ? s.key === body.source_key : isSourceDue(s.cadence, s.last_run_at, now)
  );
  const notDue = (sources ?? []).filter((s) => !selected.includes(s)).map((s) => s.key);
  if (body?.dry_run) return json({ dry_run: true, due: selected.map((s) => s.key), not_due: notDue });

  const results = await Promise.all(selected.map(async (s) => {
    try {
      const res = await fetch(`${supabaseUrl}/functions/v1/${s.function_name}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-agent-key": agentKey },
        // Sources that serve several writers (signal-inputs-run) need to know which one is due.
        body: JSON.stringify({ source_key: s.key }),
        signal: AbortSignal.timeout(140_000),
      });
      const out = await res.json().catch(() => null);
      return { source: s.key, http: res.status, status: out?.status ?? null, inserted: out?.inserted ?? null, error: out?.error ?? null };
    } catch (e) {
      return { source: s.key, http: null, status: "dispatch_failed", error: e instanceof Error ? e.message : String(e) };
    }
  }));
  console.log(`[dispatch-signal-sources] by=${auth.by} ran=${JSON.stringify(results)} not_due=${notDue.join(",")}`);
  return json({ ran: results, not_due: notDue });
});
