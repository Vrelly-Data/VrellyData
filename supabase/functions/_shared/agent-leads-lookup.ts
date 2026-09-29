// Shared helper to find an existing agent_leads row by a normalized LinkedIn URL.
// This avoids relying on PostgREST ON CONFLICT with a partial index.
//
// Strategy:
// 1) Try exact match on the stored value (fast path)
// 2) Fallback: scan a bounded slice of this user's rows whose linkedin_url looks
//    like a LinkedIn URL, normalize each, and compare to the normalized key.
//
// Normalization for comparison reuses lead-dedup's normalizeLinkedInUrl so the
// equality logic is identical across ingestion paths.
//
// The result includes the fields needed by ingestion gates (disposition_tag and
// last_surfaced_reply_at) and display writes. Callers can SELECT more if needed.
import { normalizeLinkedInUrl } from "./lead-dedup.ts";

export type AgentLeadBasic = {
  id: string;
  linkedin_url: string | null;
  disposition_tag: string | null;
  last_surfaced_reply_at: string | null;
  last_reply_at?: string | null;
};

// deno-lint-ignore no-explicit-any
export async function findLeadByNormalizedLinkedIn(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  userId: string,
  rawLinkedInUrl: string | null | undefined,
): Promise<AgentLeadBasic | null> {
  const normalized = normalizeLinkedInUrl(rawLinkedInUrl);
  if (!normalized) return null;

  // 1) Exact match fast path
  {
    const { data, error } = await supabase
      .from("agent_leads")
      .select("id, linkedin_url, disposition_tag, last_surfaced_reply_at, last_reply_at")
      .eq("user_id", userId)
      .eq("linkedin_url", rawLinkedInUrl)
      .maybeSingle();
    if (!error && data) return data as AgentLeadBasic;
  }

  // 2) Fallback normalized match across likely LinkedIn rows (bounded scan)
  {
    const { data } = await supabase
      .from("agent_leads")
      .select("id, linkedin_url, disposition_tag, last_surfaced_reply_at, last_reply_at")
      .eq("user_id", userId)
      .ilike("linkedin_url", "%linkedin.com%")
      .limit(500); // safety bound
    const rows = (data ?? []) as AgentLeadBasic[];
    for (const r of rows) {
      if (normalizeLinkedInUrl(r.linkedin_url) === normalized) {
        return r;
      }
    }
  }

  return null;
}

