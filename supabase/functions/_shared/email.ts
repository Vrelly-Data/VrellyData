// Simple transactional email sender (Resend-backed).
// Env:
// - RESEND_API_KEY: required to send via Resend
// - EMAIL_FROM: sender address (default: notifications@vrelly.com)
//
// Do not log secrets. Return a boolean for success; throw only on misuse.

export interface SendEmailOptions {
  to: string[];               // recipients (validated upstream)
  subject: string;
  html?: string;
  text?: string;
  tags?: Array<{ name: string; value: string }>;
}

export async function sendTransactionalEmail(opts: SendEmailOptions): Promise<boolean> {
  const apiKey = Deno.env.get("RESEND_API_KEY") || "";
  const fromAddr = Deno.env.get("EMAIL_FROM") || "notifications@vrelly.com";

  if (!Array.isArray(opts.to) || opts.to.length === 0) {
    throw new Error("Email 'to' must be a non-empty string array");
  }
  if (!opts.subject || typeof opts.subject !== "string") {
    throw new Error("Email 'subject' must be provided");
  }

  if (!apiKey) {
    console.warn("[email] RESEND_API_KEY not set — skipping send");
    return false;
  }

  const payload: Record<string, unknown> = {
    from: fromAddr,
    to: opts.to,
    subject: opts.subject,
    ...(opts.html ? { html: opts.html } : {}),
    ...(opts.text ? { text: opts.text } : {}),
    ...(opts.tags && opts.tags.length > 0 ? { tags: opts.tags } : {}),
  };

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`[email] Resend POST failed (${res.status}) body=${body.slice(0, 500)}`);
      return false;
    }
    return true;
  } catch (e) {
    console.error("[email] Resend network error:", e instanceof Error ? e.message : String(e));
    return false;
  }
}

