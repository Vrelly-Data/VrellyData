// Shared HTML→text conversion for the Reply.io capture paths.
//
// MOVED VERBATIM from poll-reply-inbox so reply-webhook and poll-reply-inbox
// produce BYTE-IDENTICAL clean text from the same reply body. That matters
// because the two paths dedup onto the SAME agent_leads row
// (_shared/lead-dedup.ts): whichever arrives second UPDATEs the row, so if the
// two cleaners differed by even a character, every capture would flip the
// stored text back and forth instead of being idempotent.
//
// Convert an email HTML body to readable plain text. Reply.io returns email
// message bodies as HTML (Outlook MsoNormal markup, inline styles, signature
// tables); LinkedIn bodies are already plain text. Stored verbatim, that HTML
// renders as literal <div>/<p> noise in the conversation panel (which escapes
// content as text — no XSS today, just unreadable). We normalize to text at
// capture so the stored thread is clean for the panel AND for the text that
// feeds classify-reply / draft generation.
//
// Deno's edge runtime has no DOMParser, so this is regex-based (same pragmatic
// approach as stripBraceWrapper in send-agent-reply). Order matters: drop
// script/style blocks (contents included) BEFORE stripping tags, turn block
// boundaries into newlines, strip remaining tags, decode entities, then collapse
// whitespace. &amp; is decoded LAST so double-encoded entities (&amp;lt;) don't
// over-decode.
export function htmlToText(html: string): string {
  if (!html) return '';
  // Fast path: no tag/entity markers → already plain text (e.g. LinkedIn).
  if (!/[<&]/.test(html)) return html;
  let text = html;
  // 1. Remove <script>/<style> blocks entirely (tag + contents).
  text = text.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
  // 2. Block-level boundaries → newline (before tag-strip so structure survives).
  text = text.replace(/<\s*br\s*\/?\s*>/gi, '\n');
  text = text.replace(/<\/\s*(p|div|tr|li|h[1-6]|table|blockquote)\s*>/gi, '\n');
  // 3. Strip all remaining tags.
  text = text.replace(/<[^>]+>/g, '');
  // 4. Decode common HTML entities (named + numeric); &amp; last.
  text = text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'")
    // Common named smart-punctuation/symbol entities that show up in email
    // prose (numeric forms are handled below; these named ones would leak).
    .replace(
      /&(mdash|ndash|hellip|lsquo|rsquo|ldquo|rdquo|copy|reg|trade|deg|middot|bull|euro|pound|cent);/gi,
      (_m, name) => {
        const map: Record<string, string> = {
          mdash: '—', ndash: '–', hellip: '…',
          lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
          copy: '©', reg: '®', trade: '™', deg: '°',
          middot: '·', bull: '•', euro: '€', pound: '£', cent: '¢',
        };
        return map[name.toLowerCase()] ?? _m;
      },
    )
    .replace(/&#(\d+);/g, (_m, d) => {
      const n = Number(d);
      return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '';
    })
    .replace(/&#x([0-9a-f]+);/gi, (_m, h) => {
      const n = parseInt(h, 16);
      return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '';
    })
    .replace(/&amp;/gi, '&');
  // 5. Collapse whitespace: normalize inline runs, trim each line, drop runs of
  //    more than one blank line, trim the ends.
  text = text
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text;
}
