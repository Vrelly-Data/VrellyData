import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

console.log('classify-reply starting');

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
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      authUserId = user.id;
    } else {
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
      return new Response(JSON.stringify({ error: 'Missing required fields' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
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
        .eq('platform', 'reply.io')
        .eq('is_active', true)
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
      sender_bio,
      company_name,
      company_url,
      communication_style,
      avoid_phrases,
      sample_message,
    } = agent_context;

    // Build system prompt
    const systemPrompt = `You are an expert B2B sales agent operating on behalf of ${sender_name}, ${sender_title} at ${company_name}.

## Your Core Sales Guidelines
${guidelinesText || 'No specific guidelines configured yet.'}

## Relevant Templates & Frameworks
${templatesText || 'No templates available.'}
${campaignIntelligence}

## About ${sender_name}
${sender_bio || 'No bio provided.'}

## The Offer
Company: ${company_name} (${company_url || 'no URL'})
What we sell: ${offer_description}
Who it's for: ${target_icp || 'Not specified'}
Outcome we deliver: ${outcome_delivered || 'Not specified'}
Desired prospect action: ${desired_action || 'Not specified'}
Communication style: ${communication_style || 'conversational'}
${avoid_phrases && avoid_phrases.length > 0 ? 'Never say or reference: ' + avoid_phrases.join(', ') : ''}
${sample_message ? 'Writing style example (match this tone exactly):\n' + sample_message : ''}

## Your Task
Analyze the prospect's reply and conversation history.
Return a JSON object with exactly these fields:
- intent: one of 'interested', 'not_interested', 'referral', 'out_of_office', 'bounce', 'needs_more_info', 'unknown'
- intent_confidence: float 0.00-1.00
- suggested_response: the ideal next message (2-4 sentences, matches ${sender_name}'s voice and communication style, grounded in the sales guidelines above)
- should_auto_send: boolean (true ONLY if channel is email AND intent is out_of_office or bounce)
- reasoning: one sentence explaining your classification
- next_pipeline_stage: one of 'contacted', 'replied', 'engaged', 'meeting_booked', 'closed', 'dead'
  Rules: not_interested → dead, bounce → dead, explicit meeting agreement → meeting_booked, interested/needs_more_info → engaged, everything else → replied

Return ONLY valid JSON. No markdown fences. No explanation.`;

    const userMessage = `Channel: ${channel}
Prospect reply: ${reply_text}
Conversation history: ${JSON.stringify(thread_history || [])}
Analyze this reply and respond as instructed.`;

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
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      }),
    });

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

    // Parse response JSON
    const classification = JSON.parse(textBlock.text);

    // Write classification back to agent_leads
    if (lead_id && classification.intent) {
      try {
        await supabase
          .from('agent_leads')
          .update({
            intent: classification.intent,
            intent_confidence: classification.intent_confidence,
            draft_response: classification.suggested_response,
            pipeline_stage: classification.next_pipeline_stage,
            inbox_status: classification.should_auto_send ? 'sent' : 'draft_ready',
            auto_handled: classification.should_auto_send,
          })
          .eq('id', lead_id);

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
