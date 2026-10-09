// Website-visitor identification — a pluggable adapter, STUBBED for now.
//
// The public 'track' function calls resolveVisitor once per hit, while the raw
// IP is still in memory (it is never stored: only a salted hash is). Whatever
// the adapter returns is stored on the hit (signal_pixel_hits.resolved) and the
// daily rollup copies the newest non-null answer onto the site_visit signal.
//
// To plug in a provider (reverse-IP / company identification): implement
// VisitorResolver, register it in RESOLVERS, and set the
// VISITOR_RESOLVER secret to its name. Provider keys go in Supabase secrets.
// Update the privacy note in the UI when a provider is enabled.

export interface VisitorHit {
  ip: string | null;
  userAgent: string | null;
  url: string;
  referrer: string | null;
  anonId: string | null;
  siteDomain: string;
}

export interface ResolvedVisitor {
  provider: string;
  company_name?: string | null;
  company_domain?: string | null;
  person_name?: string | null;
  person_title?: string | null;
  person_email?: string | null;
  person_linkedin?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  confidence?: number | null;
}

export type VisitorResolver = (hit: VisitorHit) => Promise<ResolvedVisitor | null>;

/** The stub: identifies nobody. */
export const noopResolver: VisitorResolver = () => Promise.resolve(null);

const RESOLVERS: Record<string, VisitorResolver> = {
  none: noopResolver,
};

export function getVisitorResolver(name = Deno.env.get("VISITOR_RESOLVER") ?? "none"): VisitorResolver {
  return RESOLVERS[name] ?? noopResolver;
}
