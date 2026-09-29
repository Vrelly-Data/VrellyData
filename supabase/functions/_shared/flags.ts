// Shared feature flags for Supabase Edge Functions
// NOTE: Default OFF — enabling must be an explicit opt-in via env.
//
// Keep the flag name stable across functions. Frontend uses
// VITE_HEYREACH_DRAFTING_ENABLED; the server reads HEYREACH_DRAFTING_ENABLED.
// Both default to OFF when unset.

// HeyReach drafting kill switch. Keyed on the lead's STORED source only:
// channel does not matter, so Reply.io LinkedIn-step leads (channel 'linkedin',
// source 'reply_io') keep drafting/auto-send exactly as before.
export function shouldSuppressHeyreachDrafting(source: string | null | undefined): boolean {
  // Re-read env at call-time so tests can toggle between ON/OFF within one process.
  const enabledNow = ((Deno.env.get('HEYREACH_DRAFTING_ENABLED') ?? '').trim().toLowerCase() === 'true');
  return source === 'heyreach' && !enabledNow;
}
