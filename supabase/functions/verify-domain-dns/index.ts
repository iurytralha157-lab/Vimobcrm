import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const LOVABLE_IP = '185.158.133.1';

interface DnsRecord {
  type: string;
  name: string;
  data: string;
  TTL?: number;
}

async function checkDns(domain: string): Promise<{ verified: boolean; records: DnsRecord[]; error?: string }> {
  try {
    const cleanDomain = domain
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .replace(/\/$/, '');

    console.log(`Checking DNS for domain: ${cleanDomain}`);

    const response = await fetch(`https://dns.google/resolve?name=${cleanDomain}&type=A`, {
      headers: { 'Accept': 'application/dns-json' }
    });

    if (!response.ok) {
      console.error(`DNS lookup failed with status: ${response.status}`);
      return { verified: false, records: [], error: 'DNS lookup failed' };
    }

    const data = await response.json();
    console.log('DNS response:', JSON.stringify(data));

    const records: DnsRecord[] = [];
    
    if (data.Answer) {
      for (const answer of data.Answer) {
        if (answer.type === 1) {
          records.push({
            type: 'A',
            name: answer.name,
            data: answer.data,
            TTL: answer.TTL
          });
        }
      }
    }

    const verified = records.some(r => r.data === LOVABLE_IP);
    console.log(`Domain ${cleanDomain} DNS verification: ${verified}`, records);

    return { verified, records };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error checking DNS:', error);
    return { verified: false, records: [], error: errorMessage };
  }
}

async function checkWorkerProxy(domain: string, supabaseUrl: string, supabaseServiceKey: string): Promise<boolean> {
  try {
    const cleanDomain = domain
      .replace(/^https?:\/\//, '')
      .replace(/\/$/, '');

    console.log(`Checking Worker proxy for domain: ${cleanDomain}`);

    // Check if the domain is configured in organization_sites
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const { data } = await supabase
      .from('organization_sites')
      .select('subdomain')
      .or(`custom_domain.eq.${cleanDomain},custom_domain.eq.${cleanDomain.replace(/^www\./, '')}`)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle();

    if (!data?.subdomain) {
      console.log('No matching site config found for worker check');
      return false;
    }

    // Try to fetch the domain to see if it responds (Worker proxy check)
    try {
      const probeResponse = await fetch(`https://${cleanDomain}`, {
        method: 'HEAD',
        redirect: 'follow',
      });
      console.log(`Worker probe response status: ${probeResponse.status}`);
      // If we get any response (even 404), the Worker is likely active
      return probeResponse.status < 500;
    } catch {
      console.log('Worker probe failed - domain may not be configured yet');
      return false;
    }
  } catch (error) {
    console.error('Error checking worker proxy:', error);
    return false;
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { domain, organization_id, check_all } = await req.json();

    // Batch verification for cron
    if (check_all) {
      console.log('Checking all pending domains...');
      
      const { data: pendingSites, error: fetchError } = await supabase
        .from('organization_sites')
        .select('id, organization_id, custom_domain')
        .not('custom_domain', 'is', null)
        .eq('domain_verified', false);

      if (fetchError) throw fetchError;

      console.log(`Found ${pendingSites?.length || 0} pending domains`);

      const results = [];
      for (const site of pendingSites || []) {
        if (!site.custom_domain) continue;

        const dnsResult = await checkDns(site.custom_domain);
        let verified = dnsResult.verified;

        // If DNS check fails, try worker proxy check
        if (!verified) {
          verified = await checkWorkerProxy(site.custom_domain, supabaseUrl, supabaseServiceKey);
        }
        
        if (verified) {
          await supabase
            .from('organization_sites')
            .update({
              domain_verified: true,
              domain_verified_at: new Date().toISOString()
            })
            .eq('id', site.id);

          console.log(`Domain ${site.custom_domain} verified successfully`);
        }

        results.push({
          domain: site.custom_domain,
          verified,
          records: dnsResult.records
        });
      }

      return new Response(JSON.stringify({ success: true, results }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Single domain verification
    if (!domain) {
      return new Response(JSON.stringify({ error: 'Domain is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const dnsResult = await checkDns(domain);
    let verified = dnsResult.verified;

    // If DNS doesn't point to Lovable IP, check Worker proxy
    if (!verified) {
      verified = await checkWorkerProxy(domain, supabaseUrl, supabaseServiceKey);
    }

    // Update DB if verified
    if (organization_id && verified) {
      await supabase
        .from('organization_sites')
        .update({
          domain_verified: true,
          domain_verified_at: new Date().toISOString()
        })
        .eq('organization_id', organization_id)
        .eq('custom_domain', domain);
    }

    return new Response(JSON.stringify({
      domain,
      verified,
      records: dnsResult.records,
      expected_ip: LOVABLE_IP,
      error: dnsResult.error
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error in verify-domain-dns:', error);
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
