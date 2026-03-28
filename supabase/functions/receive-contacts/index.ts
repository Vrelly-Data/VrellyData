import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const allowedOrigins = [
  Deno.env.get('ALLOWED_ORIGIN') || 'https://vrelly.com',
  'https://www.vrelly.com',
];

function getCorsHeaders(req: Request) {
  const origin = req.headers.get('Origin') || '';
  return {
    'Access-Control-Allow-Origin': allowedOrigins.includes(origin) ? origin : allowedOrigins[0],
    'Access-Control-Allow-Headers':
      'authorization, x-client-info, apikey, content-type, x-api-key',
  };
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Verify API key
    const apiKey = req.headers.get('x-api-key');
    if (!apiKey) {
      console.error('No API key provided');
      return new Response(
        JSON.stringify({ error: 'API key required' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Hash the API key and verify it
    const encoder = new TextEncoder();
    const data = encoder.encode(apiKey);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const keyHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

    const { data: apiKeyData, error: apiKeyError } = await supabase
      .from('api_keys')
      .select('team_id, is_active')
      .eq('key_hash', keyHash)
      .single();

    if (apiKeyError || !apiKeyData || !apiKeyData.is_active) {
      console.error('Invalid or inactive API key', apiKeyError);
      return new Response(
        JSON.stringify({ error: 'Invalid API key' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Update last_used_at
    await supabase
      .from('api_keys')
      .update({ last_used_at: new Date().toISOString() })
      .eq('key_hash', keyHash);

    // Parse request body
    const { contacts, campaign_id, source_project } = await req.json();

    if (!contacts || !Array.isArray(contacts) || contacts.length === 0) {
      console.error('Invalid contacts data');
      return new Response(
        JSON.stringify({ error: 'Contacts array required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Verify campaign exists and is active
    if (campaign_id) {
      const { data: campaign, error: campaignError } = await supabase
        .from('campaigns')
        .select('id, is_active')
        .eq('id', campaign_id)
        .eq('team_id', apiKeyData.team_id)
        .single();

      if (campaignError || !campaign || !campaign.is_active) {
        console.error('Invalid or inactive campaign', campaignError);
        return new Response(
          JSON.stringify({ error: 'Invalid campaign' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // Insert contacts into received_contacts table
    const contactsToInsert = contacts.map(contact => ({
      team_id: apiKeyData.team_id,
      campaign_id: campaign_id || null,
      contact_data: contact,
      source_project: source_project || 'unknown',
      status: 'pending'
    }));

    const { data: insertedContacts, error: insertError } = await supabase
      .from('received_contacts')
      .insert(contactsToInsert)
      .select();

    if (insertError) {
      console.error('Error inserting contacts:', insertError);
      return new Response(
        JSON.stringify({ error: 'Failed to save contacts' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Successfully received ${contacts.length} contacts for team ${apiKeyData.team_id}`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        received: contacts.length,
        contacts: insertedContacts
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in receive-contacts:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});