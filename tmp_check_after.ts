import { deriveSenderSignals, normalizeThread, pickLatestGenuineProspect, detectSenderMislabel } from "./supabase/functions/classify-reply/thread-normalize.ts";

const fx = JSON.parse(await Deno.readTextFile("/home/ubuntu/.cursor/projects/workspace/uploads/fixtures/01-sourceco-browning.json"));
const ctx = JSON.parse(await Deno.readTextFile("/home/ubuntu/.cursor/projects/workspace/uploads/fixtures/context/sourceco.json"));
const agentCtx = ctx.agent_config_prompt_fields ?? {};
const mailboxEmails = (ctx.email_sender_mailboxes ?? []).map((m: any) => m.mailbox_email);
const mailboxFromNames = (ctx.email_sender_mailboxes ?? []).map((m: any) => m.from_name ?? m.sender_name ?? "");
const effSenderName = agentCtx?.sender_name ?? "Sender";
const signals = deriveSenderSignals({ agentSenderName: effSenderName, mailboxEmails, mailboxFromNames });
const { normalized } = normalizeThread(fx.request.thread_history, { channel: fx.channel, signals });
for (const [i,e] of normalized.entries()) {
  console.log(i, e.role, e.cleanContent.slice(0,80).replace(/\n/g,' \\n '));
}
for (const [i,raw] of (fx.request.thread_history as any[]).entries()) {
  const rel = detectSenderMislabel(raw, signals);
  console.log("raw", i, raw.role, "relabel?", rel);
  if (rel) {
    const lower = String(raw.content||"").toLowerCase();
    for (const d of signals.senderDomains) {
      if (lower.includes(d)) console.log("  matched domain:", d);
    }
    for (const n of signals.senderNames) {
      if (lower.includes(n)) console.log("  matched name:", n);
    }
    const looksQuoted = /\bfrom:\s/i.test(String(raw.content||"")) || /\bon\s.+wrote:/i.test(String(raw.content||"")) || />/.test(String(raw.content||""));
    console.log("  looksQuotedChain?", looksQuoted);
  }
}
const { latest } = pickLatestGenuineProspect(normalized);
console.log("latest role", latest?.role);
console.log("latest clean length", latest?.cleanContent.length);
console.log("latest clean:\n", latest?.cleanContent);

