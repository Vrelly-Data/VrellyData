// Normalizes a stored contact LinkedIn URL into something safe to put in an
// href. agent_leads.linkedin_url is written by several different ingestion
// paths (HeyReach, Smartlead, Reply.io webhooks + syncs), so the column is not
// guaranteed to hold a well-formed absolute URL.
//
// Measured against prod: of 2,288 non-empty values, 2,287 are absolute https
// and exactly one is `ttps://www.linkedin.com/in/…` — a truncated scheme. That
// row is why this anchors on the host instead of just prepending a scheme when
// one is missing: `https://` + `ttps://www.linkedin.com/…` is a guaranteed 404.
//
// Returns null for anything unusable, so callers can render nothing rather
// than a dead link.
export function normalizeLinkedInUrl(raw: string | null | undefined): string | null {
  const value = (raw ?? '').trim();
  if (!value) return null;

  // Anchor on the linkedin.com host wherever it appears, keeping any subdomain
  // sitting directly in front of it (www., de., uk., …) and discarding
  // whatever preceded it — which repairs a damaged or missing scheme.
  const hostAt = value.toLowerCase().indexOf('linkedin.com/');
  if (hostAt !== -1) {
    const subdomain = value.slice(0, hostAt).match(/(?:[a-z0-9-]+\.)*$/i)?.[0] ?? '';
    return `https://${subdomain}${value.slice(hostAt)}`;
  }

  // Not a linkedin.com URL. Pass through anything already absolute…
  if (/^https?:\/\//i.test(value)) return value;
  // …refuse any other scheme outright (javascript:, data:, mailto: — never a
  // profile link, and unsafe in an href)…
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return null;
  // …and treat the rest as a scheme-less host/path.
  return `https://${value.replace(/^\/+/, '')}`;
}
