import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { upsertAgentLeadWithLinkedinRecovery } from "./agent-leads.ts";

type UpsertCall = { row: Record<string, unknown> };

class FakeAgentLeadsTable {
  private calls: UpsertCall[] = [];
  // Sequence of outcomes for successive upserts
  // deno-lint-ignore no-explicit-any
  constructor(private outcomes: any[]) {}
  getUpsertCalls(): UpsertCall[] { return this.calls; }
  upsert(row: Record<string, unknown>, _opts: { onConflict: string }) {
    this.calls.push({ row });
    return {
      select: () => ({
        single: async () => {
          const next = this.outcomes.shift();
          if (!next) return { data: { id: "ok" }, error: null };
          return next;
        },
      }),
    };
  }
}

class FakeSupabase {
  private table: FakeAgentLeadsTable;
  // deno-lint-ignore no-explicit-any
  constructor(outcomes: any[]) {
    this.table = new FakeAgentLeadsTable(outcomes);
  }
  from(table: string) {
    if (table !== "agent_leads") throw new Error(`unexpected table: ${table}`);
    return this.table;
  }
  getCalls() {
    return (this.table as unknown as FakeAgentLeadsTable).getUpsertCalls();
  }
}

Deno.test("upsertAgentLeadWithLinkedinRecovery retries with linkedin_url=null on 23505 (empty string)", async () => {
  const outcomes = [
    // First upsert: 23505 on agent_leads_user_linkedin_unique
    { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint \"agent_leads_user_linkedin_unique\"" } },
    // Second upsert: success
    { data: { id: "123" }, error: null },
  ];
  const fake = new FakeSupabase(outcomes);
  const row = { user_id: "u1", email_address: "carlos@example.com", linkedin_url: "" };
  const res = await upsertAgentLeadWithLinkedinRecovery<{ id: string }>(fake as unknown as any, row, "user_id,email_address");
  assert(!res.error);
  assertEquals(res.data?.id, "123");
  const calls = fake.getCalls();
  assertEquals(calls.length, 2);
  assertEquals(calls[0].row.linkedin_url, "");
  assertEquals(calls[1].row.linkedin_url, null);
});

Deno.test('upsertAgentLeadWithLinkedinRecovery retries with linkedin_url=null on 23505 ("0" string)', async () => {
  const outcomes = [
    { data: null, error: { code: "23505", details: "Key (user_id, linkedin_url)=(u1, 0) already exists. constraint agent_leads_user_linkedin_unique" } },
    { data: { id: "456" }, error: null },
  ];
  const fake = new FakeSupabase(outcomes);
  const row = { user_id: "u1", email_address: "austin@example.com", linkedin_url: "0" };
  const res = await upsertAgentLeadWithLinkedinRecovery<{ id: string }>(fake as unknown as any, row, "user_id,email_address");
  assert(!res.error);
  assertEquals(res.data?.id, "456");
  const calls = fake.getCalls();
  assertEquals(calls.length, 2);
  assertEquals(calls[0].row.linkedin_url, "0");
  assertEquals(calls[1].row.linkedin_url, null);
});

