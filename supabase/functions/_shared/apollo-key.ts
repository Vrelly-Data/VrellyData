// Single lookup point for the Apollo API key.
//
// WHY THIS EXISTS AS ITS OWN MODULE. Today every caller uses one shared key —
// the APOLLO_API_KEY Supabase secret. Stage 2.5 will let each client add their
// own key via Settings → Integrations, exactly like Reply.io / Smartlead /
// HeyReach do, at which point the resolution order becomes "client's own key
// first, shared key as fallback". Isolating that decision here means the switch
// is a change to ONE function rather than an edit to every Apollo caller.
//
// WHAT STAGE 2.5 CHANGES. Only the marked block below. The existing
// integrations all store their key in outbound_integrations.api_key_encrypted
// (plaintext, despite the column name) and are looked up by platform +
// created_by, so the 2.5 body is:
//
//     const { data } = await supabase
//       .from('outbound_integrations')
//       .select('api_key_encrypted')
//       .eq('created_by', userId)
//       .eq('platform', 'apollo')
//       .eq('is_active', true)
//       .maybeSingle();
//     if (data?.api_key_encrypted) return { key: data.api_key_encrypted, source: 'client' };
//
// ...placed before the shared-secret fallback. Note that 2.5 also needs a
// `validate-apollo-key` edge function and a PLATFORM_VALIDATORS entry in
// AddIntegrationDialog.tsx — validate-api-key deliberately REJECTS platforms
// with no configured validator, so an 'apollo' row cannot be created until that
// exists.
//
// WHY `source` IS RETURNED. Your key and a client's key draw down DIFFERENT
// Apollo credit balances, and Apollo's rate limit is per-account. A run that
// records credits_spent without recording whose account paid is not auditable.
// Callers log this today so 2.5 needs no further call-site changes.

export type ApolloKeySource = "client" | "shared";

export interface ApolloKey {
  key: string;
  source: ApolloKeySource;
}

export class ApolloKeyMissingError extends Error {
  constructor(userId: string) {
    super(
      `No Apollo API key available for user ${userId}: no per-client key and the ` +
        `APOLLO_API_KEY secret is not set on this project.`,
    );
    this.name = "ApolloKeyMissingError";
  }
}

/**
 * Resolve the Apollo key to use on behalf of `userId`.
 *
 * `supabase` is accepted (and currently unused) so Stage 2.5 can add the
 * per-client lookup without changing this signature or any call site.
 *
 * Throws ApolloKeyMissingError rather than returning null: every caller needs a
 * key to do anything, and an explicit throw keeps the failure legible in logs
 * instead of surfacing later as a confusing 401 from Apollo.
 */
export async function getApolloKeyForUser(
  // deno-lint-ignore no-explicit-any
  _supabase: any,
  userId: string,
): Promise<ApolloKey> {
  // ---- STAGE 2.5 INSERTS THE PER-CLIENT LOOKUP HERE ------------------------
  // (see the header for the exact block; nothing else in this file changes)
  // -------------------------------------------------------------------------

  const shared = Deno.env.get("APOLLO_API_KEY");
  if (shared && shared.trim()) {
    return { key: shared.trim(), source: "shared" };
  }

  throw new ApolloKeyMissingError(userId);
}
