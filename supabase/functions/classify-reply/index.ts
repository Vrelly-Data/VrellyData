import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Anthropic from 'https://esm.sh/@anthropic-ai/sdk@0.39.0';

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
  intent: 'unknown' as const,
  intent_confidence: 0,
  suggested_response: '',
  should_auto_send: false,
  reasoning: 'Classification failed - needs manual review',
  next_pipeline_stage: 'replied' as const,
};

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Auth: x-agent-key header
    const agentKey = req.headers.get('x-agent-key');
    const expectedKey = Deno.env.get('AGENT_API_KEY');
    if (!expectedKey || agentKey !== expectedKey) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json();
    const {
      reply_text,
      thread_history,
      agent_context,
      channel,
      user_id,
    } = body;

    if (!reply_text || !agent_context || !channel || !user_id) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Create Supabase client with service role key
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
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

    const anthropic = new Anthropic({ apiKey: anthropicApiKey });

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    });

    // Extract text from response
    const textBlock = response.content.find((b: { type: string }) => b.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      console.error('No text in Claude response');
      return new Response(JSON.stringify(SAFE_FALLBACK), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Parse response JSON
    const classification = JSON.parse(textBlock.text);

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
