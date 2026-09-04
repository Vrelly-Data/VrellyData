// Read-through cache over Apollo's people/bulk_match, backed by
// apollo_enrichment_cache. See that table's migration for why it exists and why
// it is scoped per user.
//
// THE ONE INVARIANT THIS MODULE PROTECTS: a cache fault must never turn into a
// charge the caller did not ask for, and must never turn into silence. Every
// function here fails OPEN — a read error yields "nothing cached" (so we buy the
// data, which is correct but costs money) and a write error is logged and
// swallowed (so the data we just paid for is still returned). Both are loud in
// the logs, because a cache that has quietly stopped working looks exactly like
// a cache that is working: the feature still returns the right people, it just
// bills for them every single time.
//
// This lives apart from _shared/apollo.ts on purpose. That module is pure
// mapping over Apollo's wire format and imports nothing; this one needs a
// Supabase client, and keeping the dependency out of the mapper is what lets
// the mapper be reasoned about (and tested) without a database.

import { ENRICH_CACHE_TTL_DAYS, type ApolloEnrichedPerson } from "./apollo.ts";
import type { ApolloKeySource } from "./apollo-key.ts";

export interface CacheHit {
  person: ApolloEnrichedPerson;
  fetchedAt: string;
  keySource: ApolloKeySource;
}

/**
 * Fetch the still-fresh cached records for these ids.
 *
 * Returns a Map keyed by apollo_person_id, holding ONLY rows inside the TTL.
 * An expired row is treated as absent here and overwritten by the writer below,
 * so expiry needs no separate sweep to be correct — the prune is a
 * housekeeping concern, not a correctness one.
 */
export async function readEnrichmentCache(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  userId: string,
  ids: string[],
): Promise<Map<string, CacheHit>> {
  const out = new Map<string, CacheHit>();
  if (ids.length === 0) return out;

  const freshAfter = new Date(Date.now() - ENRICH_CACHE_TTL_DAYS * 86_400_000).toISOString();

  try {
    const { data, error } = await supabase
      .from("apollo_enrichment_cache")
      .select("apollo_person_id, person, fetched_at, key_source")
      .eq("user_id", userId)
      .in("apollo_person_id", ids)
      .gte("fetched_at", freshAfter);

    if (error) {
      // Fail open: we will buy these again. Costly, but correct — and this line
      // is the only warning anyone gets that the cache has stopped saving money.
      console.error(`[apollo-cache] read failed, treating all as uncached: ${error.message}`);
      return out;
    }

    for (const row of data ?? []) {
      // A row whose payload is not a usable person is worse than no row: it
      // would be handed to the push path as though it were enriched data.
      // Skip it and let the fetch replace it.
      const person = row?.person as ApolloEnrichedPerson | null;
      if (!person || typeof person !== "object" || !person.apollo_person_id) {
        console.warn(`[apollo-cache] discarding malformed cache row for ${row?.apollo_person_id}`);
        continue;
      }
      out.set(String(row.apollo_person_id), {
        person,
        fetchedAt: String(row.fetched_at),
        keySource: row.key_source === "client" ? "client" : "shared",
      });
    }
  } catch (e) {
    console.error("[apollo-cache] read threw, treating all as uncached:", e);
  }

  return out;
}

/**
 * Store freshly-purchased records.
 *
 * ONLY CALL THIS WITH RECORDS APOLLO ACTUALLY MATCHED. Ids that came back in
 * missing_records are deliberately not cached: a miss costs 0 credits, so
 * caching it saves nothing, and it would pin a person as permanently
 * un-enrichable when Apollo's database is the thing that changes. The only
 * effect would be to hide someone who later became reachable.
 *
 * A record that matched but has no email IS cached — that is a real, paid-for
 * answer ("Apollo knows this person and has no work email for them"), and
 * re-asking costs another call to learn the same thing.
 */
export async function writeEnrichmentCache(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  userId: string,
  keySource: ApolloKeySource,
  people: ApolloEnrichedPerson[],
): Promise<void> {
  if (people.length === 0) return;

  const now = new Date().toISOString();
  const rows = people.map((p) => ({
    user_id: userId,
    apollo_person_id: p.apollo_person_id,
    key_source: keySource,
    person: p,
    email: p.email,
    fetched_at: now,
  }));

  try {
    // onConflict on the (user_id, apollo_person_id) unique index: re-buying a
    // person after TTL expiry replaces the old payload rather than erroring.
    //
    // refresh_count is left out of the payload ON PURPOSE. Including it would
    // mean sending a literal — and a literal would reset the counter to that
    // value on every conflicting upsert, which is the same
    // write-a-null-over-real-data shape that erased 17,723 synced_contacts rows.
    // Omitted, the column keeps whatever it holds; the trigger below increments
    // it. A first insert takes the DEFAULT 0, which is right: paying once is not
    // a refresh.
    const { error } = await supabase
      .from("apollo_enrichment_cache")
      .upsert(rows, { onConflict: "user_id,apollo_person_id" });

    if (error) {
      // Swallowed deliberately. The caller already has the people and has
      // already been charged; throwing here would discard purchased data over a
      // bookkeeping failure. The cost of this failure is a future re-charge.
      console.error(`[apollo-cache] write failed for ${rows.length} record(s): ${error.message}`);
      return;
    }
    console.log(`[apollo-cache] cached ${rows.length} record(s) for user=${userId}`);
  } catch (e) {
    console.error("[apollo-cache] write threw:", e);
  }
}
