import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { htmlToText } from '../_shared/html-to-text.ts';
import { preprocessEmailReply } from '../_shared/reply-text.ts';

console.log('classify-reply starting');

// Anthropic model — overridable via env so a future retirement doesn't
// require a code change. Fallback is the current Sonnet generation
// (claude-sonnet-4-6). Set ANTHROPIC_MODEL in Supabase secrets to override
// without redeploying logic.
const MODEL = Deno.env.get('ANTHROPIC_MODEL') ?? 'claude-sonnet-4-6';

// === Email reply preprocessing =============================================
// Aggressive HTML / quoted-chain / signature stripping for email channel.
// Idempotent: works on already-plain-text input (HTML detection check),
// and a no-op for LinkedIn replies (only invoked when channel === 'email').
//
// Order matters: HTML → Zendesk marker → quoted chains → signatures →
// blank-line collapse. Each step trims off everything FROM the first
// matched marker onward, so signature/quote markers earlier in the text
// take precedence over later ones.

const allowedOrigins = [
  'https://vrelly.com',
  'https://www.vrelly.com',
];

function getCorsHeaders(req: Request) {
  const origin = req.headers.get('Origin') || '';
  return {
    'Access-Control-Allow-Origin': allowedOrigins.includes(origin) ? origin : allowedOrigins[0],
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-agent-key',
  };
}

// Strip a single layer of `{...}` wrapping that the model occasionally puts
// around `suggested_response`. The prompt asks for a JSON object whose
// `suggested_response` is a plain message string; the model sometimes
// hallucinates extra braces inside that string, which then get sent to the
// prospect verbatim. Defensive — applied both at draft persistence and at
// every send point.
function stripBraceWrapper(s: string): string {
  if (!s) return s;
  return s.trim().replace(/^\{+/, '').replace(/\}+$/, '').trim();
}

const SAFE_FALLBACK = {
  intent: 'unknown',
  intent_confidence: 0,
  suggested_response: '',
  should_auto_send: false,
  reasoning: 'Classification failed - needs manual review',
  next_pipeline_stage: 'replied',
};

