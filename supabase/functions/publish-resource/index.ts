import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Authenticate using API key from Authorization header or X-API-Key header
    const authHeader = req.headers.get('Authorization') || '';
    const xApiKey = req.headers.get('X-API-Key') || '';
    const providedKey = xApiKey || authHeader.replace('Bearer ', '').trim();

    if (!providedKey) {
      return new Response(JSON.stringify({ error: 'Missing API key' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Hash the provided key and check against stored hashes
    const encoder = new TextEncoder();
    const data = encoder.encode(providedKey);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const keyHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

    const { data: apiKey, error: keyError } = await supabase
      .from('resource_api_keys')
      .select('id, is_active')
      .eq('key_hash', keyHash)
      .single();

    if (keyError || !apiKey || !apiKey.is_active) {
      return new Response(JSON.stringify({ error: 'Invalid or inactive API key' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Update last_used_at
    await supabase
      .from('resource_api_keys')
      .update({ last_used_at: new Date().toISOString() })
      .eq('id', apiKey.id);

    const body = await req.json();
    const { slug, title, meta_description, content_markdown, excerpt, tags, author, cover_image_url, is_published } = body;

    if (!slug || !title || !content_markdown) {
      return new Response(JSON.stringify({ error: 'slug, title, and content_markdown are required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Upsert the resource (insert or update by slug)
    const { data: resource, error: upsertError } = await supabase
      .from('resources')
      .upsert({
        slug,
        title,
        meta_description: meta_description || null,
        content_markdown,
        excerpt: excerpt || null,
        tags: tags || [],
        author: author || 'Vrelly Team',
        cover_image_url: cover_image_url || null,
        is_published: is_published ?? true,
        published_at: is_published !== false ? new Date().toISOString() : null,
      }, { onConflict: 'slug' })
      .select()
      .single();

    if (upsertError) {
      console.error('Upsert error:', upsertError);
      return new Response(JSON.stringify({ error: upsertError.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ success: true, resource }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
