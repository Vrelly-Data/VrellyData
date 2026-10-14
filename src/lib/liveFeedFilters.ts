// Live Feed filters (Admin → Inference → Live Feed): what each filter means and how it is kept in
// the URL. Pure — no imports — so test_live_feed_filters.mjs can run it under Deno.
//
// Team, channel and dates are applied in the query. Platform and reply category are applied to the
// merged cards (a reply's intent lives on its 'classified' row, and the platform on the reply row).

export type Platform = 'reply_io' | 'smartlead' | 'heyreach';
export const PLATFORMS: Platform[] = ['reply_io', 'smartlead', 'heyreach'];
export const PLATFORM_LABELS: Record<Platform, string> = { reply_io: 'Reply.io', smartlead: 'Smartlead', heyreach: 'HeyReach' };

export type Category = 'interested' | 'neutral' | 'not_interested' | 'out_of_office' | 'bounce';
export const CATEGORIES: Category[] = ['interested', 'neutral', 'not_interested', 'out_of_office', 'bounce'];
export const CATEGORY_LABELS: Record<Category, string> = {
  interested: 'Interested',
  neutral: 'Neutral',
  not_interested: 'Not interested',
  out_of_office: 'Out of office',
  bounce: 'Bounce',
};
/** "Not interested" is never the first thing shown. */
export const DEFAULT_CATEGORIES: Category[] = ['interested', 'neutral'];

export type Channel = 'email' | 'linkedin';

export interface LiveFeedFilters {
  team: string | null;
  platforms: Platform[]; // empty = all
  categories: Category[]; // empty = all
  channel: Channel | null;
  from: string | null; // YYYY-MM-DD, local
  to: string | null; // YYYY-MM-DD, local, inclusive
}

/** Which platform a reply came from: metadata.provider, else the writer. null = unknown (e.g. a classification alone). */
export function platformOfEvent(source: string | null | undefined, metadata?: Record<string, unknown> | null): Platform | null {
  const p = typeof metadata?.provider === 'string' ? metadata.provider : null;
  if (p === 'reply_io' || p === 'smartlead' || p === 'heyreach') return p;
  if (source === 'poll_reply_inbox' || source === 'reply_webhook') return 'reply_io';
  if (source === 'smartlead_webhook') return 'smartlead';
  if (source === 'heyreach_webhook') return 'heyreach';
  return null;
}

/**
 * The classifier's intents → the feed's categories. Neutral = needs more info, referral, unknown,
 * and replies not classified yet (so new replies show up straight away).
 */
export function categoryOf(intent: string | null | undefined): Category {
  switch (intent) {
    case 'interested':
      return 'interested';
    case 'not_interested':
      return 'not_interested';
    case 'out_of_office':
      return 'out_of_office';
    case 'bounce':
      return 'bounce';
    default:
      return 'neutral';
  }
}

const KEYS = { team: 'lf_team', platform: 'lf_platform', category: 'lf_cat', channel: 'lf_channel', from: 'lf_from', to: 'lf_to' };
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function list<T extends string>(raw: string | null, allowed: readonly T[]): T[] {
  if (!raw) return [];
  return [...new Set(raw.split(',').map((s) => s.trim()).filter((s): s is T => (allowed as readonly string[]).includes(s)))];
}

export function filtersFromParams(params: URLSearchParams): LiveFeedFilters {
  const cat = params.get(KEYS.category);
  const channel = params.get(KEYS.channel);
  const from = params.get(KEYS.from);
  const to = params.get(KEYS.to);
  return {
    team: params.get(KEYS.team) || null,
    platforms: list(params.get(KEYS.platform), PLATFORMS),
    // absent → the default; 'all' → every category
    categories: cat === null ? [...DEFAULT_CATEGORIES] : cat === 'all' ? [] : list(cat, CATEGORIES),
    channel: channel === 'email' || channel === 'linkedin' ? channel : null,
    from: from && DATE.test(from) ? from : null,
    to: to && DATE.test(to) ? to : null,
  };
}

/** Writes the filters into a copy of `params`, leaving every other parameter alone. */
export function filtersToParams(f: LiveFeedFilters, params: URLSearchParams): URLSearchParams {
  const out = new URLSearchParams(params);
  const put = (k: string, v: string | null) => (v ? out.set(k, v) : out.delete(k));
  put(KEYS.team, f.team);
  put(KEYS.platform, f.platforms.length ? f.platforms.join(',') : null);
  const isDefault =
    f.categories.length === DEFAULT_CATEGORIES.length && DEFAULT_CATEGORIES.every((c) => f.categories.includes(c));
  put(KEYS.category, isDefault ? null : f.categories.length ? f.categories.join(',') : 'all');
  put(KEYS.channel, f.channel);
  put(KEYS.from, f.from);
  put(KEYS.to, f.to);
  return out;
}

/** Local-midnight bounds for the query: [from 00:00, the day after `to` 00:00). */
export function dateBounds(f: Pick<LiveFeedFilters, 'from' | 'to'>): { gte: string | null; lt: string | null } {
  const at = (ymd: string, addDays = 0) => {
    const [y, m, d] = ymd.split('-').map(Number);
    return new Date(y, m - 1, d + addDays).toISOString();
  };
  return { gte: f.from ? at(f.from) : null, lt: f.to ? at(f.to, 1) : null };
}

export function cardMatches(card: { platform: Platform | null; intent: string | null }, f: LiveFeedFilters): boolean {
  if (f.platforms.length && (!card.platform || !f.platforms.includes(card.platform))) return false;
  if (f.categories.length && !f.categories.includes(categoryOf(card.intent))) return false;
  return true;
}

/** Card-level filters thin the result, so the query fetches a wider window. */
export function hasCardFilters(f: LiveFeedFilters): boolean {
  return f.platforms.length > 0 || f.categories.length > 0;
}
