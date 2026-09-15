// Thin wrapper utilities for writing agent_leads with graceful recovery paths.
// These are purposely light abstractions around supabase-js for unit testing.

export interface SupabaseClientLike {
  // deno-lint-ignore no-explicit-any
  from(table: string): any;
}

export interface UpsertResult<T> {
  data: T | null;
  error: { code?: string; message?: string; details?: string } | null;
}

/**
 * Upsert into agent_leads with a recovery for 23505 collisions on the
 * (user_id, linkedin_url) unique index. This handles placeholder/invalid
 * linkedin_url values that would otherwise conflict (e.g. empty string/"0").
 *
 * Strategy:
 * 1) Attempt the upsert using the supplied row
 * 2) If it fails with code 23505 on agent_leads_user_linkedin_unique,
 *    retry once with linkedin_url forcibly null
 */
export async function upsertAgentLeadWithLinkedinRecovery<T extends { id?: string }>(
  supabase: SupabaseClientLike,
  leadRow: Record<string, unknown>,
  conflictTarget = "user_id,email_address",
): Promise<UpsertResult<T>> {
  // deno-lint-ignore no-explicit-any
  const table = (supabase as any).from("agent_leads");
  // Helper to run the upsert with a particular row payload
  const doUpsert = async (row: Record<string, unknown>) => {
    // deno-lint-ignore no-explicit-any
    const res: any = await table.upsert(row, { onConflict: conflictTarget }).select("id").single();
    return res as UpsertResult<T>;
  };

  const first = await doUpsert(leadRow);
  if (!first.error) return first;

  const err = first.error || {};
  const isUnique = err.code === "23505";
  const mentionsLiUnique =
    /agent_leads_user_linkedin_unique/i.test(err.message || "") ||
    /agent_leads_user_linkedin_unique/i.test(err.details || "");

  if (isUnique && mentionsLiUnique) {
    const retryRow = { ...leadRow, linkedin_url: null };
    const second = await doUpsert(retryRow);
    return second;
  }

  return first;
}

