// Minimal lead shape needed by the guard (kept local to avoid test-time deps)
export type InboxGuardLead = {
  channel: 'email' | 'linkedin';
  source?: 'heyreach' | 'smartlead' | 'reply_io' | string | null;
  intent?: string | null;
  draft_response?: string | null;
};

export function isHeyreachDraftingEnabled(envOverride?: string | boolean): boolean {
  if (typeof envOverride === 'boolean') return envOverride;
  if (typeof envOverride === 'string') return envOverride.trim().toLowerCase() === 'true';
  const meta = import.meta as unknown as { env?: Record<string, unknown> };
  const raw = meta?.env?.VITE_HEYREACH_DRAFTING_ENABLED as string | undefined;
  return String(raw ?? '').trim().toLowerCase() === 'true';
}

export function shouldAutoClassifyOnLeadSelect(
  lead: InboxGuardLead,
  opts?: { heyreachDraftingEnabled?: boolean | string },
): boolean {
  const enabled = typeof opts?.heyreachDraftingEnabled !== 'undefined'
    ? isHeyreachDraftingEnabled(opts.heyreachDraftingEnabled)
    : isHeyreachDraftingEnabled();
  const isHeyreachOrLinkedIn = lead.channel === 'linkedin' || lead.source === 'heyreach';
  if (isHeyreachOrLinkedIn && !enabled) return false;
  return !lead.intent && !lead.draft_response;
}

