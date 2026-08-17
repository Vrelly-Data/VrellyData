// Live "can this campaign actually send?" check.
//
// WHY THIS IS A LIVE CALL AND NOT A COLUMN READ. synced_campaigns.status is NOT
// a safety signal, proven both ways against real data on 2026-08-16:
//
//   Reply.io seq 1662065  status=skipped   0 email accts, 1 step, 0-delay
//                                          AUTOMATIC email step. It did not
//                                          send only because no mailbox is
//                                          attached — not because of its status.
//   Reply.io seq 1726433  status=active    0 email accounts. "Active" and
//                                          cannot send an email at all.
//   Smartlead 2219737     status=COMPLETED 0 email accounts, 4 steps.
//
// So a stored status can be inert-looking while armed, or armed-looking while
// inert. The only reliable answer comes from asking the platform, and it can
// change between runs (a mailbox is attached or removed in the platform's UI
// with nothing flowing back to us).
//
// WHAT THE RUNNER DOES WITH THIS. Preflight runs BEFORE enrichment, so a
// campaign that cannot send never causes Apollo credits to be spent. Enrolling
// contacts into a campaign with no sending account is a silent dead end: the
// push "succeeds", the ledger records it, the prospect is consumed for that
// client forever (the dedup is client-wide), and nobody is ever contacted.

export interface CampaignPreflight {
  /** Did the platform acknowledge this campaign exists? */
  exists: boolean;
  /** Sending accounts attached, by channel. */
  emailAccounts: number;
  linkedInAccounts: number;
  /** Steps configured. A campaign with zero steps sends nothing. */
  steps: number;
  /** Platform's own status string, recorded for the audit trail — NOT a gate. */
  status: string | null;
  /** True when an EMAIL push could actually be delivered. */
  canSendEmail: boolean;
  /** Human-readable reason when canSendEmail is false. */
  reason: string | null;
  /** Non-null when the check itself failed (network, auth) — distinct from "cannot send". */
  checkError: string | null;
}

const fail = (checkError: string): CampaignPreflight => ({
  exists: false,
  emailAccounts: 0,
  linkedInAccounts: 0,
  steps: 0,
  status: null,
  canSendEmail: false,
  reason: null,
  checkError,
});

function decide(p: CampaignPreflight): CampaignPreflight {
  if (!p.exists) return { ...p, canSendEmail: false, reason: "campaign not found on the platform" };
  if (p.steps === 0) return { ...p, canSendEmail: false, reason: "campaign has no steps configured" };
  if (p.emailAccounts === 0) {
    return {
      ...p,
      canSendEmail: false,
      reason: p.linkedInAccounts > 0
        ? "campaign has only LinkedIn sending accounts, no mailbox for an email push"
        : "campaign has no sending accounts attached",
    };
  }
  return { ...p, canSendEmail: true, reason: null };
}

/**
 * Reply.io. GET /v3/sequences/{id} returns emailAccounts[], linkedInAccounts[]
 * and steps[] — shape observed live 2026-08-16.
 */
export async function preflightReplyIo(
  sequenceId: string,
  apiKey: string,
): Promise<CampaignPreflight> {
  try {
    const res = await fetch(`https://api.reply.io/v3/sequences/${encodeURIComponent(sequenceId)}`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
    });
    if (res.status === 404) return decide({ ...fail(""), checkError: null, exists: false });
    if (!res.ok) return fail(`Reply.io sequence lookup ${res.status}`);
    const j = await res.json().catch(() => ({}));
    return decide({
      exists: true,
      emailAccounts: Array.isArray(j?.emailAccounts) ? j.emailAccounts.length : 0,
      linkedInAccounts: Array.isArray(j?.linkedInAccounts) ? j.linkedInAccounts.length : 0,
      steps: Array.isArray(j?.steps) ? j.steps.length : 0,
      status: typeof j?.status === "string" ? j.status : null,
      canSendEmail: false,
      reason: null,
      checkError: null,
    });
  } catch (e) {
    return fail(`Reply.io preflight threw: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/**
 * Smartlead. Needs THREE calls: the campaign itself, its email accounts, and
 * its sequence steps — none of which is available from the campaign object
 * alone. Shapes observed live 2026-08-16 (campaign 2219737: status COMPLETED,
 * 0 email accounts, 4 steps).
 *
 * api_key travels in the QUERY STRING for Smartlead — never log these URLs.
 */
export async function preflightSmartlead(
  campaignId: string,
  apiKey: string,
): Promise<CampaignPreflight> {
  const base = "https://server.smartlead.ai/api/v1/campaigns";
  const url = (suffix: string) => {
    const u = new URL(`${base}/${encodeURIComponent(campaignId)}${suffix}`);
    u.searchParams.set("api_key", apiKey);
    return u.toString();
  };
  try {
    const campRes = await fetch(url(""), { headers: { Accept: "application/json" } });
    if (campRes.status === 404) return decide({ ...fail(""), checkError: null, exists: false });
    if (!campRes.ok) return fail(`Smartlead campaign lookup ${campRes.status}`);
    const camp = await campRes.json().catch(() => ({}));
    // Smartlead answers 200 with an error-ish body for some bad ids.
    if (!camp?.id) return decide({ ...fail(""), checkError: null, exists: false });

    const [accRes, seqRes] = await Promise.all([
      fetch(url("/email-accounts"), { headers: { Accept: "application/json" } }),
      fetch(url("/sequences"), { headers: { Accept: "application/json" } }),
    ]);
    const accs = accRes.ok ? await accRes.json().catch(() => []) : [];
    const seqs = seqRes.ok ? await seqRes.json().catch(() => []) : [];

    return decide({
      exists: true,
      emailAccounts: Array.isArray(accs) ? accs.length : 0,
      linkedInAccounts: 0, // Smartlead is email-only
      steps: Array.isArray(seqs) ? seqs.length : 0,
      status: typeof camp?.status === "string" ? camp.status : null,
      canSendEmail: false,
      reason: null,
      checkError: null,
    });
  } catch (e) {
    return fail(`Smartlead preflight threw: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** Dispatch on agent_audiences.platform. */
export function preflightCampaign(
  platform: string,
  externalCampaignId: string,
  apiKey: string,
): Promise<CampaignPreflight> {
  if (platform === "reply.io") return preflightReplyIo(externalCampaignId, apiKey);
  if (platform === "smartlead") return preflightSmartlead(externalCampaignId, apiKey);
  return Promise.resolve(fail(`unsupported platform: ${platform}`));
}
