import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface DispatchParams {
  event_key: string;
  organization_id: string;
  user_id?: string;
  recipient?: string;
  variables: Record<string, any>;
  dedupe_key?: string;
  lead_id?: string;
  is_test?: boolean;
}

const LEAD_PHONE_KEYS = new Set([
  "phone",
  "telefone",
  "whatsapp",
  "lead_phone",
  "leadphone",
  "lead_whatsapp",
  "leadwhatsapp",
  "phone_line",
  "phoneline",
  "contact_phone",
  "contactphone",
  "client_phone",
  "clientphone",
]);

function isLeadScopedNotification(eventKey: string, leadId?: string) {
  return Boolean(leadId) || eventKey.toLowerCase().includes("lead");
}

function sanitizeLeadVariables(variables: Record<string, any>, eventKey: string, leadId?: string) {
  if (!isLeadScopedNotification(eventKey, leadId)) return { ...variables };

  return Object.entries(variables || {}).reduce((acc, [key, value]) => {
    const normalizedKey = key.replace(/[^a-z0-9]/gi, "").toLowerCase();
    if (LEAD_PHONE_KEYS.has(normalizedKey)) {
      acc[key] = "";
      return acc;
    }
    acc[key] = value;
    return acc;
  }, {} as Record<string, any>);
}

