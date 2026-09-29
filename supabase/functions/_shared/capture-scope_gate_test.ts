import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { checkCaptureGate, listEnabledCampaignIds } from "./capture-scope.ts";

type Row = { integration_id: string; external_campaign_id: string; capture_enabled: boolean; name?: string | null };

class FakeQuery {
  private filters: Record<string, string> = {};
  constructor(private rows: Row[], private kind: "single" | "list", private shouldError = false) {}
  select(_cols: string) { return this; }
  eq(col: string, val: unknown) { this.filters[col] = String(val); return this; }
  in(_col: string, _vals: unknown[]) { return this; }
  async maybeSingle(): Promise<{ data: Row | null; error: { message: string } | null }> {
    if (this.shouldError) return { data: null, error: { message: "boom" } };
    const match = this.rows.find(
      (r) =>
        (!this.filters["integration_id"] || r.integration_id === this.filters["integration_id"]) &&
        (!this.filters["external_campaign_id"] || r.external_campaign_id === this.filters["external_campaign_id"]),
    ) ?? null;
    return { data: match, error: null };
  }
  async then(resolve: (v: { data: unknown; error: unknown }) => void) {
    // So FakeQuery can be awaited by withTimeout(q, ms) where q is this object
    // Return the list shape for listEnabledCampaignIds; single shape otherwise.
    if (this.kind === "list") {
      if (this.shouldError) resolve({ data: null, error: { message: "boom" } });
      else resolve({ data: this.rows.filter((r) => r.capture_enabled && r.integration_id === this.filters["integration_id"]).map((r) => ({ external_campaign_id: r.external_campaign_id })), error: null });
    } else {
      const one = this.rows.find(
        (r) =>
          (!this.filters["integration_id"] || r.integration_id === this.filters["integration_id"]) &&
          (!this.filters["external_campaign_id"] || r.external_campaign_id === this.filters["external_campaign_id"]),
      ) ?? null;
      resolve({ data: one, error: null });
    }
  }
}

class FakeDb {
  constructor(private rows: Row[], private ok = true) {}
  from(name: string) {
    if (name !== "synced_campaigns") throw new Error("unexpected table");
    return new FakeQuery(this.rows, "single", !this.ok) as unknown as Record<string, unknown>;
  }
}

class FakeDbList {
  constructor(private rows: Row[], private ok = true) {}
  from(name: string) {
    if (name !== "synced_campaigns") throw new Error("unexpected table");
    // list mode so then() yields array
    return new FakeQuery(this.rows, "list", !this.ok) as unknown as Record<string, unknown>;
  }
}

Deno.test("checkCaptureGate: no campaign id -> no_campaign_id", async () => {
  const db = new FakeDb([]);
  const res = await checkCaptureGate(db as unknown as any, "int1", null);
  assertEquals(res.allowed, false);
  assertEquals(res.reason, "no_campaign_id");
});

Deno.test("checkCaptureGate: missing row -> no_synced_row", async () => {
  const db = new FakeDb([{ integration_id: "int2", external_campaign_id: "c9", capture_enabled: true }]);
  const res = await checkCaptureGate(db as unknown as any, "int1", "c1");
  assertEquals(res.allowed, false);
  assertEquals(res.reason, "no_synced_row");
});

Deno.test("checkCaptureGate: capture_enabled false -> capture_disabled", async () => {
  const db = new FakeDb([{ integration_id: "int1", external_campaign_id: "c1", capture_enabled: false, name: "N" }]);
  const res = await checkCaptureGate(db as unknown as any, "int1", "c1");
  assertEquals(res.allowed, false);
  assertEquals(res.reason, "capture_disabled");
});

Deno.test("checkCaptureGate: capture_enabled true -> allowed", async () => {
  const db = new FakeDb([{ integration_id: "int1", external_campaign_id: "c1", capture_enabled: true }]);
  const res = await checkCaptureGate(db as unknown as any, "int1", "c1");
  assertEquals(res.allowed, true);
  assertEquals(res.reason, "allowed");
});

Deno.test("checkCaptureGate: lookup error -> lookup_error", async () => {
  const db = new FakeDb([], false /* ok=false => error */);
  const res = await checkCaptureGate(db as unknown as any, "int1", "c1", { timeoutMs: 500 });
  assertEquals(res.allowed, false);
  assertEquals(res.reason, "lookup_error");
});

Deno.test("listEnabledCampaignIds: returns ids", async () => {
  const rows: Row[] = [
    { integration_id: "int1", external_campaign_id: "a", capture_enabled: true },
    { integration_id: "int1", external_campaign_id: "b", capture_enabled: false },
    { integration_id: "int2", external_campaign_id: "z", capture_enabled: true },
  ];
  const db = new FakeDbList(rows);
  const res = await listEnabledCampaignIds(db as unknown as any, "int1");
  assertEquals(res.ok, true);
  if (res.ok) assertEquals(new Set(res.ids), new Set(["a"]));
});

Deno.test("listEnabledCampaignIds: none -> none_enabled", async () => {
  const rows: Row[] = [
    { integration_id: "int1", external_campaign_id: "a", capture_enabled: false },
  ];
  const db = new FakeDbList(rows);
  const res = await listEnabledCampaignIds(db as unknown as any, "int1");
  assertEquals(res.ok, false);
  if (!res.ok) assertEquals(res.reason, "none_enabled");
});

Deno.test("listEnabledCampaignIds: lookup error", async () => {
  const rows: Row[] = [];
  const db = new FakeDbList(rows, false /* ok=false => error */);
  const res = await listEnabledCampaignIds(db as unknown as any, "int1");
  assertEquals(res.ok, false);
  if (!res.ok) assertEquals(res.reason, "lookup_error");
});

