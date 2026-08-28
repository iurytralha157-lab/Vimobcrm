import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Simple string hash for advisory lock keys
function hashCode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0; // Convert to 32bit integer
  }
  return hash;
}

// In-memory dedup: track recent submissions to prevent race conditions
const recentSubmissions = new Map<string, number>();
const DEDUP_WINDOW_MS = 10000; // 10 seconds

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  try {
    const { 
      organization_id, 
      name, 
      email, 
      phone, 
      message, 
      property_id,
      property_code,
      session_id
    } = await req.json();

    if (!organization_id || !name || !phone) {
      return new Response(
        JSON.stringify({ error: 'organization_id, name, and phone are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // In-memory dedup: reject rapid duplicate submissions
    const normalizedPhoneKey = phone.replace(/\D/g, '');
    const dedupKey = `${organization_id}:${normalizedPhoneKey}`;
    const now = Date.now();
    const lastSubmission = recentSubmissions.get(dedupKey);
    
    if (lastSubmission && (now - lastSubmission) < DEDUP_WINDOW_MS) {
      console.log(`Duplicate submission blocked for ${dedupKey} (within ${DEDUP_WINDOW_MS}ms window)`);
      return new Response(
        JSON.stringify({ success: true, message: 'Contato já registrado!', deduplicated: true }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    recentSubmissions.set(dedupKey, now);
    
    // Clean old entries periodically
    if (recentSubmissions.size > 1000) {
      for (const [key, time] of recentSubmissions) {
        if (now - time > DEDUP_WINDOW_MS) recentSubmissions.delete(key);
      }
    }

    console.log(`New contact form submission for org: ${organization_id}`);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Verify the site is active for this organization
    const { data: siteData, error: siteError } = await supabase
      .from('organization_sites')
      .select('is_active')
      .eq('organization_id', organization_id)
      .maybeSingle();

    if (siteError || !siteData?.is_active) {
      return new Response(
        JSON.stringify({ error: 'Site not found or inactive' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Fetch property data if property_id is provided
    let propertyPrice = null;
    let propertyCommission = null;

    if (property_id) {
      const { data: property } = await supabase
        .from('properties')
        .select('preco, commission_percentage')
        .eq('id', property_id)
        .eq('organization_id', organization_id)
        .maybeSingle();

      if (property) {
        propertyPrice = property.preco;
        propertyCommission = property.commission_percentage;
        console.log(`Property data found: price=${propertyPrice}, commission=${propertyCommission}`);
      }
    }

    // Normalize phone number
    const normalizedPhone = phone.replace(/\D/g, '');

    // Check if lead already exists with this phone (with multiple format variations)
    const phoneVariations = [normalizedPhone];
    // Also check with country code prefix
    if (!normalizedPhone.startsWith('55') && normalizedPhone.length <= 11) {
      phoneVariations.push('55' + normalizedPhone);
    }
    if (normalizedPhone.startsWith('55') && normalizedPhone.length > 11) {
      phoneVariations.push(normalizedPhone.substring(2));
    }

    const { data: existingLeads } = await supabase
      .from('leads')
      .select('id')
      .eq('organization_id', organization_id)
      .in('phone', phoneVariations)
      .limit(1);
    
    const existingLead = existingLeads?.[0] || null;

    let leadId: string;

    if (existingLead) {
      // Update existing lead with new message
      leadId = existingLead.id;

      const leadUpdateData: Record<string, unknown> = {};

      // Update property interest data if a new property was specified
      if (property_id) {
        leadUpdateData.interest_property_id = property_id;
        leadUpdateData.valor_interesse = propertyPrice;
        leadUpdateData.commission_percentage = propertyCommission;
      }

      if (session_id) {
        leadUpdateData.visitor_session_id = session_id;
      }

      if (Object.keys(leadUpdateData).length > 0) {
        await supabase
          .from('leads')
          .update(leadUpdateData)
          .eq('id', leadId);

        console.log(`Updated existing lead ${leadId} with property data`);
      }
      
      // Add activity for the new contact
      await supabase
        .from('activities')
        .insert({
          lead_id: leadId,
          type: 'note',
          content: `Nova mensagem do site: ${message || 'Sem mensagem'}${property_code ? ` (Imóvel: ${property_code})` : ''}`
        });

      console.log(`Updated existing lead: ${leadId}`);
    } else {
      // Create lead WITHOUT assigned_user_id so that the DB trigger
      // `trigger_handle_lead_intake` fires and respects distribution rules.
      // The trigger `ensure_lead_has_pipeline` will assign default pipeline/stage.
      const leadData: Record<string, unknown> = {
        organization_id: organization_id,
        pipeline_id: null,          // Will be set by ensure_lead_has_pipeline trigger or handle_lead_intake
        stage_id: null,             // Will be set by ensure_lead_has_pipeline trigger or handle_lead_intake
        assigned_user_id: null,     // NULL so handle_lead_intake runs distribution
        name: name,
        email: email || null,
        phone: normalizedPhone,
        message: message || null,
        source: 'website',
        deal_status: 'open',
        interest_property_id: property_id || null,
        valor_interesse: propertyPrice,
        commission_percentage: propertyCommission,
      };

      // Only include visitor_session_id if provided (column may not exist yet)
      if (session_id) {
        leadData.visitor_session_id = session_id;
      }

      let newLead;
      let leadError;

      // Try inserting with visitor_session_id first
      ({ data: newLead, error: leadError } = await supabase
        .from('leads')
        .insert(leadData)
        .select('id')
        .single());

      // If it fails due to missing column, retry without visitor_session_id
      if (leadError && session_id) {
        console.log('Retrying lead insert without visitor_session_id (column may not exist yet)');
        delete leadData.visitor_session_id;
        ({ data: newLead, error: leadError } = await supabase
          .from('leads')
          .insert(leadData)
          .select('id')
          .single());
      }

      if (leadError) {
        console.error('Error creating lead:', leadError);
        return new Response(
          JSON.stringify({ error: 'Failed to create lead' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      leadId = (newLead as any)?.id;

      if (session_id) {
        const { error: sessionUpdateError } = await supabase
          .from('leads')
          .update({ visitor_session_id: session_id })
          .eq('id', leadId);

        if (sessionUpdateError) {
          console.error('Error persisting visitor_session_id after lead creation:', sessionUpdateError);
        }
      }

      // Log activity
      await supabase
        .from('activities')
        .insert({
          lead_id: leadId,
          type: 'lead_created',
          content: `Lead criado via site${property_code ? ` (Imóvel: ${property_code})` : ''}`
        });

      console.log(`Created new lead: ${leadId}. Distribution will be handled by DB trigger (trigger_handle_lead_intake).`);

      // The DB trigger `trigger_handle_lead_intake` fires on INSERT when assigned_user_id IS NULL.
      // It calls handle_lead_intake() which handles round-robin distribution automatically.
      // If no distribution queue matches, handle_lead_intake assigns to the first admin as fallback.
    }

    // Create notification via Dispatcher
    const { data: currentLead } = await supabase
      .from('leads')
      .select('assigned_user_id')
      .eq('id', leadId)
      .single();

    if (currentLead?.assigned_user_id) {
      await fetch(`${supabaseUrl}/functions/v1/notification-dispatcher`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${supabaseServiceKey}`,
        },
        body: JSON.stringify({
          event_key: "new_lead_received",
          organization_id: organization_id,
          user_id: currentLead.assigned_user_id,
          lead_id: leadId,
          variables: {
            nome: name,
            imovel: property_code || 'Geral'
          },
          dedupe_key: `new_lead:${leadId}`
        }),
      });
    }

    // Also notify other admins if they weren't the assigned user
    const { data: admins } = await supabase
      .from('users')
      .select('id')
      .eq('organization_id', organization_id)
      .eq('role', 'admin')
      .eq('is_active', true)
      .neq('id', currentLead?.assigned_user_id || '00000000-0000-0000-0000-000000000000');

    if (admins && admins.length > 0) {
      for (const admin of admins) {
        await fetch(`${supabaseUrl}/functions/v1/notification-dispatcher`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${supabaseServiceKey}`,
          },
          body: JSON.stringify({
            event_key: "new_lead_received",
            organization_id: organization_id,
            user_id: admin.id,
            lead_id: leadId,
            variables: {
              nome: name,
              imovel: property_code || 'Geral'
            },
            dedupe_key: `new_lead:${leadId}:${admin.id}`
          }),
        });
      }
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: 'Contato enviado com sucesso!',
        lead_id: leadId
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
