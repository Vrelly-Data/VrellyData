import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const AUDIENCELAB_BASE_URL = 'https://api.audiencelab.io';

// Helper to remove undefined, null, empty strings, and empty arrays from payloads
function sanitizePayload(obj: any): any {
  if (Array.isArray(obj)) {
    const filtered = obj.filter(item => item !== undefined && item !== null && item !== '');
    return filtered.length > 0 ? filtered.map(sanitizePayload) : undefined;
  }
  
  if (obj && typeof obj === 'object') {
    const sanitized: any = {};
    for (const [key, value] of Object.entries(obj)) {
      if (value === undefined || value === null || value === '') {
        continue;
      }
      if (Array.isArray(value)) {
        const sanitizedArray = sanitizePayload(value);
        if (sanitizedArray && sanitizedArray.length > 0) {
          sanitized[key] = sanitizedArray;
        }
      } else if (typeof value === 'object') {
        const sanitizedObj = sanitizePayload(value);
        if (sanitizedObj && Object.keys(sanitizedObj).length > 0) {
          sanitized[key] = sanitizedObj;
        }
      } else {
        sanitized[key] = value;
      }
    }
    return Object.keys(sanitized).length > 0 ? sanitized : undefined;
  }
  
  return obj;
}

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
    console.log('[AudienceLab API v2] Request:', { action, params });

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

      case 'enrich': {
        const { filter, is_or_match = false, page = 1, page_size = 100 } = params;
        const sanitizedFilter = sanitizePayload(filter);
        const request_id = `req_${Date.now()}`;
        
        // Try 3 different payload shapes in order
        const payloadAttempts = [
          {
            label: 'flattened',
            body: { request_id, ...sanitizedFilter, is_or_match, page, page_size }
          },
          {
            label: 'nested_filter',
            body: { request_id, filter: sanitizedFilter, is_or_match, page, page_size }
          },
          {
            label: 'nested_filters',
            body: { request_id, filters: sanitizedFilter, is_or_match, page, page_size }
          }
        ];
        
        let lastError: any = null;
        let lastStatus = 500;
        
        for (const attempt of payloadAttempts) {
          console.log(`[AudienceLab API v2] Trying ${attempt.label} payload:`, JSON.stringify(attempt.body, null, 2));
          
          const apiResponse = await fetch(`${AUDIENCELAB_BASE_URL}/enrich`, {
            method: 'POST',
            headers: {
              'X-Api-Key': apiKey,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(attempt.body),
          });
          
          const data = await apiResponse.json();
          
          if (apiResponse.ok) {
            console.log(`[AudienceLab API v2] Success with ${attempt.label}:`, { status: apiResponse.status });
            return new Response(JSON.stringify({ ok: true, ...data }), {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
          }
          
          console.log(`[AudienceLab API v2] ${attempt.label} failed:`, { status: apiResponse.status, data });
          lastError = data;
          lastStatus = apiResponse.status;
        }
        
        // All attempts failed - return standardized error
        const errorMessage = lastError?.message || lastError?.error || 'Search failed';
        console.error('[AudienceLab API v2] All payload attempts failed:', { status: lastStatus, error: errorMessage });
        
        return new Response(JSON.stringify({
          ok: false,
          status: lastStatus,
          error: errorMessage,
          raw: lastError
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      default:
        throw new Error(`Unknown action: ${action}`);
    }

    const data = await response.json();
    console.log('AudienceLab API response:', { status: response.status, data });

    if (!response.ok) {
      console.error('AudienceLab API error:', response.status, data);
      return new Response(JSON.stringify(data), {
        status: response.status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
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
