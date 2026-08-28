import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { domain } = await req.json();

    if (!domain) {
      return new Response(
        JSON.stringify({ error: 'Domain is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const cleanDomain = domain.toLowerCase().trim().replace(/^www\./, '');

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Try exact match first, then without www
    const { data, error } = await supabase
      .from('organization_sites')
      .select('subdomain, custom_domain')
      .or(`custom_domain.eq.${domain.toLowerCase().trim()},custom_domain.eq.${cleanDomain},custom_domain.eq.www.${cleanDomain}`)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error('Error looking up domain:', error);
      return new Response(
        JSON.stringify({ error: 'Lookup failed' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!data || !data.subdomain) {
      return new Response(
        JSON.stringify({ error: 'Domain not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Also fetch site meta info for OG tags
    const { data: siteData } = await supabase
      .from('organization_sites')
      .select('site_title, site_description, seo_title, seo_description, seo_keywords, logo_url, favicon_url, hero_image_url, about_image_url, gtm_id, meta_pixel_id, head_scripts, body_scripts, organizations(name)')
      .eq('subdomain', data.subdomain)
      .eq('is_active', true)
      .maybeSingle();

    const orgName = (siteData?.organizations as any)?.name || '';
    const meta = siteData ? {
      title: siteData.seo_title || siteData.site_title || orgName || 'Site Imobiliário',
      description: siteData.seo_description || siteData.site_description || '',
      image: siteData.logo_url || siteData.favicon_url || siteData.about_image_url || siteData.hero_image_url || '',
      favicon: siteData.favicon_url || siteData.logo_url || '',
    } : null;

    return new Response(
      JSON.stringify({
        slug: data.subdomain,
        target: 'vimobe.lovable.app',
        meta,
        ssr_url: `${Deno.env.get('SUPABASE_URL')}/functions/v1/public-site-ssr`,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
