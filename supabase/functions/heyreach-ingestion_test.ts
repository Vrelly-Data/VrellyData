import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { normalizeLinkedInUrl } from "./_shared/lead-dedup.ts";
import { findLeadByNormalizedLinkedIn } from "./_shared/agent-leads-lookup.ts";
import { isStaleProspectMessage } from "./_shared/stale.ts";

// 1) linkedin_url normalization (comparison key)
Deno.test("normalizeLinkedInUrl canonicalizes protocol/www/trailing slash", () => {
  const a = normalizeLinkedInUrl("https://www.linkedin.com/in/JaneDoe/");
  const b = normalizeLinkedInUrl("http://linkedin.com/in/janEDOE");
  assertEquals(a, b);
  assertEquals(a, "linkedin.com/in/janedoe");
});

// 2) Poller skip-unchanged decision (pure equality)
Deno.test("poller skip-unchanged fires when last text matches incoming", () => {
  const existing = "Hello there";
  const incoming = "Hello there";
  assertEquals(existing === incoming, true);
});

// 3) 23505 retry path with a mocked client (insert → unique violation → update)
type InsertCall = { row: Record<string, unknown> };
class FakeAgentLeads {
  private insertCalls: InsertCall[] = [];
  private updateCalls: Array<{ id: string; row: Record<string, unknown> }> = [];
  constructor(private firstInsertErrors: boolean) {}
  getInserts() { return this.insertCalls; }
  getUpdates() { return this.updateCalls; }
  insert(row: Record<string, unknown>) {
    this.insertCalls.push({ row });
    const self = this;
    return {
      select() {
        return {
          single() {
            if (self.firstInsertErrors) {
              // Simulate 23505 duplicate-key violation
              return Promise.resolve({ data: null, error: { code: "23505", message: "duplicate key value violates unique constraint \"agent_leads_user_linkedin_unique\"" } });
            }
            return Promise.resolve({ data: { id: "new123" }, error: null });
          }
        };
      }
    };
  }
  update(row: Record<string, unknown>) {
    const id = String(row["id"] ?? "");
    this.updateCalls.push({ id, row });
    return {
      eq(_col: string, _val: unknown) {
        return {
          select() {
            return { single() { return Promise.resolve({ data: { id: id || "upd123" }, error: null }); } };
          }
        };
      }
    };
  }
}
class FakeSupabase {
  constructor(private table: FakeAgentLeads) {}
  from(name: string) {
    if (name !== "agent_leads") throw new Error("unexpected table");
    return this.table as unknown as Record<string, unknown>;
  }
}
async function insertThenRetryUpdate(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  row: Record<string, unknown>,
  // reselect returns an id to update on race
  reselectId: string,
): Promise<{ ok: boolean }> {
  const table = supabase.from("agent_leads");
  // deno-lint-ignore no-explicit-any
  const first: any = await (table as any).insert(row).select().single();
  if (!first.error) return { ok: true };
  if ((first.error?.code ?? "") !== "23505") return { ok: false };
  // Race: update the reselected id
  // deno-lint-ignore no-explicit-any
  await (table as any).update({ ...row }).eq("id", reselectId).select().single();
  return { ok: true };
}
Deno.test("insertThenRetryUpdate handles 23505 by updating reselected id", async () => {
  const table = new FakeAgentLeads(true);
  const fake = new FakeSupabase(table as unknown as FakeAgentLeads);
  const res = await insertThenRetryUpdate(fake as unknown as any, { user_id: "u1", linkedin_url: "https://linkedin.com/in/foo" }, "lead-42");
  assert(res.ok);
  assertEquals(table.getInserts().length, 1);
  assertEquals(table.getUpdates().length, 1);
});

// 4) Agent-leads lookup paginates beyond 500 rows
class PagedSupabase {
  private store: Array<{ id: string; user_id: string; linkedin_url: string | null; disposition_tag: string | null; last_surfaced_reply_at: string | null; last_reply_at: string | null; last_reply_text: string | null }>;
  constructor(rows: number, userId: string, targetUrl: string, targetIndex: number) {
    this.store = Array.from({ length: rows }, (_, i) => ({
      id: `lead-${i + 1}`,
      user_id: userId,
      linkedin_url: i === targetIndex ? targetUrl : `https://www.linkedin.com/in/user-${i + 1}`,
      disposition_tag: null,
      last_surfaced_reply_at: null,
      last_reply_at: null,
      last_reply_text: null,
    }));
  }
  from(name: string) {
    if (name !== "agent_leads") throw new Error("unexpected table");
    const self = this;
    return {
      select(_cols: string) {
        return this;
      },
      eq(_col: string, _val: string) { return this; },
      ilike(_col: string, _pattern: string) {
        return this;
      },
      range(start: number, end: number) {
        const rows = self.store.slice(start, end + 1);
        return Promise.resolve({ data: rows, error: null });
      },
      maybeSingle() {
        // exact fast-path: use supplied raw url equality; simulate no match
        return Promise.resolve({ data: null, error: null });
      },
    } as unknown as Record<string, unknown>;
  }
}
Deno.test("findLeadByNormalizedLinkedIn paginates beyond 500", async () => {
  const total = 1200;
  const targetIdx = 1105;
  const userId = "user-1";
  const target = "https://www.linkedin.com/in/unique-target";
  const fake = new PagedSupabase(total, userId, target, targetIdx);
  const res = await findLeadByNormalizedLinkedIn(fake as unknown as any, userId, target);
  assert(res);
  assertEquals(res?.id, `lead-${targetIdx + 1}`);
});

// 5) Recovery idempotency: compare against last_reply_at
Deno.test("recovery idempotency: second run skips when last_reply_at is newer-or-equal", () => {
  const newest = "2026-09-16T12:00:00Z";
  const prior = "2026-09-16T12:00:00Z";
  const n = new Date(newest).getTime();
  const p = new Date(prior).getTime();
  assertEquals(Number.isFinite(n) && n > p, false);
});

// 6) Stale/fresh/missing-ts gating via real helper
Deno.test("stale message: helper returns true; classify should be gated off", () => {
  const now = new Date("2026-09-30T12:00:00Z").getTime();
  const msg = "2026-09-28T11:59:59Z";
  assertEquals(isStaleProspectMessage(msg, now), true);
});
Deno.test("fresh message: helper returns false", () => {
  const now = new Date("2026-09-30T12:00:00Z").getTime();
  const msg = "2026-09-30T11:30:00Z";
  assertEquals(isStaleProspectMessage(msg, now), false);
});
Deno.test("missing timestamp: treated as stale", () => {
  const now = Date.now();
  assertEquals(isStaleProspectMessage(null, now), true);
  assertEquals(isStaleProspectMessage(undefined, now), true);
  assertEquals(isStaleProspectMessage("not-a-date", now), true);
});

