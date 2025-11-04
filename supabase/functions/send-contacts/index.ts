import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: {
          headers: { Authorization: req.headers.get('Authorization')! },
        },
      }
    );

    // Verify user is authenticated
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      console.error('Authentication error:', authError);
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { project_id, campaign_id, contact_ids } = await req.json();

    if (!project_id || !contact_ids || !Array.isArray(contact_ids)) {
      return new Response(
        JSON.stringify({ error: 'project_id and contact_ids required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get project configuration
    const { data: project, error: projectError } = await supabase
      .from('external_projects')
      .select('*')
      .eq('id', project_id)
      .single();

    if (projectError || !project) {
      console.error('Project not found:', projectError);
      return new Response(
        JSON.stringify({ error: 'Project not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!project.is_active) {
      return new Response(
        JSON.stringify({ error: 'Project is not active' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get campaign field mappings if campaign_id provided
    let fieldMappings = {};
    if (campaign_id) {
      const { data: campaign, error: campaignError } = await supabase
        .from('external_campaigns')
        .select('field_mappings')
        .eq('id', campaign_id)
        .single();

      if (campaignError) {
        console.error('Campaign error:', campaignError);
      } else {
        fieldMappings = campaign.field_mappings || {};
      }
    }

    // Fetch contacts from list_items based on contact_ids
    const { data: contacts, error: contactsError } = await supabase
      .from('list_items')
      .select('entity_data, entity_external_id')
      .in('id', contact_ids);

    if (contactsError || !contacts) {
      console.error('Error fetching contacts:', contactsError);
      return new Response(
        JSON.stringify({ error: 'Failed to fetch contacts' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Apply field mappings to contacts
    const mappedContacts = contacts.map(contact => {
      const data = contact.entity_data;
      const mapped: any = {};
      
      // Apply field mappings
      Object.keys(fieldMappings).forEach(sourceField => {
        const targetField = fieldMappings[sourceField];
        if (data[sourceField] !== undefined) {
          mapped[targetField] = data[sourceField];
        }
      });

      // If no mappings, use original data
      return Object.keys(mapped).length > 0 ? mapped : data;
    });

    // Send to external project
    const response = await fetch(project.api_endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': project.api_key_encrypted, // In production, decrypt this
      },
      body: JSON.stringify({
        contacts: mappedContacts,
        campaign_id: campaign_id || null,
        source_project: 'vrelly'
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('External API error:', errorText);
      return new Response(
        JSON.stringify({ error: 'Failed to send contacts to external project' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const result = await response.json();

    // Update last_synced_at for campaign
    if (campaign_id) {
      await supabase
        .from('external_campaigns')
        .update({ last_synced_at: new Date().toISOString() })
        .eq('id', campaign_id);
    }

    console.log(`Successfully sent ${contacts.length} contacts to ${project.name}`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        sent: contacts.length,
        result 
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in send-contacts:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});