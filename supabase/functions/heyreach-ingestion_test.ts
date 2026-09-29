import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { normalizeLinkedInUrl } from "./_shared/lead-dedup.ts";

// 1) linkedin_url normalization (comparison key)
Deno.test("normalizeLinkedInUrl canonicalizes protocol/www/trailing slash", () => {
  const a = normalizeLinkedInUrl("https://www.linkedin.com/in/JaneDoe/");
  const b = normalizeLinkedInUrl("http://linkedin.com/in/janEDOE");
  assertEquals(a, b);
  assertEquals(a, "linkedin.com/in/janedoe");
});

// 2) Insert-vs-update decision (pure)
function decideSavePath(existingLeadId: string | null): "insert" | "update" {
  return existingLeadId ? "update" : "insert";
}
Deno.test("decideSavePath chooses update when id present", () => {
  assertEquals(decideSavePath("abc"), "update");
  assertEquals(decideSavePath(null), "insert");
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

// 4) Recovery dry-run action classification (pure)
type Action = "insert_lead" | "update_reply" | "skip_up_to_date";
function classifyRecoveryAction(
  hasExisting: boolean,
  newestProspectIso: string | null,
  lastSurfacedIso: string | null,
): Action {
  if (!hasExisting) return "insert_lead";
  const n = newestProspectIso ? new Date(newestProspectIso).getTime() : NaN;
  const p = lastSurfacedIso ? new Date(lastSurfacedIso).getTime() : 0;
  const newer = Number.isFinite(n) && n > p;
  return newer ? "update_reply" : "skip_up_to_date";
}
Deno.test("classifyRecoveryAction chooses insert/update/skip", () => {
  assertEquals(classifyRecoveryAction(false, "2026-09-16T12:00:00Z", null), "insert_lead");
  assertEquals(classifyRecoveryAction(true, "2026-09-16T12:00:00Z", "2026-09-15T12:00:00Z"), "update_reply");
  assertEquals(classifyRecoveryAction(true, "2026-09-14T12:00:00Z", "2026-09-15T12:00:00Z"), "skip_up_to_date");
});

