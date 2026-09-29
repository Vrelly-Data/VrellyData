import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { isHeyreachDraftingEnabled, shouldAutoClassifyOnLeadSelect } from "../../src/lib/inbox-guards.ts";

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

Deno.test("handleSelectLead guard: channel-only and source-only paths each block when OFF", () => {
  const liReplyIo: Lead = { channel: "linkedin", source: "reply_io", intent: null, draft_response: null };
  const liNoSource: Lead = { channel: "linkedin", source: null, intent: null, draft_response: null };
  const emailHeyreach: Lead = { channel: "email", source: "heyreach", intent: null, draft_response: null };
  for (const lead of [liReplyIo, liNoSource, emailHeyreach]) {
    assertEquals(shouldAutoClassifyOnLeadSelect(lead as any, { heyreachDraftingEnabled: false }), false);
    assertEquals(shouldAutoClassifyOnLeadSelect(lead as any, { heyreachDraftingEnabled: true }), true);
  }
  // Already classified / drafted leads are never auto-classified, flag ON or OFF.
  const done: Lead = { channel: "email", source: "smartlead", intent: "interested", draft_response: null };
  assertEquals(shouldAutoClassifyOnLeadSelect(done as any, { heyreachDraftingEnabled: true }), false);
});

Deno.test("handleSelectLead guard: default (no override, env unset) is OFF", () => {
  assertEquals(isHeyreachDraftingEnabled(), false);
  const liLead: Lead = { channel: "linkedin", source: "heyreach", intent: null, draft_response: null };
  assertEquals(shouldAutoClassifyOnLeadSelect(liLead as any), false);
  const emailLead: Lead = { channel: "email", source: "smartlead", intent: null, draft_response: null };
  assertEquals(shouldAutoClassifyOnLeadSelect(emailLead as any), true);
});

Deno.test("UI flag is read via a Vite-replaceable import.meta.env member access", () => {
  const src = Deno.readTextFileSync(new URL("../../src/lib/inbox-guards.ts", import.meta.url));
  // (import.meta as ...).env?.VITE_HEYREACH_DRAFTING_ENABLED -> import.meta.env?.VITE_... after TS erasure
  assertEquals(/\(import\.meta as [^)]*\)\.env\s*\?\.\s*VITE_HEYREACH_DRAFTING_ENABLED/.test(src), true);
  assertEquals(/const\s+\w+\s*=\s*import\.meta\s+as/.test(src), false, "aliasing import.meta defeats Vite env replacement");
});

Deno.test("AgentInbox handleSelectLead uses the kill-switch guard", () => {
  const src = Deno.readTextFileSync(new URL("../../src/components/agent/AgentInbox.tsx", import.meta.url));
  const start = src.indexOf("const handleSelectLead");
  assertEquals(start >= 0, true);
  const body = src.slice(start, src.indexOf("}, [", start));
  assertEquals(/const needsClassification = shouldAutoClassifyOnLeadSelect\(lead\);/.test(body), true);
  assertEquals(body.includes("!lead.intent && !lead.draft_response"), false);
});