function scrubLeadPhoneText(value: string, eventKey: string, leadId?: string) {
  if (!isLeadScopedNotification(eventKey, leadId) || !value) return value;

  return value
    .split("\n")
    .filter((line) => !/^\s*(telefone|celular|whats(?:app)?|phone)\s*:/i.test(line))
    .join("\n")
    .replace(/\b(?:\+?55\s*)?(?:\(?\d{2}\)?\s*)?9?\d{4}[-\s]?\d{4}\b/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const params: DispatchParams = await req.json();
    const { event_key, organization_id, user_id, recipient, variables, dedupe_key, lead_id, is_test } = params;
    const safeVariables = sanitizeLeadVariables(variables || {}, event_key, lead_id);

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    console.log(`[NotificationDispatcher] Processing event: ${event_key} for org: ${organization_id}`);

    // 1. Fetch template by event_key or slug
    const { data: template, error: templateError } = await supabase
      .from('notification_templates')
      .select('*')
      .or(`event_key.eq.${event_key},slug.eq.${event_key}`)
      .eq('is_active', true)
      .maybeSingle();

    if (templateError || !template) {
      // Se não encontrou template ativo, logar e retornar erro silencioso para não quebrar fluxos
      console.warn(`[NotificationDispatcher] Template for event ${event_key} not found or inactive.`);
      return new Response(JSON.stringify({ 
        success: false, 
        error: 'Template not found or inactive',
        details: { event_key, organization_id } 
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 2. Check Deduplication
    const finalDedupeKey = dedupe_key || `${event_key}:${lead_id || user_id || recipient}`;
    const windowSeconds = template.dedupe_window_seconds || 60;

    if (!is_test) {
      const { data: existingLog } = await supabase
        .from('notification_logs')
        .select('id')
        .eq('dedupe_key', finalDedupeKey)
        .gt('created_at', new Date(Date.now() - windowSeconds * 1000).toISOString())
        .limit(1)
        .maybeSingle();

      if (existingLog) {
        console.log(`[NotificationDispatcher] Deduplicated event ${event_key} for key ${finalDedupeKey}`);
        return new Response(JSON.stringify({ success: true, deduplicated: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    // 3. Format message and title
    let formattedMessage = template.message;
    let formattedTitle = template.title || '';

    // Enrich variables with common aliases to be more robust
    const enrichedVariables = { ...safeVariables };
    if (enrichedVariables.nome && !enrichedVariables.user_name) enrichedVariables.user_name = enrichedVariables.nome;
    if (enrichedVariables.user_name && !enrichedVariables.nome) enrichedVariables.nome = enrichedVariables.user_name;
    if (enrichedVariables.lead_name && !enrichedVariables.nome_lead) enrichedVariables.nome_lead = enrichedVariables.lead_name;
    if (enrichedVariables.nome_lead && !enrichedVariables.lead_name) enrichedVariables.lead_name = enrichedVariables.nome_lead;
    if (enrichedVariables.horario && !enrichedVariables.time) enrichedVariables.time = enrichedVariables.horario;
    if (enrichedVariables.time && !enrichedVariables.horario) enrichedVariables.horario = enrichedVariables.time;
    if (enrichedVariables.titulo && !enrichedVariables.title) enrichedVariables.title = enrichedVariables.titulo;
    if (enrichedVariables.title && !enrichedVariables.titulo) enrichedVariables.titulo = enrichedVariables.title;

    // Fetch user organizations count to decide if we show organization name
    let showOrganizationName = false;
    if (user_id) {
      const { count } = await supabase
        .from('organization_members')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user_id);
      showOrganizationName = (count || 0) > 1;
    }

    // Auto-fetch organization name if needed and user has multiple orgs
    if (showOrganizationName && (formattedMessage.includes('{organization_name}') || formattedTitle.includes('{organization_name}')) && !enrichedVariables.organization_name) {
      const { data: org } = await supabase.from('organizations').select('name').eq('id', organization_id).maybeSingle();
      if (org) enrichedVariables.organization_name = org.name;
    } else if (!showOrganizationName) {
      // Remove placeholder if user has only one org
      enrichedVariables.organization_name = '';
    }

    if (enrichedVariables) {
      Object.entries(enrichedVariables).forEach(([key, value]) => {
        // Replace {variable_name} with the value, case-insensitive
        const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`\\{\\s*${escapedKey}\\s*\\}`, 'gi');
        
        const stringValue = value !== null && value !== undefined ? String(value) : '';
        
        // If organization_name is empty, also try to clean up prefixes like "Organização: " or "🏢 "
        if (key === 'organization_name' && !stringValue) {
          formattedMessage = formattedMessage.replace(new RegExp(`(🏢 )?Organização:?\\s*\\{${escapedKey}\\}`, 'gi'), '');
          formattedMessage = formattedMessage.replace(new RegExp(`\\n?🏢\\s*\\{${escapedKey}\\}`, 'gi'), '');
        }

        formattedMessage = formattedMessage.replace(regex, stringValue);
        if (formattedTitle) {
          formattedTitle = formattedTitle.replace(regex, stringValue);
        }
      });
    }

    // Cleanup extra newlines that might be left after removing org
    formattedMessage = scrubLeadPhoneText(
      formattedMessage.replace(/\n\n+/g, '\n\n').trim(),
      event_key,
      lead_id,
    );
    formattedTitle = scrubLeadPhoneText(formattedTitle, event_key, lead_id);

    // 4. Dispatch for each channel
    const channels = Array.isArray(template.channels) && template.channels.length > 0
      ? template.channels
      : [template.channel].filter(Boolean);
    const hasSystemChannel = channels.includes('system');
    const dispatchChannels = channels
      .filter((channel: string, index: number, self: string[]) => self.indexOf(channel) === index)
      .filter((channel: string) => !(channel === 'push' && hasSystemChannel));

    if (hasSystemChannel && channels.includes('push')) {
      console.log(`[NotificationDispatcher] Skipping explicit push for ${event_key}; system notification trigger will send it.`);
    }

    const dispatchResults = await Promise.all(dispatchChannels.map(async (channel: string) => {
      let result: any = { success: false };
      const startTime = performance.now();

      try {
        if (channel === 'system' && user_id) {
          const { error } = await supabase.from('notifications').insert({
            user_id: user_id,
            organization_id: organization_id,
            title: formattedTitle || template.name,
            content: formattedMessage,
            type: template.category || 'info',
            lead_id: lead_id || null,
            is_read: false,
          });
          result = { success: !error, error };
        } else if (channel === 'whatsapp') {
          const resp = await fetch(`${SUPABASE_URL}/functions/v1/whatsapp-notifier`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
            },
            body: JSON.stringify({
              organization_id: organization_id,
              user_id: user_id,
              phone: recipient,
              message: formattedMessage,
              lead_id: lead_id || null,
            }),
          });
          const data = await resp.json();
          result = { success: resp.ok && data.success !== false, data, error: data.error };
        } else if (channel === 'email') {
          const resp = await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
            },
            body: JSON.stringify({
              to: recipient,
              template_key: template.slug,
              variables: safeVariables,
              organization_id: organization_id
            }),
          });
          const data = await resp.json();
          result = { success: resp.ok, data, error: data.error };
        } else if (channel === 'push' && user_id) {
          const notificationData = {
            event_key,
            type: template.category || 'info',
            lead_id: lead_id || null,
            organization_id,
            url: lead_id ? `/crm/conversas?lead=${lead_id}` : "/notifications",
          };

          const resp = await fetch(`${SUPABASE_URL}/functions/v1/send-push-notification`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
            },
            body: JSON.stringify({
              user_id: user_id,
              title: formattedTitle || template.name,
              body: formattedMessage,
              data: notificationData,
              priority: "high",
            }),
          });
          const data = await resp.json();
          result = { success: resp.ok && data.success !== false, data, error: data.error };
        }

        const endTime = performance.now();
        const executionTime = `${(endTime - startTime).toFixed(2)}ms`;

        // Log each channel send
        await supabase.from('notification_logs').insert({
          template_id: template.id,
          organization_id: organization_id,
          user_id: user_id,
          recipient: recipient || user_id || 'system',
          channel: channel,
          payload: { 
            variables: safeVariables, 
            formattedTitle, 
            formattedMessage, 
            dedupe_key: finalDedupeKey, 
            executionTime,
            template_name: template.name,
            lead_id: lead_id,
            is_test: is_test
          },
          response: result,
          status: result.success ? 'sent' : 'failed',
          error: result.error ? String(result.error) : null,
          dedupe_key: finalDedupeKey,
          is_test: is_test || false
        });

      } catch (err) {
        console.error(`[NotificationDispatcher] Error sending to channel ${channel}:`, err);
        result = { success: false, error: err.message };
      }

      return { channel, result };
    }));

    const allFailed = dispatchResults.length > 0 && dispatchResults.every(r => !r.result.success);
    return new Response(JSON.stringify({ 
      success: !allFailed, 
      results: dispatchResults,
      error: allFailed ? 'All channels failed to send' : null 
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (error) {
    console.error("Notification Dispatcher Error:", error);
    return new Response(JSON.stringify({ success: false, error: error.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
