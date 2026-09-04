/**
 * Audience data sources — the adapter contract.
 *
 * STAGE 1: this file is the whole abstraction, and Apollo is its only working
 * implementation. Nothing here changes what the Apollo path does; it describes
 * what Apollo already does, in terms general enough that a second source can be
 * added without editing the Apollo code. That ordering is deliberate — the
 * Apollo pipeline (search -> reveal -> cache -> push) was verified end to end
 * against live data and real credits, and a refactor is the one thing that
 * could quietly break it.
 *
 * THE SEAM ALREADY EXISTED. run-agent-audience calls apollo-search over HTTP as
 * a black box, and the preview dialog goes through a single hook. So a source
 * is fully described by "which endpoint answers a search" plus a few facts
 * about what that endpoint costs and returns. That is all this file encodes.
 *
 * WHAT IS NOT HERE. No filter translation and no neutral filter model. An
 * audience stores its filters in its own source's vocabulary (see the
 * agent_audiences.source migration for why), so translation belongs to whoever
 * builds the request, not to this registry.
 */

/** Persisted in agent_audiences.source; mirrored by that column's CHECK. */
export type AudienceSourceId = 'apollo' | 'vrelly' | 'clay' | 'ai';

/**
 * How a source is actually reached.
 *
 * `definer-rpc` is not a stylistic preference. Direct PostgREST reads of
 * public.prospects time out on prod even at limit=1 — RLS on that table is
 * expensive to evaluate — while the SECURITY DEFINER search functions bypass
 * RLS and return promptly. Measured 2026-08-31; see
 * docs/SEARCH_PROSPECTS_REFERENCE.md. Any Vrelly implementation that reaches
 * for `supabase.from('prospects')` will appear to work on dev's 30 synthetic
 * rows and fail on prod, which is the worst possible way to find out.
 */
export type SourceTransport =
  | { kind: 'edge-function'; search: string; reveal: string }
  | { kind: 'definer-rpc'; results: string; count: string };

/** A filter the UI can render but this source cannot usefully answer. */
export interface UnsupportedFilter {
  /** Filter id as the UI knows it. */
  key: string;
  label: string;
  /** Shown to the operator. Say why, with the number. */
  reason: string;
}

export interface AudienceSource {
  id: AudienceSourceId;
  label: string;
  /** One line, shown under the source selector. */
  description: string;
  /** False renders the option greyed out and unselectable. */
  available: boolean;
  /** Required when available is false — the UI shows it as the tooltip. */
  unavailableReason?: string;
  /**
   * Whether contact data is withheld until paid for.
   *
   * Apollo's api_search returns no email and masks surnames, so a Reveal step
   * exists to buy them. Vrelly's prospects rows already carry business_email
   * (85.4% coverage, measured 2026-08-31), so there is nothing to unlock and
   * the Reveal UI must be hidden entirely for it — offering a button that
   * spends nothing and reveals nothing is worse than offering none.
   */
  requiresReveal: boolean;
  /** Whether using this source can draw down a paid balance. */
  costsCredits: boolean;
  transport: SourceTransport | null;
  /**
   * Filters to hide or mark unavailable when this source is selected.
   *
   * A filter backed by 2% of rows is not a filter, it is a way to make the
   * product look broken: the operator applies it, gets almost nothing back,
   * and concludes the search is failing rather than that the column is empty.
   */
  unsupportedFilters: readonly UnsupportedFilter[];
}

/**
 * Sources that do not exist yet are listed deliberately.
 *
 * Declaring them costs nothing and makes the shape of each one explicit before
 * anybody builds it — particularly that Vrelly is free and needs no Reveal,
 * which is the fact most likely to be got wrong by analogy with Apollo.
 */
export const AUDIENCE_SOURCES: Readonly<Record<AudienceSourceId, AudienceSource>> = {
  apollo: {
    id: 'apollo',
    label: 'Apollo',
    description: 'Live B2B database. Search is free; revealing contact data spends credits.',
    available: true,
    requiresReveal: true,
    costsCredits: true,
    transport: { kind: 'edge-function', search: 'apollo-search', reveal: 'apollo-enrich' },
    unsupportedFilters: [],
  },

  vrelly: {
    id: 'vrelly',
    label: 'Vrelly',
    description: 'Our own prospect database. Free to search and use — no credits, no reveal step.',
    available: false,
    unavailableReason: 'Not wired up yet (Stage 3).',
    requiresReveal: false,
    costsCredits: false,
    // See SourceTransport: the table itself is unreadable through PostgREST at
    // prod scale. These two are SECURITY DEFINER and are the only supported way in.
    transport: { kind: 'definer-rpc', results: 'search_prospects_results', count: 'search_prospects_count' },
    // Coverage measured against prod 2026-08-31 over a 1,000-row sample.
    unsupportedFilters: [
      { key: 'technologies', label: 'Technologies', reason: 'Only 2% of Vrelly records have technology data.' },
      { key: 'keywords', label: 'Keywords', reason: 'Only 2% of Vrelly records have keyword data.' },
      { key: 'interests', label: 'Interests', reason: 'Only 7% of Vrelly records have interest data.' },
    ],
  },

  clay: {
    id: 'clay',
    label: 'Clay',
    description: 'Clay-sourced audiences.',
    available: false,
    unavailableReason: 'Coming soon.',
    requiresReveal: true,
    costsCredits: true,
    transport: null,
    unsupportedFilters: [],
  },

  ai: {
    id: 'ai',
    label: 'AI Search',
    description: 'Describe an audience in plain language and let Claude build the filters.',
    available: false,
    unavailableReason: 'Coming soon.',
    requiresReveal: true,
    costsCredits: true,
    transport: null,
    unsupportedFilters: [],
  },
};

/** Every audience predating the source column is Apollo. */
export const DEFAULT_SOURCE: AudienceSourceId = 'apollo';

export const SOURCE_ORDER: readonly AudienceSourceId[] = ['vrelly', 'apollo', 'clay', 'ai'];

/**
 * Resolve a stored value to a source.
 *
 * Falls back to Apollo for null/unknown, because a row written before the
 * source column existed is an Apollo row and must keep working. This is the
 * only place that fallback is allowed — see resolveTransport for why guessing
 * anywhere else is dangerous.
 */
export function getAudienceSource(id: string | null | undefined): AudienceSource {
  return AUDIENCE_SOURCES[(id ?? DEFAULT_SOURCE) as AudienceSourceId] ?? AUDIENCE_SOURCES[DEFAULT_SOURCE];
}

/**
 * The endpoints for a source, or a thrown error.
 *
 * THROWS rather than falling back to Apollo, and that is the point. A silent
 * fallback here would mean selecting Clay quietly runs an Apollo search — which
 * spends real money from a different balance and returns people the operator
 * never asked for. A source with no transport is a bug to surface, not a
 * condition to paper over.
 */
export function resolveTransport(source: AudienceSource): SourceTransport {
  if (!source.transport) {
    throw new Error(`The ${source.label} source is not available yet.`);
  }
  return source.transport;
}

/** Endpoints for an edge-function-backed source, narrowed. */
export function resolveEdgeFunctions(source: AudienceSource): { search: string; reveal: string } {
  const t = resolveTransport(source);
  if (t.kind !== 'edge-function') {
    throw new Error(`The ${source.label} source is not reached through an edge function.`);
  }
  return { search: t.search, reveal: t.reveal };
}

/** Is this filter meaningful for this source? Drives hiding/labelling in the UI. */
export function isFilterSupported(source: AudienceSource, filterKey: string): boolean {
  return !source.unsupportedFilters.some((f) => f.key === filterKey);
}
