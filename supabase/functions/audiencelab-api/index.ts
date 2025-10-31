import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const AUDIENCELAB_BASE_URL = 'https://api.audiencelab.io';

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const apiKey = Deno.env.get('AUDIENCELAB_API_KEY');
    if (!apiKey) {
      throw new Error('AUDIENCELAB_API_KEY not configured');
    }

    const { action, ...params } = await req.json();
    console.log('AudienceLab API request:', { action, params });

    let response: Response;

    switch (action) {
      case 'createAudience': {
        const { name, filters, segment, days_back } = params;
        response = await fetch(`${AUDIENCELAB_BASE_URL}/audiences`, {
          method: 'POST',
          headers: {
            'X-Api-Key': apiKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ name, filters, segment, days_back }),
        });
        break;
      }

      case 'getAudience': {
        const { audience_id, page = 1, page_size = 100 } = params;
        response = await fetch(
          `${AUDIENCELAB_BASE_URL}/audiences/${audience_id}?page=${page}&page_size=${page_size}`,
          {
            headers: { 'X-Api-Key': apiKey },
          }
        );
        break;
      }

      case 'deleteAudience': {
        const { audience_id } = params;
        response = await fetch(`${AUDIENCELAB_BASE_URL}/audiences/${audience_id}`, {
          method: 'DELETE',
          headers: { 'X-Api-Key': apiKey },
        });
        break;
      }

      case 'getAttributes': {
        const { attribute } = params;
        response = await fetch(`${AUDIENCELAB_BASE_URL}/audiences/attributes/${attribute}`, {
          headers: { 'X-Api-Key': apiKey },
        });
        break;
      }

      case 'getAllAudiences': {
        response = await fetch(`${AUDIENCELAB_BASE_URL}/audiences`, {
          headers: { 'X-Api-Key': apiKey },
        });
        break;
      }

      case 'createCustomAudience': {
        const { topic, description } = params;
        response = await fetch(`${AUDIENCELAB_BASE_URL}/audiences/custom`, {
          method: 'POST',
          headers: {
            'X-Api-Key': apiKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ topic, description }),
        });
        break;
      }

      default:
        throw new Error(`Unknown action: ${action}`);
    }

    const data = await response.json();
    console.log('AudienceLab API response:', { status: response.status, data });

    if (!response.ok) {
      throw new Error(`AudienceLab API error: ${JSON.stringify(data)}`);
    }

    return new Response(JSON.stringify(data), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error in audiencelab-api function:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
