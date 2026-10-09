// Public pixel endpoint for website visitors (no JWT, CORS open).
//
// Receives {site_key, url, referrer, ts, anon_id} — sent by the snippet with
// navigator.sendBeacon as text/plain (no CORS preflight) — and stores one row
// in signal_pixel_hits through signals_track_hit, which also checks the site is
// active, the page is on the site's domain, and the rate limits
// (60 hits/min per IP hash, 5000/hour per site).
//
// Privacy: the raw IP is used only in memory — hashed with the PIXEL_IP_SALT
// secret (sha256) and handed to the resolveVisitor adapter — and never stored
// or logged. Without the salt the endpoint refuses hits (503) rather than
// store a reversible hash.

import { getVisitorResolver, type VisitorResolver } from "../_shared/visitor-resolver.ts";

export const TRACK_CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Max-Age": "86400",
};

const SITE_KEY = /^vs_[a-f0-9]{32}$/;
const MAX_BODY = 8 * 1024;

export interface TrackPayload {
  site_key: string;
  url: string;
  referrer: string | null;
  ts: string | null;
  anon_id: string | null;
}

/** Validates and normalizes the beacon body. null = reject (400). */
export function parseTrackPayload(raw: string): TrackPayload | null {
  if (!raw || raw.length > MAX_BODY) return null;
  let b: Record<string, unknown>;
  try {
    b = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!b || typeof b !== "object") return null;
  const site_key = typeof b.site_key === "string" ? b.site_key.trim() : "";
  const url = typeof b.url === "string" ? b.url.trim() : "";
  if (!SITE_KEY.test(site_key) || !/^https?:\/\//i.test(url) || url.length > 2000) return null;
  const referrer = typeof b.referrer === "string" && /^https?:\/\//i.test(b.referrer) ? b.referrer.slice(0, 2000) : null;
  const tsMs = typeof b.ts === "string" ? Date.parse(b.ts) : NaN;
  const anon = typeof b.anon_id === "string" ? b.anon_id.trim() : "";
  return {
    site_key,
    url,
    referrer,
    ts: Number.isFinite(tsMs) ? new Date(tsMs).toISOString() : null,
    anon_id: /^[A-Za-z0-9_-]{8,100}$/.test(anon) ? anon : null,
  };
}

/** First hop of x-forwarded-for (the client), else cf-connecting-ip / x-real-ip. */
export function clientIp(req: Request): string | null {
  const xff = req.headers.get("x-forwarded-for");
  const first = xff?.split(",")[0]?.trim();
  return first || req.headers.get("cf-connecting-ip") || req.headers.get("x-real-ip") || null;
}

export async function hashIp(ip: string, salt: string): Promise<string> {
  const data = new TextEncoder().encode(`${salt}:${ip}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const STATUS: Record<string, number> = { ok: 204, unknown_site: 404, domain_mismatch: 403, rate_limited: 429 };

export async function handleTrack(
  req: Request,
  deps: {
    // deno-lint-ignore no-explicit-any
    supabase: any;
    salt: string;
    resolver?: VisitorResolver;
  },
): Promise<Response> {
  const reply = (status: number, body?: unknown) =>
    new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { ...TRACK_CORS, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    });

  if (req.method === "OPTIONS") return reply(204);
  if (req.method !== "POST") return reply(405, { error: "POST only" });
  if (!deps.salt) return reply(503, { error: "pixel not configured" });

  const p = parseTrackPayload(await req.text());
  if (!p) return reply(400, { error: "invalid payload" });

  const ip = clientIp(req);
  if (!ip) return reply(400, { error: "no client address" });
  const ipHash = await hashIp(ip, deps.salt);
  const userAgent = req.headers.get("user-agent")?.slice(0, 500) ?? null;

  let resolved: unknown = null;
  try {
    const host = new URL(p.url).hostname.replace(/^www\./, "");
    resolved = await (deps.resolver ?? getVisitorResolver())({
      ip, userAgent, url: p.url, referrer: p.referrer, anonId: p.anon_id, siteDomain: host,
    });
  } catch (e) {
    console.error(`[track] resolver failed: ${e instanceof Error ? e.message : e}`);
  }

  const { data, error } = await deps.supabase.rpc("signals_track_hit", {
    p_site_key: p.site_key, p_url: p.url, p_referrer: p.referrer, p_ip_hash: ipHash,
    p_user_agent: userAgent, p_anon_id: p.anon_id, p_ts: p.ts, p_resolved: resolved,
  });
  if (error) {
    console.error(`[track] signals_track_hit failed: ${error.message}`);
    return reply(500, { error: "could not record hit" });
  }
  const result = String(data);
  return reply(STATUS[result] ?? 500, result === "ok" ? undefined : { error: result });
}
