import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const cacheHeaders = {
  ...corsHeaders,
  'Cache-Control': 'public, max-age=300, s-maxage=600, stale-while-revalidate=3600',
};

const BILLING_BLOCKED_STATUSES = new Set([
  'suspended',
  'suspenso',
  'pending_payment',
  'overdue',
  'past_due',
  'blocked',
  'cancelled',
  'canceled',
  'cancelado',
  'cancelada',
]);

function isBlockedOrganization(organization: any) {
  return (
    organization?.is_active === false ||
    BILLING_BLOCKED_STATUSES.has(String(organization?.subscription_status || '').toLowerCase())
  );
}

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

    console.log(`Resolving domain: ${domain}`);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const cleanDomain = domain.toLowerCase().trim();
    const bareDomain = cleanDomain.replace(/^www\./, '');
    const wwwDomain = `www.${bareDomain}`;

    // Direct lookup by custom_domain — try all variants (with/without www)
    const { data: directMatch, error: directError } = await supabase
      .from('organization_sites')
      .select('*, organizations(name, subscription_status, is_active)')
      .or(`custom_domain.eq.${cleanDomain},custom_domain.eq.${bareDomain},custom_domain.eq.${wwwDomain}`)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle();

    if (directError) {
      console.error('Error in direct lookup:', directError);
    }

    if (directMatch) {
      const directOrganization = (directMatch as any).organizations;
      if (isBlockedOrganization(directOrganization)) {
        return new Response(
          JSON.stringify({
            error: 'site_blocked',
            found: false,
            message: 'Este site esta temporariamente fora do ar.',
          }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      console.log(`Domain resolved via direct lookup: ${domain} -> org: ${directMatch.organization_id}`);
      
      const { organization_id, subdomain, organizations, id, is_active, domain_verified, domain_verified_at, created_at, updated_at, ...siteFields } = directMatch;
      const orgName = (organizations as any)?.name || null;
      
      return new Response(
        JSON.stringify({
          found: true,
          organization_id,
          subdomain,
          site_config: {
            ...siteFields,
            organization_name: orgName,
          },
        }),
        { headers: { ...cacheHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Fallback to RPC
    const { data, error } = await supabase.rpc('resolve_site_domain', {
      p_domain: bareDomain
    });

    if (error) {
      console.error('Error resolving domain:', error);
      return new Response(
        JSON.stringify({ error: 'Failed to resolve domain' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!data || data.length === 0) {
      console.log(`Domain not found: ${domain}`);
      return new Response(
        JSON.stringify({ error: 'Site not found', found: false }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const siteData = data[0];
    console.log(`Domain resolved via RPC: ${domain} -> org: ${siteData.organization_id}`);

    const { data: organizationAccess, error: organizationAccessError } = await supabase
      .from('organizations')
      .select('is_active, subscription_status')
      .eq('id', siteData.organization_id)
      .maybeSingle();

    if (organizationAccessError || !organizationAccess || isBlockedOrganization(organizationAccess)) {
      return new Response(
        JSON.stringify({
          error: 'site_blocked',
          found: false,
          message: 'Este site esta temporariamente fora do ar.',
        }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({
        found: true,
        organization_id: siteData.organization_id,
        subdomain: siteData.subdomain || null,
        site_config: siteData.site_config
      }),
      { headers: { ...cacheHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
