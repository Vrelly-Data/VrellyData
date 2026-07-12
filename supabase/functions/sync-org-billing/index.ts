// [sync-org-billing v1]
//
// Superadmin-only. For each organization with a stripe_customer_id, fetch the
// active subscription and write stripe_monthly_cents + stripe_synced_at.
// NEVER touches manual_monthly_cents (the manual override is authoritative).
//
// The $0/100%-off-coupon case is handled by applying the subscription's
// discount to the base price, so a fully-couponed client records 0 (not the
// list price) — and the manual override carries what they actually pay.
//
// Auth: JWT + defense-in-depth is_super_admin check (NOT is_platform_admin).

import Stripe from "https://esm.sh/stripe@14.21.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const allowedOrigins = [
  Deno.env.get("ALLOWED_ORIGIN") || "https://vrelly.com",
  "https://www.vrelly.com",
];
function getCorsHeaders(req: Request) {
  const origin = req.headers.get("Origin") || "";
  return {
    "Access-Control-Allow-Origin": allowedOrigins.includes(origin) ? origin : allowedOrigins[0],
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };
}
const log = (s: string, d?: unknown) =>
  console.log(`[sync-org-billing] ${s}${d ? ` - ${JSON.stringify(d)}` : ""}`);

// Normalize a subscription's price + discount to an effective MONTHLY cents.
function monthlyCentsForSubscription(sub: Stripe.Subscription): number {
  let base = 0;
  for (const item of sub.items.data) {
    const price = item.price;
    const unit = price.unit_amount ?? 0;
    const qty = item.quantity ?? 1;
    const interval = price.recurring?.interval ?? "month";
    const intervalCount = price.recurring?.interval_count ?? 1;
    let perMonth = unit * qty;
    if (interval === "year") perMonth /= 12;
    else if (interval === "week") perMonth *= 4.345;
    else if (interval === "day") perMonth *= 30;
    perMonth /= intervalCount;
    base += perMonth;
  }
  // Apply subscription-level discount (this is how the 100%-off coupon → 0).
  const coupon = sub.discount?.coupon;
  if (coupon) {
    if (coupon.percent_off) base = base * (1 - coupon.percent_off / 100);
    else if (coupon.amount_off) base = base - coupon.amount_off;
  }
  return Math.max(0, Math.round(base));
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const json = (b: unknown, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Auth + SUPERADMIN gate (defense-in-depth; RLS also enforces it).
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !user) return json({ error: "Unauthorized" }, 401);

    const { data: prof } = await userClient
      .from("profiles").select("is_super_admin").eq("id", user.id).maybeSingle();
    if (!prof?.is_super_admin) {
      log("Non-superadmin blocked", { userId: user.id });
      return json({ error: "Forbidden" }, 403);
    }

    const supabase = createClient(supabaseUrl, serviceKey);
    const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, { apiVersion: "2023-10-16" });

    const { data: orgs, error: orgErr } = await supabase
      .from("organizations")
      .select("id, stripe_customer_id")
      .not("stripe_customer_id", "is", null);
    if (orgErr) return json({ error: orgErr.message }, 500);

    let synced = 0, errors = 0;
    const nowIso = new Date().toISOString();

    for (const org of orgs ?? []) {
      try {
        const subs = await stripe.subscriptions.list({
          customer: org.stripe_customer_id as string,
          status: "active",
          limit: 1,
        });
        const sub = subs.data[0];
        // No active sub → record null (unknown), keep manual override intact.
        const cents = sub ? monthlyCentsForSubscription(sub) : null;
        const { error: upErr } = await supabase
          .from("organizations")
          .update({
            stripe_monthly_cents: cents,
            stripe_subscription_id: sub?.id ?? null,
            stripe_synced_at: nowIso,
          })
          .eq("id", org.id);
        if (upErr) throw new Error(upErr.message);
        synced++;
      } catch (e) {
        errors++;
        log("Sync failed for org", { orgId: org.id, error: (e as Error).message });
      }
    }

    log("Done", { synced, errors });
    return json({ synced, errors });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log("Fatal error", { error: msg });
    return json({ error: msg }, 500);
  }
});
