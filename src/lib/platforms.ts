/**
 * Canonical platform / source vocabularies.
 *
 * These are TWO DIFFERENT NAMESPACES and they are not interchangeable. Mixing
 * them is silent: a mismatched filter returns an empty set rather than an
 * error, so the UI renders zeros and nothing is logged.
 *
 *   PLATFORM — the value stored in outbound_integrations.platform.
 *              Reply.io is 'reply.io', WITH A PERIOD.
 *              Written by AddIntegrationDialog; read by validate-api-key,
 *              campaign-preflight, auto-sync-integrations, send-agent-reply,
 *              poll-reply-inbox and generate-client-analysis.
 *
 *   SOURCE   — the value stored in synced_campaigns.source and
 *              agent_leads.source. Reply.io is 'reply_io', WITH AN UNDERSCORE.
 *              Hardcoded by every sync/poll/webhook writer (see the "DO NOT
 *              remove" note in fetch-available-campaigns).
 *
 * Both spellings are correct — for their own column. Verified against prod:
 * 11/11 integrations use 'reply.io' and 317/317 campaigns use 'reply_io', with
 * zero exceptions in either direction. Do NOT "normalize" one into the other,
 * and do NOT add tolerant matching that accepts both — a filter that accepts
 * every spelling can no longer detect a genuine mismatch.
 *
 * Two neighbouring vocabularies that are NOT drift and must be left alone:
 *   - 'reply_io_linkedin' / 'reply_io_email' are a CHART-LAYER namespace built
 *     in DataAnalysisTab and PublicClientReport to split Reply.io by channel.
 *     They never appear in the database.
 *   - useOutboundIntegrations also accepts a legacy 'replyio' spelling. It
 *     occurs zero times in prod and dev today, but it is defensive, not drift.
 *
 * Real incident this prevents: AgentSettings/AgentOnboarding sent
 * platform:'reply_io' to validate-api-key, which tests === 'reply.io'. Valid
 * keys reported as invalid, so an operator deleted and re-added the
 * integration, which tripped ON DELETE SET NULL on
 * client_analysis.reply_io_integration_id and zeroed that client's stats.
 */

export const PLATFORM = {
  REPLY_IO: 'reply.io',
  SMARTLEAD: 'smartlead',
  HEYREACH: 'heyreach',
  APOLLO: 'apollo',
} as const;

export type Platform = (typeof PLATFORM)[keyof typeof PLATFORM];

export const SOURCE = {
  REPLY_IO: 'reply_io',
  SMARTLEAD: 'smartlead',
  HEYREACH: 'heyreach',
} as const;

export type Source = (typeof SOURCE)[keyof typeof SOURCE];

/** Map an integration's platform to the source value its synced rows carry. */
export const PLATFORM_TO_SOURCE: Record<Platform, Source | undefined> = {
  [PLATFORM.REPLY_IO]: SOURCE.REPLY_IO,
  [PLATFORM.SMARTLEAD]: SOURCE.SMARTLEAD,
  [PLATFORM.HEYREACH]: SOURCE.HEYREACH,
  [PLATFORM.APOLLO]: undefined,
};
