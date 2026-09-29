import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { shouldAutoClassifyOnLeadSelect } from "../../src/lib/inbox-guards.ts";

type Lead = {
  channel: "email" | "linkedin";
  source?: "heyreach" | "smartlead" | "reply_io" | string | null;
  intent?: string | null;
  draft_response?: string | null;
};

Deno.test("handleSelectLead guard: blocks LinkedIn/HeyReach when drafting disabled", () => {
  const liLead: Lead = { channel: "linkedin", source: "heyreach", intent: "", draft_response: "" };
  const emailLead: Lead = { channel: "email", source: "reply_io", intent: "", draft_response: "" };
  const hrEmailLead: Lead = { channel: "email", source: "heyreach", intent: "", draft_response: "" };

  // OFF → do not auto-classify LinkedIn/HeyReach leads
  assertEquals(shouldAutoClassifyOnLeadSelect(liLead as any, { heyreachDraftingEnabled: false }), false);
  assertEquals(shouldAutoClassifyOnLeadSelect(hrEmailLead as any, { heyreachDraftingEnabled: false }), false);
  // Email (non-HeyReach) unchanged
  assertEquals(shouldAutoClassifyOnLeadSelect(emailLead as any, { heyreachDraftingEnabled: false }), true);

  // ON → LinkedIn allowed again
  assertEquals(shouldAutoClassifyOnLeadSelect(liLead as any, { heyreachDraftingEnabled: true }), true);
});

