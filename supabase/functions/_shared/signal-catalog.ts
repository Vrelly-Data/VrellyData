// Signals catalog: the two dimensions every signal is described by.
//
//   SIGNAL TYPE = what happened (the primary tabs). signals.signal_type holds
//     the INTERNAL key; clients only ever see the PUBLIC key and label. The
//     only key that differs is positive_response, whose public face is
//     "High Intent" / high_intent: a client must never be told that a signal
//     came from someone replying to outbound.
//   MARKET = who a signal is relevant to (filter chips, several per signal).
//     Assigned by ./signal-markets.ts.
//
// The client half of this vocabulary is src/lib/signalCatalog.ts; the SQL
// half is signals_public_type() / the markets CHECK in the migrations.

export const SIGNAL_TYPES = [
  "positive_response",
  "fda_clearance",
  "hiring",
  "website_visit",
  "product_launch",
  "linkedin_post_keyword",
  "fast_growth",
] as const;
export type SignalType = typeof SIGNAL_TYPES[number];

/** Types with no ingestion yet: shown greyed as "Coming soon", never selectable. */
export const COMING_SOON_TYPES: readonly SignalType[] = ["linkedin_post_keyword", "fast_growth"];

/** Internal key → the key clients see. Only positive_response differs. */
export const PUBLIC_TYPE_KEY: Readonly<Record<SignalType, string>> = {
  positive_response: "high_intent",
  fda_clearance: "fda_clearance",
  hiring: "hiring",
  website_visit: "website_visit",
  product_launch: "product_launch",
  linkedin_post_keyword: "linkedin_post_keyword",
  fast_growth: "fast_growth",
};

export const PUBLIC_TYPE_LABEL: Readonly<Record<SignalType, string>> = {
  positive_response: "High Intent",
  fda_clearance: "FDA clearance",
  hiring: "Hiring",
  website_visit: "Website visit",
  product_launch: "Product launch",
  linkedin_post_keyword: "LinkedIn posts (coming soon)",
  fast_growth: "Fast growth (coming soon)",
};

export const MARKETS = ["private_equity", "medical_device", "saas", "recruiting", "other"] as const;
export type Market = typeof MARKETS[number];

export const MARKET_LABEL: Readonly<Record<Market, string>> = {
  private_equity: "Private Equity",
  medical_device: "Medical Device",
  saas: "SaaS",
  recruiting: "Recruiting",
  other: "Other",
};

export function isMarket(v: unknown): v is Market {
  return typeof v === "string" && (MARKETS as readonly string[]).includes(v);
}

/** The public key for an internal type; unknown keys pass through unchanged. */
export function publicTypeKey(internal: string): string {
  return (PUBLIC_TYPE_KEY as Record<string, string>)[internal] ?? internal;
}

/** A public OR internal key → the internal key; null when it is not a live type. */
export function internalTypeKey(key: string): SignalType | null {
  const k = String(key ?? "").trim().toLowerCase();
  const hit = SIGNAL_TYPES.find((t) => t === k || PUBLIC_TYPE_KEY[t] === k);
  return hit ?? null;
}

/**
 * Client-facing High Intent title: "High intent: <Name>, <Title> at <Company>".
 * Built from who/where only — never from the reply, the campaign or the platform.
 */
export function highIntentTitle(p: { name?: string | null; title?: string | null; company?: string | null }): string {
  const who = [p.name, p.title].map((s) => (s ?? "").trim()).filter(Boolean).join(", ");
  const company = (p.company ?? "").trim();
  const body = who ? `${who}${company ? ` at ${company}` : ""}` : company || "Unnamed contact";
  return `High intent: ${body}`.slice(0, 500);
}
