// Shared feature flags for Supabase Edge Functions
// NOTE: Default OFF — enabling must be an explicit opt-in via env.
//
// Keep the flag name stable across functions. Frontend uses
// VITE_HEYREACH_DRAFTING_ENABLED; the server reads HEYREACH_DRAFTING_ENABLED.
// Both default to OFF when unset.
export const HEYREACH_DRAFTING_ENABLED: boolean =
  ((Deno.env.get('HEYREACH_DRAFTING_ENABLED') ?? '').trim().toLowerCase() === 'true');

// Helper used by classify-reply (and testable in isolation).
export function shouldSuppressHeyreachDrafting(channel: string | null | undefined, source: string | null | undefined): boolean {
  const isLinkedInOrHeyreach = (channel === 'linkedin') || (source === 'heyreach');
  // Re-read env at call-time so tests can toggle between ON/OFF within one process.
  const enabledNow = ((Deno.env.get('HEYREACH_DRAFTING_ENABLED') ?? '').trim().toLowerCase() === 'true');
  return isLinkedInOrHeyreach && !enabledNow;
}