// SHA-256 hex of a string (prompt-drift fingerprint for draft_audit).
async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// One Anthropic call returning parsed JSON. Does fetch + parse, and on a parse
// failure makes ONE retry (re-prompting with the bad output + a corrective
// user turn). Returns { json, retried, usage, ms } or THROWS on HTTP error /
// missing text block / retry failure. Usage tokens are summed across the
// original + retry when a retry occurs.
async function callAnthropicJSON(opts: {
  apiKey: string;
  systemPrompt: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  temperature: number;
  maxTokens?: number;
}): Promise<{
  json: any;
  retried: boolean;
  usage: { input_tokens: number; output_tokens: number };
  ms: number;
}> {
  const t0 = Date.now();
  const base = {
    model: MODEL,
    max_tokens: opts.maxTokens ?? 1000,
    temperature: opts.temperature,
    system: opts.systemPrompt,
    messages: opts.messages,
  };
  const post = (body: unknown) =>
    fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': opts.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });

  const res = await post(base);
  if (!res.ok) {
    throw new Error(`Anthropic HTTP ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
  }
  const data = await res.json();
  const u1 = data.usage ?? {};
  const tb = data.content?.find((b: { type: string }) => b.type === 'text');
  if (!tb) throw new Error('no text block in response');

  try {
    return {
      json: JSON.parse(tb.text),
      retried: false,
      usage: { input_tokens: u1.input_tokens ?? 0, output_tokens: u1.output_tokens ?? 0 },
      ms: Date.now() - t0,
    };
  } catch {
    const retry = await post({
      ...base,
      messages: [
        ...opts.messages,
        { role: 'assistant', content: tb.text },
        { role: 'user', content: 'Your previous response was not valid JSON. Return ONLY a valid JSON object with the required fields. No markdown, no explanation, no prose.' },
      ],
    });
    if (!retry.ok) throw new Error(`retry HTTP ${retry.status}`);
    const rdata = await retry.json();
    const u2 = rdata.usage ?? {};
    const rtb = rdata.content?.find((b: { type: string }) => b.type === 'text');
    if (!rtb) throw new Error('retry missing text block');
    return {
      json: JSON.parse(rtb.text),
      retried: true,
      usage: {
        input_tokens: (u1.input_tokens ?? 0) + (u2.input_tokens ?? 0),
        output_tokens: (u1.output_tokens ?? 0) + (u2.output_tokens ?? 0),
      },
      ms: Date.now() - t0,
    };
  }
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const t0 = Date.now();
    console.log('[classify-reply] request received');

    // Auth: x-agent-key (service-level) OR Authorization JWT (frontend)
    const agentKey = req.headers.get('x-agent-key');
    const expectedKey = Deno.env.get('AGENT_API_KEY');
    const authHeader = req.headers.get('Authorization');

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    let authUserId: string | null = null;

    if (agentKey && expectedKey && agentKey === expectedKey) {
      // Service-level auth — user_id comes from body
      authUserId = null;
    } else if (authHeader?.startsWith('Bearer ')) {
      // JWT auth — verify and extract user_id
      const authClient = createClient(
        supabaseUrl,
        Deno.env.get('SUPABASE_ANON_KEY')!,
        { global: { headers: { Authorization: authHeader } } }
      );
      const { data: { user }, error: authError } = await authClient.auth.getUser();
      if (authError || !user) {
        console.warn(
          `[classify-reply] 401: JWT auth failed (${authError?.message ?? 'no user'})`,
        );
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      authUserId = user.id;
    } else {
      console.warn(
        '[classify-reply] 401: no x-agent-key match and no Bearer token',
      );
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[classify-reply] auth passed +${Date.now() - t0}ms`);

    const body = await req.json();
    const {
      reply_text,
      thread_history,
      agent_context,
      channel,
      user_id: bodyUserId,
      lead_id,
    } = body;

    // JWT auth overrides any user_id in body; service-level uses body user_id
    const user_id = authUserId || bodyUserId;

    if (!reply_text || !agent_context || !channel || !user_id) {
      // Per-field diagnostic so future debugging doesn't require source diving.
      // Falsy includes null, undefined, AND empty string for the same reason
      // empty replies (e.g. Smartlead test fixtures whose body is purely a
      // Zendesk marker) trip this branch.
      const missing = {
        reply_text: !reply_text
          ? (reply_text === '' ? 'empty_string' : 'missing')
          : 'ok',
        agent_context: !agent_context ? 'missing' : 'ok',
        channel: !channel ? 'missing' : 'ok',
        user_id: !user_id ? 'missing' : 'ok',
      };
      console.warn('[classify-reply] 400: missing/empty required fields', missing);
      return new Response(JSON.stringify({ error: 'Missing required fields', missing }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Email-only preprocessing: strip HTML, quoted chains, signatures so
    // Claude classifies the prospect's actual words rather than their entire
    // mail-thread history. LinkedIn replies arrive clean from heyreach-webhook
    // and skip this entirely. If preprocessing collapses the message to
    // <20 chars (bug-class: misidentified marker eating the whole reply),
    // fall back to the original so we always classify *something*.
    let processed_reply_text: string = reply_text;
    if (channel === 'email') {
      const before = reply_text.length;
      const cleaned = preprocessEmailReply(reply_text);
      console.log(
        `[classify-reply v2] email preprocessing: ${before} chars → ${cleaned.length} chars`,
      );
      if (cleaned.length < 20) {
        console.warn(
          `[classify-reply v2] preprocessing left only ${cleaned.length} chars — using original reply_text`,
        );
      } else {
        processed_reply_text = cleaned;
      }
    }

    // Create Supabase client with service role key
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Suppression: a lead tagged 'opted_out' must never be drafted for again.
    // Early-return BEFORE any LLM work so we don't engage an opted-out contact.
    if (lead_id) {
      const { data: optedRow } = await supabase
        .from('agent_leads')
        .select('disposition_tag')
        .eq('id', lead_id)
        .eq('user_id', user_id)
        .maybeSingle();
      if (optedRow?.disposition_tag === 'opted_out') {
        console.log(`[classify-reply] lead ${lead_id} is opted_out — skipping draft`);
        return new Response(JSON.stringify({ skipped: true, reason: 'opted_out' }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // Fetch all sales_knowledge entries where category = 'sales_guideline'
    const { data: guidelines } = await supabase
      .from('sales_knowledge')
      .select('title, content')
      .eq('category', 'sales_guideline')
      .eq('is_active', true);

    // Fetch relevant templates based on channel
    let templateCategories: string[];
    if (channel === 'email') {
      templateCategories = ['email_template', 'subject_line_library', 'sequence_playbook'];
    } else {
      templateCategories = ['linkedin_message', 'sequence_playbook'];
    }

    const { data: templates } = await supabase
      .from('sales_knowledge')
      .select('title, content')
      .in('category', templateCategories)
      .eq('is_active', true);

    // Buyer personas for Call 1 matching (compact list) + Call 2 (full content
    // of the matched persona). GLOBAL scope — mirrors the guideline/template
    // queries above (no created_by filter; service-role bypasses RLS).
    const { data: personas } = await supabase
      .from('sales_knowledge')
      .select('title, content, tags')
      .eq('category', 'audience_insight')
      .eq('is_active', true);

    // Recent operator "learnings" (Teach the Agent, Phase 3.4). User-scoped,
    // best-effort — a failed fetch must not block classification. Injected
    // into Call 2 (generation) only. Text lives in metadata.learning_text
    // (Phase 1 migration Part D contract), with description as fallback.
    let learnings: string[] = [];
    try {
      const { data: learningRows } = await supabase
        .from('agent_activity')
        .select('description, metadata')
        .eq('user_id', user_id)
        .eq('activity_type', 'learning_added')
        .order('created_at', { ascending: false })
        .limit(10);
      learnings = (learningRows ?? [])
        .map((r: any) => (r.metadata?.learning_text ?? r.description ?? '').trim())
        .filter((t: string) => t.length > 0);
    } catch (e) {
      console.warn('[classify-reply] learnings fetch failed (continuing):', e);
    }

    // Per-client Agent Knowledge doc — the whole markdown brief the operator
    // maintains (niche, per-message goals, sender context). Fetched directly
    // from agent_configs (not read from agent_context, which is built by 5
    // different callers) so this is the single source. Best-effort + null-safe:
    // a missing column or empty doc injects nothing → drafts exactly as today.
    let agentKnowledge = '';
    try {
      const { data: cfgRow } = await supabase
        .from('agent_configs')
        .select('agent_knowledge')
        .eq('user_id', user_id)
        .maybeSingle();
      agentKnowledge = (cfgRow?.agent_knowledge ?? '').trim();
    } catch (e) {
      console.warn('[classify-reply] agent_knowledge fetch failed (continuing):', e);
    }

    console.log(`[classify-reply] sales_knowledge fetched +${Date.now() - t0}ms`);

    // --- Campaign Intelligence fetches ---
    // Get team_id for this user
    let teamId: string | null = null;
    try {
      const { data: intRow } = await supabase
        .from('outbound_integrations')
        .select('team_id')
        .eq('created_by', user_id)
        .eq('is_active', true)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      teamId = intRow?.team_id ?? null;
    } catch (e) {
      console.error('Failed to fetch team_id:', e);
    }

    // 1. Best performing sequences
    let sequences: any[] = [];
    if (teamId) {
      try {
        const { data } = await supabase
          .from('synced_sequences')
          .select('title, content, step_number, sequence_name')
          .eq('team_id', teamId)
          .order('created_at', { ascending: false })
          .limit(10);
        sequences = (data ?? []).slice(0, 3);
      } catch (e) {
        console.error('Failed to fetch sequences:', e);
      }
    }

    // 2. Campaign performance stats (top 5 by replies, only those with replies > 0)
    let topCampaigns: any[] = [];
    if (teamId) {
      try {
        const { data } = await supabase
          .from('synced_campaigns')
          .select('name, stats')
          .eq('team_id', teamId)
          .not('stats', 'is', null)
          .order('created_at', { ascending: false });
        topCampaigns = (data ?? [])
          .filter((c: any) => (c.stats?.replies ?? 0) > 0)
          .sort((a: any, b: any) => (b.stats?.replies ?? 0) - (a.stats?.replies ?? 0))
          .slice(0, 3);
      } catch (e) {
        console.error('Failed to fetch campaigns:', e);
      }
    }

    // 3. Best performing copy templates
    let copyTemplates: any[] = [];
    if (teamId) {
      try {
        const { data } = await supabase
          .from('copy_templates')
          .select('subject, body, channel, performance_data')
          .eq('team_id', teamId)
          .order('created_at', { ascending: false })
          .limit(3);
        copyTemplates = data ?? [];
      } catch (e) {
        console.error('Failed to fetch copy templates:', e);
      }
    }

    // Build campaign intelligence section
    let campaignIntelligence = '';
    if (topCampaigns.length > 0 || sequences.length > 0 || copyTemplates.length > 0) {
      const campaignLines = topCampaigns.map((c: any) => {
        const replies = c.stats?.replies ?? 0;
        const linkedinReplies = c.stats?.linkedinReplies ?? 0;
        const people = c.stats?.peopleCount ?? 0;
        const replyRate = people > 0 ? ((replies / people) * 100).toFixed(1) : '0.0';
        return `Campaign: ${c.name}\nReplies: ${replies}\nLinkedIn Replies: ${linkedinReplies}\nPeople: ${people}\nReply Rate: ${replyRate}%`;
      }).join('\n\n');

      const sequenceLines = sequences.map((s: any) => {
        const content = (s.content || '').slice(0, 300);
        return `Sequence: ${s.sequence_name} - Step ${s.step_number}\n${s.title}\n${content}`;
      }).join('\n\n');

      const copyLines = copyTemplates.map((t: any) => {
        const body = (t.body || '').slice(0, 300);
        return `Channel: ${t.channel}\nSubject: ${t.subject || '(none)'}\n${body}`;
      }).join('\n\n');

      campaignIntelligence = `\n\n## Campaign Intelligence
This data comes from the sender's actual outbound campaigns. Use it to understand what messaging is working and inform your response.

### Top Performing Campaigns
${campaignLines || 'No campaign data available.'}

### Active Sequences & Templates
${sequenceLines || 'No sequence data available.'}

### Previously Generated Copy
${copyLines || 'No copy templates available.'}

Use this campaign data to:
1. Match the tone and style of messages that got replies
2. Reference similar value props that worked
3. Keep responses consistent with the sender's established voice across campaigns`;
    }

    console.log(`[classify-reply] campaign data fetched +${Date.now() - t0}ms (teamId=${teamId}, campaigns=${topCampaigns.length}, sequences=${sequences.length}, templates=${copyTemplates.length})`);

    // Format knowledge entries
    const guidelinesText = (guidelines || [])
      .map((g: { title: string; content: string }) => `### ${g.title}\n${g.content}`)
      .join('\n\n');

    const templatesText = (templates || [])
      .map((t: { title: string; content: string }) => `### ${t.title}\n${t.content}`)
      .join('\n\n');

    const {
      offer_description,
      desired_action,
      outcome_delivered,
      target_icp,
      sender_name,
      sender_title,
      sender_linkedin,
      sender_bio,
      company_name,
      company_url,
      communication_style,
      avoid_phrases,
      sample_message,
      calendar_link,
      pricing_summary,
      case_studies,
      disqualification_criteria,
      objection_handling_notes,
    } = agent_context;

    // Fetch denormalized lead context for prompt + draft_audit. Best-effort —
    // a failed lookup must not block classification. Empty fields are gated
    // out of the prompt below via the `line()` helper.
    let leadName: string | null = null;
    let leadJobTitle: string | null = null;
    let leadCompany: string | null = null;
    let leadLinkedinUrl: string | null = null;
    let leadEmail: string | null = null;
    let leadLastCampaignName: string | null = null;
    let leadCampaignExternalId: string | null = null;
    let leadDispositionTag: string | null = null;
    // Most recent role:'sender' fromName in the thread — identifies which sender
    // owns this conversation, for multi-sender voice matching below.
    let threadSenderName: string | null = null;
    if (lead_id) {
      try {
        const { data: leadRow } = await supabase
          .from('agent_leads')
          .select('full_name, job_title, company, linkedin_url, email, last_campaign_name, campaign_external_id, disposition_tag, reply_thread')
          .eq('id', lead_id)
          .eq('user_id', user_id)
          .maybeSingle();
        if (leadRow) {
          leadName = leadRow.full_name ?? null;
          leadJobTitle = leadRow.job_title ?? null;
          leadCompany = leadRow.company ?? null;
          leadLinkedinUrl = leadRow.linkedin_url ?? null;
          leadEmail = leadRow.email ?? null;
          leadLastCampaignName = leadRow.last_campaign_name ?? null;
          leadCampaignExternalId = leadRow.campaign_external_id ?? null;
          leadDispositionTag = leadRow.disposition_tag ?? null;
          const rt = Array.isArray(leadRow.reply_thread) ? leadRow.reply_thread : [];
          for (let i = rt.length - 1; i >= 0; i--) {
            const m = rt[i] as { role?: string; fromName?: string };
            if (m?.role === 'sender' && typeof m.fromName === 'string' && m.fromName.trim()) {
              threadSenderName = m.fromName.trim();
              break;
            }
          }
        }
      } catch (e) {
        console.warn('[classify-reply] lead context fetch failed (continuing):', e);
      }
    }

    // Effective sender identity for the draft voice. Defaults to the client's
    // single agent_configs sender_* fields (no regression for single-sender
    // clients), then overridden when the client has sender_profiles: the row
    // whose sender_name matches the thread's sender (case-insensitive/trimmed)
    // → the is_default profile → the first profile. A chosen profile fully
    // replaces the identity so we never mix one sender's name with another's
    // title/bio.
    let effSenderName = sender_name;
    let effSenderTitle = sender_title;
    let effSenderLinkedin = sender_linkedin;
    let effSenderBio = sender_bio;
    let effCommStyle = communication_style;
    try {
      const { data: profiles } = await supabase
        .from('sender_profiles')
        .select('sender_name, job_title, linkedin_url, bio, communication_style, is_default')
        .eq('user_id', user_id);
      const list = profiles ?? [];
      if (list.length) {
        const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();
        const matched = threadSenderName
          ? list.find((p: { sender_name: string }) => norm(p.sender_name) === norm(threadSenderName))
          : null;
        const chosen = matched ?? list.find((p: { is_default?: boolean }) => p.is_default) ?? list[0];
        if (chosen) {
          effSenderName = chosen.sender_name;
          effSenderTitle = chosen.job_title ?? null;
          effSenderLinkedin = chosen.linkedin_url ?? null;
          effSenderBio = chosen.bio ?? null;
          effCommStyle = chosen.communication_style ?? null;
          console.log(`[classify-reply] sender voice: "${chosen.sender_name}" (${matched ? 'thread-match' : chosen.is_default ? 'default' : 'first'}; thread fromName=${threadSenderName ?? 'none'})`);
        }
      }
    } catch (e) {
      console.warn('[classify-reply] sender_profiles fetch failed (using config sender):', e);
    }

    // Render an optional sectioned line only when value is present, so empty
    // fields drop entire lines rather than rendering "Not specified".
    const line = (label: string, value: string | null | undefined) =>
      value && value.trim() ? `${label}${value}` : '';

    const promptVersion = 'phase3-v3';

    // Compact persona list for Call 1 (titles + tags only). Full content of the
    // matched persona is looked up after Call 1 from the same `personas` array.
    const personaList = (personas ?? []).length
      ? (personas ?? [])
          .map((p: { title: string; tags?: string[] | null }) =>
            `- ${p.title}${p.tags && p.tags.length ? ` [tags: ${p.tags.join(', ')}]` : ''}`)
          .join('\n')
      : 'No personas defined.';

    // Convert thread_history into Anthropic-native messages.
    // prospect → user, sender → assistant. Role values verified stable
    // across all 4 ingestion writers (heyreach/smartlead webhooks,
    // reply-webhook, sync-reply-contacts).
    type ThreadEntry = { role?: string; content?: string };
    const rawThread: ThreadEntry[] = Array.isArray(thread_history) ? thread_history : [];

    // Drop the trailing entry if it duplicates the inbound reply — webhooks
    // update reply_thread BEFORE invoking classify-reply, so the latest
    // prospect message is typically already at the tail.
    const trimmedThread =
      rawThread.length > 0 &&
      rawThread[rawThread.length - 1].role === 'prospect' &&
      typeof rawThread[rawThread.length - 1].content === 'string' &&
      rawThread[rawThread.length - 1].content!.trim() === processed_reply_text.trim()
        ? rawThread.slice(0, -1)
        : rawThread;

    const mapped: Array<{ role: 'user' | 'assistant'; content: string }> = trimmedThread
      .map((e) => ({
        role: (e.role === 'prospect' ? 'user' : 'assistant') as 'user' | 'assistant',
        content: typeof e.content === 'string' ? e.content : '',
      }))
      .filter((m) => m.content.trim().length > 0);

    // Anthropic requires the first message to be 'user', so the turns before
    // the prospect's first reply cannot stay in the message array.
    //
    // They used to be DISCARDED here, which quietly threw away the single most
    // relevant piece of context on cold outbound: our own pitch. Measured over
    // production threads, that hit 99.7% of Smartlead leads, 78.9% of Reply.io
    // and 77.5% of HeyReach — up to 8 turns and ~2.7k characters — and in the
    // common shape (a sequence of outbound, then one reply) it left the model
    // with NO conversation at all, while the Call 2 prompt was still telling it
    // to "reference specifics from the thread". A reply like "Not interested"
    // or "Not 5 mil" is answering the outbound; without it there is nothing to
    // answer.
    //
    // So they are carried into the system prompt instead — preserved, and
    // attributed to the sender rather than fabricated as prospect turns.
    const firstUserIdx = mapped.findIndex((m) => m.role === 'user');
    const leadingOutbound = firstUserIdx >= 0 ? mapped.slice(0, firstUserIdx) : mapped;
    const userFirst = firstUserIdx >= 0 ? mapped.slice(firstUserIdx) : [];

    // Collapse consecutive same-role turns with double-newline.
    const collapsed: Array<{ role: 'user' | 'assistant'; content: string }> = [];
    for (const m of userFirst) {
      const tail = collapsed[collapsed.length - 1];
      if (tail && tail.role === m.role) {
        tail.content = `${tail.content}\n\n${m.content}`;
      } else {
        collapsed.push({ ...m });
      }
    }

    // Append the inbound reply as the final user turn.
    const finalUserContent = `[Channel: ${channel}]\n${processed_reply_text}\n\nAnalyze this reply and respond as instructed.`;
    const finalTail = collapsed[collapsed.length - 1];
    if (finalTail && finalTail.role === 'user') {
      finalTail.content = `${finalTail.content}\n\n${finalUserContent}`;
    } else {
      collapsed.push({ role: 'user', content: finalUserContent });
    }

    const messages = collapsed;

    // Anthropic key — required before either model call.
    const anthropicApiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!anthropicApiKey) {
      console.error('ANTHROPIC_API_KEY not set');
      return new Response(JSON.stringify(SAFE_FALLBACK), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const isFirstTouch = trimmedThread.length === 0;

    // The outbound that preceded the prospect's first reply, rendered for the
    // system prompt (see the note at `leadingOutbound`). Shared verbatim by
    // BOTH calls so the classifier and the writer reason over the same facts.
    const priorOutreachSection = leadingOutbound.length > 0
      ? `\n## Our outreach before their first reply
These ${leadingOutbound.length} message(s) were sent by ${effSenderName} to this prospect BEFORE the reply you are handling. The reply is very often answering the LAST one — read it in that light. Do not re-pitch points already made here.
${leadingOutbound
          .map((m, i) => `\n--- Outbound ${i + 1} of ${leadingOutbound.length} ---\n${m.content}`)
          .join('')}\n`
      : '';

    // ============================ CALL 1 — classify ========================
    const call1SystemPrompt = `You are an expert B2B sales analyst working on behalf of ${effSenderName} at ${company_name}. Your job is to read an inbound prospect reply and classify it precisely — you do NOT write the response, you analyze.

## The Offer
${offer_description}
${line("Who it's for: ", target_icp)}

## The Prospect
${line('Name: ', leadName)}
${line('Title: ', leadJobTitle)}
${line('Company: ', leadCompany)}
${priorOutreachSection}
## Known Buyer Personas
Match the prospect to the single best-fit persona below, by its EXACT title. Judge fit from their title, company, and how they're replying. If none genuinely fit, use null — do not force a match.
${personaList}

## Your Task
Analyze the prospect's latest reply together with the conversation so far, then return ONLY this JSON object:
{
  "intent": one of 'interested', 'not_interested', 'referral', 'out_of_office', 'bounce', 'needs_more_info', 'unknown',
  "intent_confidence": a float from 0.00 to 1.00,
  "is_objection": boolean — true if the reply pushes back or raises a concern (price, timing, "we already use X", skepticism, "not the right time") rather than giving a clean yes or a flat no. A reply can be not_interested OR needs_more_info AND still be an objection.
  "prospect_read": {
    "seniority": one of "exec", "mid", "ic", "unknown",
    "buying_role": one of "decision_maker", "influencer", "end_user", "unknown",
    "matched_persona": the EXACT title of the best-fit persona above, or null,
    "suggested_angle": "one sentence — the specific angle to take with this person"
  }
}

Classification rules:
- 'interested' = any genuine buying signal (wants to talk, asks about booking, positive engagement).
- 'needs_more_info' = engaged but asking a question before committing.
- 'not_interested' = a real no. If it's a soft no with a reason, set is_objection true.
- 'referral' = pointing you to someone else.
- 'out_of_office' / 'bounce' = auto-replies / delivery failures.
- 'unknown' = genuinely unclear.

Return ONLY valid JSON. No markdown fences. No explanation.`;

    const call1SystemPromptHash = await sha256Hex(call1SystemPrompt);

    let call1: { json: any; retried: boolean; usage: { input_tokens: number; output_tokens: number }; ms: number } | null = null;
    try {
      call1 = await callAnthropicJSON({
        apiKey: anthropicApiKey,
        systemPrompt: call1SystemPrompt,
        messages,
        temperature: 0,
        maxTokens: 500,
      });
      console.log(`[classify-reply] Call 1 done +${Date.now() - t0}ms (intent=${call1.json?.intent}, persona=${call1.json?.prospect_read?.matched_persona ?? 'none'}, retried=${call1.retried})`);
    } catch (call1Err) {
      console.error('[classify-reply] Call 1 (classify) failed:', (call1Err as Error)?.message);
    }

    // Call 1 failure → cannot proceed without intent. Log + return SAFE_FALLBACK.
    if (!call1) {
      if (lead_id) {
        try {
          await supabase.from('agent_activity').insert({
            user_id,
            lead_id,
            activity_type: 'draft_created',
            description: 'Draft generation failed — needs manual review',
            metadata: { parse_failed: true, prompt_version: promptVersion, channel, call1_failed: true },
          });
        } catch (e) {
          console.error('[classify-reply] call1-failed activity insert failed (non-fatal):', e);
        }
      }
      try {
        await supabase.from('draft_audit').insert({
          user_id,
          lead_id: lead_id ?? null,
          lead_name: leadName,
          lead_company: leadCompany,
          channel,
          model: MODEL,
          prompt_version: promptVersion,
          temperature: 0,
          system_prompt_hash: call1SystemPromptHash,
          input_tokens: null,
          output_tokens: null,
          generation_ms: null,
          intent_classified: null,
          intent_confidence: null,
          draft_response: null,
          metadata: { two_call: true, call1_failed: true, call1_system_prompt_hash: call1SystemPromptHash },
        });
      } catch (e) {
        console.error('[classify-reply] draft_audit (call1 fail) write failed (non-fatal):', e);
      }
      return new Response(JSON.stringify(SAFE_FALLBACK), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const intent: string = call1.json?.intent ?? 'unknown';
    const intentConfidence: number =
      typeof call1.json?.intent_confidence === 'number' ? call1.json.intent_confidence : 0;
    const isObjection: boolean = call1.json?.is_objection === true;
    const prospectRead = call1.json?.prospect_read ?? null;
    const matchedTitle: string | null = prospectRead?.matched_persona ?? null;
    const matchedPersona = matchedTitle
      ? (personas ?? []).find((p: { title: string }) => p.title === matchedTitle) ?? null
      : null;

    // ============================ CALL 2 — generate ========================
    const personaSection = matchedPersona
      ? `## Who You're Talking To
The prospect best matches this buyer persona. Use it to calibrate your positioning, the pains you speak to, and your tone. This is reference for HOW to position — it is NOT a script to copy, and you should never quote it back to the prospect:

${matchedPersona.content}`
      : '';

    const stageSection = isFirstTouch
      ? `## Conversation Stage — First Reply
This is the prospect's first reply in this thread. You have no prior rapport to lean on.
- Open warmly and acknowledge what they actually said.
- Establish relevance fast — connect to why the outreach matters to them specifically.
- Don't assume shared context or reference things that haven't been discussed yet.`
      : `## Conversation Stage — Ongoing Thread
This is part of an ongoing exchange.
- Build on what's already been said; do not re-introduce yourself or repeat earlier points.
- Pick up from where the conversation left off and move it forward.
- Reference specifics from the thread so it reads as a real, continuous conversation.`;

    let intentSection = '';
    if (isObjection && (intent === 'not_interested' || intent === 'needs_more_info')) {
      intentSection = `## How to Respond — Objection
The prospect is raising a concern, not closing the door. Handle it with the Objection Playbook above.
- Acknowledge the concern as legitimate — never dismiss or argue.
- Validate it briefly, then redirect to the value or proof that addresses it (use Case Studies if relevant).
- Stay calm and non-defensive; you're resolving a blocker, not winning a debate.
- Once you've addressed it, lower the friction to a next step — if the concern is reasonably handled, still offer the call and the calendar link, but don't steamroll a prospect who needs reassurance first.`;
    } else if (intent === 'interested') {
      intentSection = `## How to Respond — Interested
This prospect is showing genuine buying interest. Your single goal is to get a meeting on the calendar — do not soften it into an exploratory question.
- Lead straight to booking. Propose the call explicitly and confidently.
- If a calendar booking link is available in the Resources section, share it directly and invite them to grab a time.
- If no calendar link is available, propose specific times or ask for their availability directly — still drive toward a booked slot, just without the link.
- Suggest a concrete next step (e.g. a short 15–20 min call) rather than asking open-ended "would you be open to learning more?" filler.
- Do NOT bury the ask. One clear, confident call-to-action beats three soft questions.
- Keep it short — a prospect who's leaning in doesn't need a pitch, they need an easy yes.`;
    } else if (intent === 'needs_more_info') {
      intentSection = `## How to Respond — Needs More Info
Treat the question as a buying signal, not a request for a lengthy explanation. Answer it, then convert to a call — don't get stuck in back-and-forth Q&A.
- Answer their specific question directly and concisely first (one or two sentences — never dodge it).
- If the question is a simple factual one you can answer outright (a yes/no, a capability, a number), ANSWER it plainly — don't deflect a quick answer into a call. Push for the call when the honest answer is "it depends on your setup."
- Immediately bridge to a call as the best way to go deeper, and share the calendar booking link if one is available.
- Frame the call as the fastest way to get them what they need, not as another hurdle.
- Avoid answering so thoroughly that there's no reason left to talk — give enough to build confidence, then push for the booking.
- End on the ask, with the link, not on another open question.`;
    } else if (intent === 'not_interested') {
      intentSection = `## How to Respond — Not Interested
This is a genuine no, not an objection. Respect it.
- Exit gracefully and thank them for the reply.
- Leave the door open for the future without pitching, pushing, or guilt-tripping.
- Do NOT offer the calendar link or propose a call — that reads as not listening.
- Keep it short and classy. A clean, respectful close protects the brand and leaves room to re-engage later.`;
    }

    // The client's whole Agent Knowledge brief, clearly delimited. Empty doc →
    // empty string → no change to the prompt (no regression).
    const knowledgeSection = agentKnowledge
      ? `\n## Client Knowledge Brief
The client's own brief — their niche, the goal of each message, and context on each sender. Treat it as authoritative context and let it shape both what you say and the voice you say it in:
${agentKnowledge}\n`
      : '';

    const learningsSection = learnings.length > 0
      ? `## What ${effSenderName} Has Taught You
${effSenderName} has specifically taught you these lessons from past replies. Apply them — they reflect what actually works, and override generic advice where they conflict:
${learnings.map((l) => `- ${l}`).join('\n')}`
      : '';

    const call2SystemPrompt = `You are an expert B2B sales agent operating on behalf of ${effSenderName}${effSenderTitle ? `, ${effSenderTitle}` : ''} at ${company_name}.

## About ${effSenderName}
${effSenderBio || ''}
${line('LinkedIn: ', effSenderLinkedin)}
${knowledgeSection}
## The Offer
Company: ${company_name}${company_url ? ` (${company_url})` : ''}
What we sell: ${offer_description}
${line("Who it's for: ", target_icp)}
${line('Outcome we deliver: ', outcome_delivered)}
${line('Desired prospect action: ', desired_action)}
${line('Communication style: ', effCommStyle)}
${avoid_phrases && avoid_phrases.length > 0 ? 'Never say or reference: ' + avoid_phrases.join(', ') : ''}
${sample_message ? 'Writing style example (match this tone exactly):\n' + sample_message : ''}

## Resources to Reference
${line('Calendar booking link: ', calendar_link)}
${case_studies || ''}

## Pricing
${pricing_summary || 'Pricing depends on use case — direct prospects to a call rather than quoting numbers.'}

## When to Disqualify
${disqualification_criteria || 'Use judgment — politely decline if the prospect is clearly outside ICP.'}

## Objection Playbook
${objection_handling_notes || 'Acknowledge the objection, validate it, then redirect to value.'}

## About the Prospect
${line('Name: ', leadName)}
${line('Title: ', leadJobTitle)}
${line('Company: ', leadCompany)}
${line('LinkedIn: ', leadLinkedinUrl)}
${line('First contacted in: ', leadLastCampaignName)}
${priorOutreachSection}
${prospectRead?.suggested_angle ? 'Suggested angle: ' + prospectRead.suggested_angle : ''}
${personaSection ? '\n' + personaSection : ''}

${stageSection}
${intentSection ? '\n' + intentSection : ''}

## Your Core Sales Guidelines
${guidelinesText || 'No specific guidelines configured yet.'}
${learningsSection ? '\n' + learningsSection : ''}

## Relevant Templates & Frameworks
${templatesText || 'No templates available.'}
${campaignIntelligence}

## Your Task
The prospect's intent has been classified as: ${intent}${isObjection ? ' (objection-flavored)' : ''}. Generate the reply accordingly. Return ONLY this JSON object:
- suggested_response: the ideal next message (2-4 sentences, matches ${effSenderName}'s voice, grounded in the resources above. Reference the prospect by name where natural. Use the calendar link if booking a meeting. Reference case studies if it strengthens credibility.)
- reasoning: one sentence explaining your response
- should_auto_send: boolean (true ONLY if channel is email AND intent is out_of_office or bounce)
- next_pipeline_stage: one of 'replied', 'in_progress', 'call_scheduled'
  Rules: explicit agreement to a call/meeting → call_scheduled; interested/needs_more_info/not_interested → in_progress; out_of_office or bounce → replied.
  NEVER auto-close a lead: closes (Closed Won / Closed Lost), No Show, and Sent Proposal are set by the operator, not you. Leave a not-interested reply active (in_progress) — the intent field already flags the sentiment.

Return ONLY valid JSON. No markdown fences. No explanation.`;

    const call2SystemPromptHash = await sha256Hex(call2SystemPrompt);

    let call2: { json: any; retried: boolean; usage: { input_tokens: number; output_tokens: number }; ms: number } | null = null;
    try {
      call2 = await callAnthropicJSON({
        apiKey: anthropicApiKey,
        systemPrompt: call2SystemPrompt,
        messages,
        temperature: 0.5,
        maxTokens: 1000,
      });
      console.log(`[classify-reply] Call 2 done +${Date.now() - t0}ms (retried=${call2.retried})`);
    } catch (call2Err) {
      console.error('[classify-reply] Call 2 (generate) failed:', (call2Err as Error)?.message);
    }
    const call2Failed = !call2;

    // Assemble response. On Call 2 success include the draft; on failure fall
    // back to SAFE_FALLBACK's draft fields but keep Call 1's intent + read.
    let suggestedResponse = '';
    let reasoning = SAFE_FALLBACK.reasoning;
    let shouldAutoSend = false;
    let nextPipelineStage = 'replied';
    if (call2) {
      suggestedResponse = typeof call2.json?.suggested_response === 'string'
        ? stripBraceWrapper(call2.json.suggested_response)
        : '';
      reasoning = call2.json?.reasoning ?? reasoning;
      shouldAutoSend = call2.json?.should_auto_send === true;
      nextPipelineStage = call2.json?.next_pipeline_stage ?? 'replied';
    }

    const classification = {
      intent,
      intent_confidence: intentConfidence,
      is_objection: isObjection,
      prospect_read: prospectRead,
      suggested_response: suggestedResponse,
      should_auto_send: shouldAutoSend,
      reasoning,
      next_pipeline_stage: nextPipelineStage,
    };

    // Write-back: intent + prospect_read whenever Call 1 succeeded (which it
    // did to reach here); draft_response + draft_ready only on Call 2 success.
    if (lead_id) {
      try {
        const update: Record<string, unknown> = {
          intent,
          intent_confidence: intentConfidence,
          prospect_read: prospectRead,
        };
        if (!call2Failed) {
          update.draft_response = suggestedResponse;
          update.inbox_status = 'draft_ready';
        }
        // Ownership guard — .eq('user_id', user_id) prevents a JWT-authenticated
        // attacker passing an arbitrary lead_id from overwriting a victim's row.
        await supabase
          .from('agent_leads')
          .update(update)
          .eq('id', lead_id)
          .eq('user_id', user_id);

        await supabase.from('agent_activity').insert(
          !call2Failed
            ? {
                user_id,
                lead_id,
                activity_type: 'draft_created',
                description: `Draft response created — classified as ${intent} (${Math.round(intentConfidence * 100)}% confidence)`,
                metadata: {
                  intent,
                  confidence: intentConfidence,
                  channel,
                  auto_handled: shouldAutoSend,
                  matched_persona: matchedTitle,
                  is_objection: isObjection,
                },
              }
            : {
                user_id,
                lead_id,
                activity_type: 'draft_created',
                description: 'Draft generation failed — needs manual review',
                metadata: {
                  parse_failed: true,
                  prompt_version: promptVersion,
                  channel,
                  intent,
                  matched_persona: matchedTitle,
                  call2_failed: true,
                },
              },
        );

        console.log(`[classify-reply] wrote classification to agent_leads ${lead_id} +${Date.now() - t0}ms`);
      } catch (writeErr) {
        console.error('[classify-reply] failed to write to agent_leads:', writeErr);
      }
    }

    // Append-only draft telemetry. One row, combined token usage across both
    // calls. Service-role bypasses RLS. Audit-write failure never blocks.
    try {
      const c1 = call1.usage;
      const c2 = call2?.usage ?? { input_tokens: 0, output_tokens: 0 };
      await supabase.from('draft_audit').insert({
        user_id,
        lead_id: lead_id ?? null,
        lead_name: leadName,
        lead_company: leadCompany,
        channel,
        model: MODEL,
        prompt_version: promptVersion,
        temperature: 0.5,
        system_prompt_hash: call2SystemPromptHash,
        input_tokens: c1.input_tokens + c2.input_tokens,
        output_tokens: c1.output_tokens + c2.output_tokens,
        generation_ms: call2?.ms ?? null,
        intent_classified: intent,
        intent_confidence: intentConfidence,
        draft_response: suggestedResponse || null,
        metadata: {
          two_call: true,
          call1_intent: intent,
          call1_matched_persona: matchedTitle,
          call1_tokens: c1.input_tokens + c1.output_tokens,
          call2_tokens: c2.input_tokens + c2.output_tokens,
          parse_retried_call1: call1.retried,
          parse_retried_call2: call2?.retried ?? false,
          is_objection: isObjection,
          first_touch: isFirstTouch,
          learnings_count: learnings.length,
          call1_failed: false,
          call2_failed: call2Failed,
          call1_system_prompt_hash: call1SystemPromptHash,
        },
      });
    } catch (auditErr) {
      console.error('[classify-reply] draft_audit write failed (non-fatal):', auditErr);
    }

    return new Response(JSON.stringify(classification), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
    // Best-effort: record inference event (non-blocking). Fire AFTER sending response
    // semantics preserved by EdgeRuntime.waitUntil when available; otherwise try/catch.
    // Event: 'classified'
    try {
      const personKey =
        (leadEmail && leadEmail.trim() ? leadEmail.trim().toLowerCase() : '') ||
        (leadLinkedinUrl && leadLinkedinUrl.trim() ? leadLinkedinUrl.trim() : '') ||
        (lead_id ?? '');
      if (personKey) {
        const row: Record<string, unknown> = {
          team_id: teamId ?? null,
          agent_config_id: null,
          person_key: personKey,
          email: leadEmail ? leadEmail.trim().toLowerCase() : null,
          linkedin_url: leadLinkedinUrl ?? null,
          full_name: leadName,
          job_title: leadJobTitle,
          seniority: prospectRead?.seniority ?? null,
          department: null,
          company_name: leadCompany,
          industry: null,
          city: null,
          state: null,
          country: null,
          company_size: null,
          channel,
          campaign_external_id: leadCampaignExternalId ?? null,
          campaign_name: leadLastCampaignName ?? null,
          sequence_step_type: null,
          copy_fingerprint: null,
          subject: null,
          event_type: 'classified',
          intent,
          is_objection: isObjection,
          pipeline_stage: nextPipelineStage,
          disposition_tag: leadDispositionTag,
          occurred_at: new Date().toISOString(),
          source: 'classify_reply',
          source_row_id: lead_id ?? null,
          metadata: {
            intent_confidence: intentConfidence,
            matched_persona: matchedTitle,
            prospect_read: prospectRead ?? null,
          },
        };
        const write = supabase.from('inference_events')
          // @ts-ignore onConflict supports column-list; partial unique index handles non-null source_row_id
          .upsert(row, { onConflict: 'source,source_row_id,event_type' });
        // @ts-ignore EdgeRuntime provided by Supabase
        if (typeof EdgeRuntime !== 'undefined' && typeof EdgeRuntime.waitUntil === 'function') {
          // @ts-ignore
          EdgeRuntime.waitUntil(write);
        } else {
          await write;
        }
      }
    } catch (e) {
      console.warn('[classify-reply] inference_events write failed (non-fatal):', e);
    }
  } catch (error) {
    console.error('classify-reply error:', error);
    return new Response(JSON.stringify(SAFE_FALLBACK), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
