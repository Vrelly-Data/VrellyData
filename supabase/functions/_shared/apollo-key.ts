// Single lookup point for the Apollo API key.
//
// WHY THIS EXISTS AS ITS OWN MODULE. Every Apollo caller asks this one function
// which key to use, so changing the answer is a one-file change. That already
// paid off once: Stage 2 shipped with a shared-secret-only body and Stage 2.5
// added the per-client branch below without touching a single call site.
//
// RESOLUTION ORDER (Stage 2.5 onwards): the client's own key first, the shared
// APOLLO_API_KEY secret as fallback. A client with no Apollo row is the normal
// case, so the lookup uses maybeSingle() and a miss is not an error.
//
// Keys live in outbound_integrations.api_key_encrypted (plaintext, despite the
// column name), scoped by created_by + platform='apollo' — the same shape the
// Reply.io / Smartlead / HeyReach integrations use. Adding an 'apollo' row is
// safe for the existing sync loops: auto-sync-integrations filters on
// platform='reply.io' and each poller filters to its own platform, so none of
// them will pick it up.
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
 *
 * Throws ApolloKeyMissingError rather than returning null: every caller needs a
 * key to do anything, and an explicit throw keeps the failure legible in logs
 * instead of surfacing later as a confusing 401 from Apollo.
 */
export async function getApolloKeyForUser(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  userId: string,
): Promise<ApolloKey> {
  // ---- 1. the client's own key, if they have added one --------------------
  // Scoped by created_by, matching how poll-heyreach-inbox / poll-smartlead-inbox
  // resolve their integrations. maybeSingle() rather than single(): a client
  // with no Apollo row is the normal case, not an error.
  //
  // A lookup failure is deliberately NOT fatal — if the query errors we fall
  // through to the shared key rather than blocking the client entirely, and log
  // loudly so the degradation is visible.
  try {
    const { data, error } = await supabase
      .from("outbound_integrations")
      .select("api_key_encrypted")
      .eq("created_by", userId)
      .eq("platform", "apollo")
      .eq("is_active", true)
      .maybeSingle();

    if (error) {
      console.error(
        `[apollo-key] per-client lookup failed for ${userId}, falling back to shared: ${error.message}`,
      );
    } else if (data?.api_key_encrypted && String(data.api_key_encrypted).trim()) {
      return { key: String(data.api_key_encrypted).trim(), source: "client" };
    }
  } catch (e) {
    console.error(`[apollo-key] per-client lookup threw for ${userId}, falling back to shared:`, e);
  }

  // ---- 2. the shared key -------------------------------------------------
  const shared = Deno.env.get("APOLLO_API_KEY");
  if (shared && shared.trim()) {
    return { key: shared.trim(), source: "shared" };
  }

  throw new ApolloKeyMissingError(userId);
}
