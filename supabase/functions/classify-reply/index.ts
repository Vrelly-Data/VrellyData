import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

console.log('classify-reply starting');

// === Email reply preprocessing =============================================
// Aggressive HTML / quoted-chain / signature stripping for email channel.
// Idempotent: works on already-plain-text input (HTML detection check),
// and a no-op for LinkedIn replies (only invoked when channel === 'email').
//
// Order matters: HTML → Zendesk marker → quoted chains → signatures →
// blank-line collapse. Each step trims off everything FROM the first
// matched marker onward, so signature/quote markers earlier in the text
// take precedence over later ones.
function preprocessEmailReply(text: string): string {
  if (!text) return '';
  let s = text;

  // 1. HTML strip (idempotent — skip if no tags detected)
  if (/<[a-z][^>]*>/i.test(s)) {
    s = s
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'");
  }

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
    let leadLastCampaignName: string | null = null;
    if (lead_id) {
      try {
        const { data: leadRow } = await supabase
          .from('agent_leads')
          .select('full_name, job_title, company, linkedin_url, last_campaign_name')
          .eq('id', lead_id)
          .eq('user_id', user_id)
          .maybeSingle();
        if (leadRow) {
          leadName = leadRow.full_name ?? null;
          leadJobTitle = leadRow.job_title ?? null;
          leadCompany = leadRow.company ?? null;
          leadLinkedinUrl = leadRow.linkedin_url ?? null;
          leadLastCampaignName = leadRow.last_campaign_name ?? null;
        }
      } catch (e) {
        console.warn('[classify-reply] lead context fetch failed (continuing):', e);
      }
    }

    // Render an optional sectioned line only when value is present, so empty
    // fields drop entire lines rather than rendering "Not specified".
    const line = (label: string, value: string | null | undefined) =>
      value && value.trim() ? `${label}${value}` : '';

    const promptVersion = 'phase2-v1';

    const systemPrompt = `You are an expert B2B sales agent operating on behalf of ${sender_name}${sender_title ? `, ${sender_title}` : ''} at ${company_name}.

## About ${sender_name}
${sender_bio || ''}
${line('LinkedIn: ', sender_linkedin)}

## The Offer
Company: ${company_name}${company_url ? ` (${company_url})` : ''}
What we sell: ${offer_description}
${line("Who it's for: ", target_icp)}
${line('Outcome we deliver: ', outcome_delivered)}
${line('Desired prospect action: ', desired_action)}
${line('Communication style: ', communication_style)}
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

## Your Core Sales Guidelines
${guidelinesText || 'No specific guidelines configured yet.'}

## Relevant Templates & Frameworks
${templatesText || 'No templates available.'}
${campaignIntelligence}

## Your Task
Analyze the prospect's reply and the conversation history. Return a JSON object with exactly these fields:
- intent: one of 'interested', 'not_interested', 'referral', 'out_of_office', 'bounce', 'needs_more_info', 'unknown'
- intent_confidence: float 0.00-1.00
- suggested_response: the ideal next message (2-4 sentences, matches ${sender_name}'s voice, grounded in the resources above. Reference the prospect by name where natural. Use the calendar link if booking a meeting. Reference case studies if it strengthens credibility.)
- should_auto_send: boolean (true ONLY if channel is email AND intent is out_of_office or bounce)
- reasoning: one sentence explaining your classification
- next_pipeline_stage: one of 'contacted', 'replied', 'engaged', 'meeting_booked', 'closed', 'dead'
  Rules: not_interested → dead, bounce → dead, explicit meeting agreement → meeting_booked, interested/needs_more_info → engaged, everything else → replied

Return ONLY valid JSON. No markdown fences. No explanation.`;

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

    // Anthropic requires the first message to be 'user'. Drop leading
    // assistant turns — outbound sequences naturally start with the
    // sender, but Claude needs a user-first conversation.
    const firstUserIdx = mapped.findIndex((m) => m.role === 'user');
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

    // Call Anthropic API
    const anthropicApiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!anthropicApiKey) {
      console.error('ANTHROPIC_API_KEY not set');
      return new Response(JSON.stringify(SAFE_FALLBACK), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[classify-reply] calling Anthropic API +${Date.now() - t0}ms`);

    const promptT0 = Date.now();
    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicApiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        temperature: 0.5,
        system: systemPrompt,
        messages,
      }),
    });
    const generationMs = Date.now() - promptT0;

    console.log(`[classify-reply] Anthropic responded ${anthropicRes.status} +${Date.now() - t0}ms`);

    if (!anthropicRes.ok) {
      console.error('Anthropic API error:', anthropicRes.status, await anthropicRes.text());
      return new Response(JSON.stringify(SAFE_FALLBACK), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const response = await anthropicRes.json();

    // Extract text from response
    const textBlock = response.content?.find((b: { type: string }) => b.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      console.error('No text in Claude response');
      return new Response(JSON.stringify(SAFE_FALLBACK), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Parse response JSON. One retry on parse failure — re-prompt the model
    // with the bad output as an assistant turn and a corrective user turn.
    let classification: any;
    let parseRetried = false;
    let parseFailed = false;
    try {
      classification = JSON.parse(textBlock.text);
    } catch (parseErr) {
      console.warn('[classify-reply] initial JSON parse failed, retrying once:', (parseErr as Error)?.message);
      parseRetried = true;
      try {
        const retryRes = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': anthropicApiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 1000,
            temperature: 0.5,
            system: systemPrompt,
            messages: [
              ...messages,
              { role: 'assistant', content: textBlock.text },
              { role: 'user', content: 'Your previous response was not valid JSON. Return ONLY a valid JSON object with the required fields. No markdown, no explanation, no prose.' },
            ],
          }),
        });
        if (!retryRes.ok) throw new Error(`retry HTTP ${retryRes.status}`);
        const retryJson = await retryRes.json();
        const retryText = retryJson.content?.find((b: { type: string }) => b.type === 'text');
        if (!retryText) throw new Error('retry response missing text block');
        classification = JSON.parse(retryText.text);
      } catch (retryErr) {
        console.error('[classify-reply] retry parse also failed, using SAFE_FALLBACK:', (retryErr as Error)?.message);
        parseFailed = true;
        classification = { ...SAFE_FALLBACK };
      }
    }

    // Strip the occasional `{...}` wrapper the model adds around the message
    // body. Prevents drafts like "{Absolutely! Here's my calendar link...}"
    // from being persisted (and later sent) with literal braces.
    if (typeof classification.suggested_response === 'string') {
      classification.suggested_response = stripBraceWrapper(
        classification.suggested_response,
      );
    }

    // Write classification back to agent_leads. Parse-failed runs skip the
    // write — we don't surface inbox_status='draft_ready' for a run that
    // never produced a usable draft. The parse-failed activity row below
    // is the user-visible signal that something needs manual review.
    if (lead_id && classification.intent && !parseFailed) {
      try {
        // Only these 4 fields — pipeline_stage is owned by explicit user action
        // (tag dropdown / add-to-heyreach-campaign), not the classifier.
        // Ownership check — without .eq('user_id', user_id), a JWT-authenticated
        // attacker could pass any lead_id and overwrite the victim's draft.
        await supabase
          .from('agent_leads')
          .update({
            intent: classification.intent,
            intent_confidence: classification.intent_confidence,
            draft_response: classification.suggested_response,
            inbox_status: 'draft_ready',
          })
          .eq('id', lead_id)
          .eq('user_id', user_id);

        // Log draft created activity
        await supabase.from('agent_activity').insert({
          user_id,
          lead_id,
          activity_type: 'draft_created',
          description: `Draft response created — classified as ${classification.intent} (${Math.round(classification.intent_confidence * 100)}% confidence)`,
          metadata: {
            intent: classification.intent,
            confidence: classification.intent_confidence,
            channel,
            auto_handled: classification.should_auto_send,
          },
        });

        console.log(`[classify-reply] wrote classification to agent_leads ${lead_id} +${Date.now() - t0}ms`);
      } catch (writeErr) {
        console.error('[classify-reply] failed to write to agent_leads:', writeErr);
      }
    } else if (lead_id && parseFailed) {
      try {
        await supabase.from('agent_activity').insert({
          user_id,
          lead_id,
          activity_type: 'draft_created',
          description: 'Draft generation failed — needs manual review',
          metadata: { parse_failed: true, prompt_version: promptVersion, channel },
        });
      } catch (activityErr) {
        console.error('[classify-reply] parse-failed activity insert failed (non-fatal):', activityErr);
      }
    }

    // Append-only draft telemetry. Service-role bypasses RLS. Audit-write
    // failure must never block the classification response.
    try {
      const hashBuf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(systemPrompt));
      const systemPromptHash = Array.from(new Uint8Array(hashBuf))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
      const usage = response.usage || {};
      await supabase.from('draft_audit').insert({
        user_id,
        lead_id: lead_id ?? null,
        lead_name: leadName,
        lead_company: leadCompany,
        channel,
        model: 'claude-sonnet-4-20250514',
        prompt_version: promptVersion,
        temperature: 0.5,
        system_prompt_hash: systemPromptHash,
        input_tokens: usage.input_tokens ?? null,
        output_tokens: usage.output_tokens ?? null,
        generation_ms: generationMs,
        intent_classified: classification.intent ?? null,
        intent_confidence: classification.intent_confidence ?? null,
        draft_response: classification.suggested_response ?? null,
        metadata: { parse_retried: parseRetried, parse_failed: parseFailed },
      });
    } catch (auditErr) {
      console.error('[classify-reply] draft_audit write failed (non-fatal):', auditErr);
    }

    return new Response(JSON.stringify(classification), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('classify-reply error:', error);
    return new Response(JSON.stringify(SAFE_FALLBACK), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
