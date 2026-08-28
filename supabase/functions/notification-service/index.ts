import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { templateSlug, organizationId, userId, recipient, variables, leadId } = await req.json();

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    console.log(`[NotificationService] Sending template: ${templateSlug} to org: ${organizationId}`);

    // 1. Fetch template
    const { data: template, error: templateError } = await supabase
      .from('notification_templates')
      .select('*')
      .eq('slug', templateSlug)
      .eq('is_active', true)
      .maybeSingle();

    if (templateError || !template) {
      console.error(`[NotificationService] Template ${templateSlug} not found or inactive.`);
      return new Response(JSON.stringify({ success: false, error: 'Template not found' }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 2. Format message and title
    let formattedMessage = template.message;
    let formattedTitle = template.title || '';

    if (variables) {
      Object.entries(variables).forEach(([key, value]) => {
        const placeholder = `{${key}}`;
        formattedMessage = formattedMessage.replace(new RegExp(placeholder, 'g'), String(value));
        if (formattedTitle) {
          formattedTitle = formattedTitle.replace(new RegExp(placeholder, 'g'), String(value));
        }
      });
    }

    // 3. Dispatch
    let result: any = { success: false };

    if (template.channel === 'system' && userId) {
      const { error } = await supabase.from('notifications').insert({
        user_id: userId,
        organization_id: organizationId,
        title: formattedTitle || template.name,
        content: formattedMessage,
        type: template.category || 'info',
        lead_id: leadId || null,
        is_read: false,
      });
      result = { success: !error, error };
    } else if (template.channel === 'whatsapp') {
      const resp = await fetch(`${SUPABASE_URL}/functions/v1/whatsapp-notifier`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        },
        body: JSON.stringify({
          organization_id: organizationId,
          user_id: userId,
          phone: recipient,
          message: formattedMessage,
          lead_id: leadId || null,
        }),
      });
      result = { success: resp.ok };
    } else if (template.channel === 'push' && userId) {
      const resp = await fetch(`${SUPABASE_URL}/functions/v1/send-push`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        },
        body: JSON.stringify({
          user_id: userId,
          title: formattedTitle || template.name,
          body: formattedMessage,
          data: { lead_id: leadId }
        }),
      });
      result = { success: resp.ok };
    }

    // 4. Log
    await supabase.from('notification_logs').insert({
      template_id: template.id,
      organization_id: organizationId,
      user_id: userId,
      recipient: recipient || userId || 'system',
      channel: template.channel,
      payload: { variables, formattedTitle, formattedMessage },
      response: result,
      status: result.success ? 'sent' : 'failed',
      error: result.error ? String(result.error) : null
    });

    return new Response(JSON.stringify(result), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (error) {
    console.error("Notification Service Error:", error);
    return new Response(JSON.stringify({ success: false, error: error.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
