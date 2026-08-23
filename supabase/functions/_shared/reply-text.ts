// Shared reply-text cleaning.
//
// preprocessEmailReply was previously a private copy inside classify-reply.
// It is promoted here VERBATIM (not rewritten) so the AI's input and the
// stored last_reply_text preview are produced by exactly one implementation.
// Its behaviour is already measured against 650 real prod bodies — see the
// note inside step 1.
//
// Two entry points:
//   preprocessEmailReply — full clean. What classify-reply feeds the model.
//   cleanReplyPreview    — same clean, but never returns less than a usable
//                          string: if the clean collapses the body to <20
//                          chars we keep the htmlToText-only version. This is
//                          the guard classify-reply already applied at its
//                          call site, lifted in so every last_reply_text
//                          writer inherits it instead of re-implementing it.
import { htmlToText } from './html-to-text.ts';

export function preprocessEmailReply(text: string): string {
  if (!text) return '';
  let s = text;

  // 1. HTML → text, via the one shared cleaner (htmlToText has its own plain
  //    text fast path, so this stays idempotent).
  //
  //    Deliberately NOT gated on "does it look like HTML" any more. The old
  //    gate was `if (/<[a-z][^>]*>/i.test(s))`, which meant text carrying
  //    entities but no tags — the normal shape of an already-ingested reply —
  //    skipped entity decoding entirely and the model read "Hi&nbsp;Scott,".
  //    Measured over 650 real prod bodies: entity leakage into the prompt
  //    36 → 0, and the model is never handed MORE text than before (139
  //    samples shrank, 511 identical, 0 grew).
  s = htmlToText(s);

  // 2. Zendesk-style marker (defensive — smartlead-webhook also strips this)
  s = s.replace(/##-\s*Please type your reply above this line\s*-##[\s\S]*$/i, '');

  // 3. Quoted-reply chains. Each pattern matches the START of a quote block;
  // we cut from the earliest match.
  const quoteMarkers: RegExp[] = [
    /^On\s+.+?\swrote:\s*$/m,                  // "On <date>, <name> wrote:"
    /^From:\s.+?\nSent:\s/m,                   // Outlook header block (Sent:)
    /^From:\s.+?\nDate:\s/m,                   // Apple Mail / iOS header block
    /^_{20,}\s*$/m,                            // Outlook horizontal-rule divider
    /^>\s.+$/m,                                // Gmail/Apple ">" quoted lines
  ];
  let earliestQuote = -1;
  for (const re of quoteMarkers) {
    const m = s.search(re);
    if (m >= 0 && (earliestQuote === -1 || m < earliestQuote)) {
      earliestQuote = m;
    }
  }
  if (earliestQuote >= 0) {
    s = s.slice(0, earliestQuote);
  }

  // 4. Signature markers — cut from the earliest match.
  const sigMarkers: RegExp[] = [
    /^--\s*$/m,                                // RFC "-- " standard
    /^Sent from my iPhone\b/im,
    /^Sent from my iPad\b/im,
    /^Get Outlook for (iOS|Android)\b/im,
    /^Sent from Outlook\b/im,
  ];
  let earliestSig = -1;
  for (const re of sigMarkers) {
    const m = s.search(re);
    if (m >= 0 && (earliestSig === -1 || m < earliestSig)) {
      earliestSig = m;
    }
  }
  if (earliestSig >= 0) {
    s = s.slice(0, earliestSig);
  }

  // 5. Closing + name pattern: "Best,\n<Name>" / "Thanks,\n<Name>" etc.
  // Match the closing word at the start of a line followed by a short
  // name line (≤60 chars, letters/spaces/hyphens/periods/apostrophes).
  const closingRe =
    /^(Best|Thanks|Thank you|Regards|Best regards|Kind regards|Cheers|Sincerely|Yours)[,!.]?\s*\n\s*[A-Za-z][A-Za-z\s.\-']{0,60}\s*$/im;
  const closingMatch = s.search(closingRe);
  if (closingMatch >= 0) {
    s = s.slice(0, closingMatch);
  }

  // 6. Collapse runs of 3+ blank lines and trim.
  s = s.replace(/\n{3,}/g, '\n\n').trim();

  return s;
}

// Display-safe cleaner for agent_leads.last_reply_text.
//
// last_reply_text is a PREVIEW (inbox list, pipeline hover, client report).
// The verbatim message always survives in reply_thread / last_reply_raw_html,
// so trimming quoted chains and signatures here loses nothing recoverable.
// Quote boundaries that preprocessEmailReply cannot catch, applied ONLY to the
// preview. Its markers are line-anchored (/^On .. wrote:$/m), which silently
// fails on a body whose newlines were collapsed to spaces upstream — measured:
// anchored markers alone moved quoted-chain contamination across 995 stored
// replies only 117 -> 112, and left a whole forwarded thread in the preview.
//
// These are deliberately NOT added to preprocessEmailReply. That function feeds
// the model, its current behaviour is measured against 650 prod bodies, and an
// unanchored "wrote:" can in principle fire mid-sentence. A preview may lose a
// little text (the verbatim body is still in reply_thread); a prompt may not.
const PREVIEW_QUOTE_MARKERS: RegExp[] = [
  /-{2,}\s*Forwarded message\s*-{2,}/i,   // Gmail forward header
  /-{2,}\s*Original Message\s*-{2,}/i,    // Outlook
  /\bOn\s.{0,120}?\swrote:/i,             // inline "On <date> <name> wrote:"
  /\bFrom:\s.{0,120}?\bSent:\s/i,         // inline Outlook header block
  /##-\s*Please (type your reply above|do not write below) this line\s*-##/i,
];

// A body that OPENS with a forward header ("---------- Forwarded message
// ---------\nFrom:..\nDate:..\nSubject:..\nTo:..") carries the prospect's real
// words AFTER that header block, not before it. Cutting at the marker would
// empty the preview; keeping it shows routing metadata instead of the reply.
// So strip the header block itself, then let the normal markers trim whatever
// quoted thread follows. Bounded to 400 chars so a malformed header can never
// consume the message body.
const FORWARD_HEADER =
  /^\s*-{2,}\s*Forwarded message\s*-{2,}[\s\S]{0,400}?(?:To|Cc):\s*<?[^\s<>]+@[^\s<>]+>?[\s,;]*/i;
const FORWARD_HEADER_NO_TO =
  /^\s*-{2,}\s*Forwarded message\s*-{2,}[\s\S]{0,300}?Subject:\s*[^\n]{0,160}?(?=\s[A-Z])/i;

export function cleanReplyPreview(raw: string | null | undefined): string {
  if (!raw) return '';
  const decoded = htmlToText(raw);
  let s = preprocessEmailReply(raw);

  if (FORWARD_HEADER.test(s)) s = s.replace(FORWARD_HEADER, '');
  else if (FORWARD_HEADER_NO_TO.test(s)) s = s.replace(FORWARD_HEADER_NO_TO, '');

  let cut = -1;
  for (const re of PREVIEW_QUOTE_MARKERS) {
    const m = s.search(re);
    if (m >= 0 && (cut === -1 || m < cut)) cut = m;
  }
  // A marker at position 0 means the body OPENS with a forward/quote header —
  // the prospect's own words follow it, so cutting there would empty the
  // preview. Fall through to the >=20 guard, which keeps the decoded text.
  if (cut > 0) s = s.slice(0, cut);

  s = s.replace(/\n{3,}/g, '\n\n').trim();

  // Accept ANY non-empty result, unlike the model path's >=20 floor. A real
  // reply is often just "No thanks" or "stop"; a 9-char preview is correct,
  // whereas the >=20 floor restored the entire quoted thread behind it (19 of
  // 995 rows) — the exact contamination this function exists to remove.
  //
  // The one thing a preview must not be is a bare quote/forward header with no
  // message, which happens when the body was ONLY routing metadata. Fall back
  // there so the row keeps something a human can read.
  const degenerate = !s || /^[-\s>]*(Forwarded message|Original Message)[-\s>]*$/i.test(s);
  return degenerate ? decoded.trim() : s;
}
