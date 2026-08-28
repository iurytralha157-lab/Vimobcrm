import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { createHmac } from "https://deno.land/std@0.168.0/node/crypto.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const META_APP_SECRET = Deno.env.get("META_APP_SECRET") || "";
const META_WEBHOOK_VERIFY_TOKEN = Deno.env.get("META_WEBHOOK_VERIFY_TOKEN") || "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const META_GRAPH_VERSION = Deno.env.get("META_GRAPH_VERSION") || "v25.0";
const META_GRAPH_BASE_URL = `https://graph.facebook.com/${META_GRAPH_VERSION}`;

// Verify Meta webhook signature (HMAC-SHA256)
function verifySignature(payload: string, signature: string): boolean {
  if (!signature || !META_APP_SECRET) return false;
  const expected = createHmac("sha256", META_APP_SECRET).update(payload).digest("hex");
  return signature === `sha256=${expected}`;
}

// Persist a raw webhook event (best-effort). Returns event id or null.
async function persistEvent(
  supabase: any,
  payload: any,
  rawText: string,
  signatureValid: boolean,
): Promise<string | null> {
  try {
    // Best-effort extraction of identifiers (first entry / first change)
    const firstEntry = payload?.entry?.[0] || {};
    const firstChange = firstEntry?.changes?.[0]?.value || {};
    const row = {
      object: payload?.object ?? null,
      page_id: firstEntry?.id ?? null,
      leadgen_id: firstChange?.leadgen_id ?? null,
      form_id: firstChange?.form_id ?? null,
      signature_valid: signatureValid,
      status: signatureValid ? "received" : "failed",
      error_message: signatureValid ? null : "invalid_signature",
      raw_payload: payload ?? { raw: rawText },
    };
    const { data, error } = await supabase
      .from("meta_webhook_events")
      .insert(row)
      .select("id")
      .single();
    if (error) {
      console.error("persistEvent insert error:", error.message);
      return null;
    }
    return data?.id ?? null;
  } catch (e) {
    console.error("persistEvent threw:", e);
    return null;
  }
}

async function updateEvent(
  supabase: any,
  eventId: string | null,
  patch: Record<string, unknown>,
) {
  if (!eventId) return;
  try {
    await supabase.from("meta_webhook_events").update(patch).eq("id", eventId);
  } catch (e) {
    console.error("updateEvent error:", e);
  }
}

async function resolveLeadTarget(
  supabase: any,
  formConfig: any,
  integration: any,
): Promise<{ pipelineId: string | null; stageId: string | null }> {
  let pipelineId = formConfig.pipeline_id || integration.pipeline_id || null;
  let stageId = formConfig.stage_id || integration.stage_id || null;

  if ((!pipelineId || !stageId) && formConfig.round_robin_id) {
    const { data: roundRobin } = await supabase
      .from("round_robins")
      .select("target_pipeline_id,target_stage_id")
      .eq("id", formConfig.round_robin_id)
      .maybeSingle();

    pipelineId = pipelineId || roundRobin?.target_pipeline_id || null;
    stageId = stageId || roundRobin?.target_stage_id || null;
  }

  return { pipelineId, stageId };
}

async function handleMessaging(supabase: any, messagingItem: any, pageId: string, platform: string) {
  const senderId = messagingItem.sender.id;
  const recipientId = messagingItem.recipient.id;
  const message = messagingItem.message;

  if (!message || (!message.text && !message.attachments)) return;

  console.log(`Processing ${platform} message from ${senderId} to ${recipientId}`);

  const { data: integration } = await supabase
    .from("meta_integrations")
    .select("*")
    .eq("page_id", pageId)
    .eq("is_connected", true)
    .maybeSingle();

  if (!integration) {
    console.error("No connected integration found for page:", pageId);
    return;
  }

  let { data: conversation } = await supabase
    .from("meta_conversations")
    .select("*")
    .eq("external_id", senderId)
    .eq("page_id", pageId)
    .maybeSingle();

  if (!conversation) {
    let name = "Meta User";
    let profilePic = null;
    try {
      const profileUrl = `${META_GRAPH_BASE_URL}/${senderId}?fields=name,first_name,last_name,profile_pic&access_token=${integration.access_token}`;
      const profileRes = await fetch(profileUrl);
      const profile = await profileRes.json();
      if (profile.name) name = profile.name;
      if (profile.profile_pic) profilePic = profile.profile_pic;
    } catch (e) {
      console.warn("Could not fetch profile info:", e);
    }

    const { data: newLead } = await supabase.from("leads").insert({
      organization_id: integration.organization_id,
      name: name,
      source: "meta",
      deal_status: "open",
    }).select().single();

    const { data: newConv } = await supabase.from("meta_conversations").insert({
      organization_id: integration.organization_id,
      lead_id: newLead?.id,
      external_id: senderId,
      page_id: pageId,
      platform: platform,
      contact_name: name,
      contact_picture: profilePic,
      unread_count: 0,
    }).select().single();

    conversation = newConv;
  }

  const content = message.text || (message.attachments ? "[Mídia]" : "");
  const { error: msgError } = await supabase.from("meta_messages").insert({
    conversation_id: conversation.id,
    external_id: message.mid,
    content: content,
    message_type: message.attachments ? "media" : "text",
    from_me: false,
    sent_at: new Date(messagingItem.timestamp).toISOString(),
    media_url: message.attachments?.[0]?.payload?.url || null,
    media_mime_type: message.attachments?.[0]?.type || null,
  });

  if (msgError) {
    console.error("Error inserting message:", msgError);
    return;
  }

  await supabase.from("meta_conversations").update({
    last_message: content,
    last_message_at: new Date(messagingItem.timestamp).toISOString(),
    unread_count: (conversation.unread_count || 0) + 1,
    updated_at: new Date().toISOString(),
  }).eq("id", conversation.id);
}

async function handleComment(supabase: any, pageId: string, changeValue: any, platform: string) {
  const senderId = changeValue.from?.id;
  const senderName = changeValue.from?.username || changeValue.from?.name;
  const messageText = changeValue.text || changeValue.message;
  if (!senderId || !messageText) return;

  const { data: integration } = await supabase
    .from("meta_integrations")
    .select("*")
    .eq("page_id", pageId)
    .eq("is_connected", true)
    .maybeSingle();
  if (!integration) return;

  let { data: conversation } = await supabase
    .from("meta_conversations")
    .select("*")
    .eq("external_id", senderId)
    .eq("page_id", pageId)
    .maybeSingle();

  if (!conversation) {
    const { data: newLead } = await supabase.from("leads").insert({
      organization_id: integration.organization_id,
      name: senderName || "Comentário Meta",
      source: "meta",
      deal_status: "open",
    }).select().single();

    const { data: newConv } = await supabase.from("meta_conversations").insert({
      organization_id: integration.organization_id,
      lead_id: newLead?.id,
      external_id: senderId,
      page_id: pageId,
      platform: platform,
      contact_name: senderName,
      unread_count: 0,
    }).select().single();

    conversation = newConv;
  }

  const content = `[COMENTÁRIO] ${messageText}`;
  await supabase.from("meta_messages").insert({
    conversation_id: conversation.id,
    external_id: changeValue.id || changeValue.comment_id,
    content: content,
    message_type: "comment",
    from_me: false,
    sent_at: new Date().toISOString(),
  });

  await supabase.from("meta_conversations").update({
    last_message: content,
    last_message_at: new Date().toISOString(),
    unread_count: (conversation.unread_count || 0) + 1,
    updated_at: new Date().toISOString(),
  }).eq("id", conversation.id);
}

// Process a single leadgen change. Returns final status.
async function processLeadgen(
  supabase: any,
  pageId: string,
  changeValue: any,
): Promise<{ status: string; error?: string; organization_id?: string }> {
  const leadgenId = changeValue?.leadgen_id;
  const formId = changeValue?.form_id;
  if (!leadgenId || !formId) {
    return { status: "failed", error: "missing_leadgen_or_form_id" };
  }

  // FASE 1: dedupe — se já existe um lead com este meta_lead_id, marca como duplicate
  const { data: existingLead } = await supabase
    .from("leads")
    .select("id, organization_id")
    .eq("meta_lead_id", leadgenId)
    .maybeSingle();
  if (existingLead) {
    return { status: "duplicate", organization_id: existingLead.organization_id };
  }

  const { data: integrations } = await supabase
    .from("meta_integrations")
    .select("*")
    .eq("page_id", pageId)
    .eq("is_connected", true)
    .order("created_at", { ascending: false });

  if (!integrations?.length) {
    return { status: "skipped", error: "no_connected_integration_for_page" };
  }

  let lastResult: { status: string; error?: string; organization_id?: string } = {
    status: "skipped",
    error: "no_active_form_config",
  };

  for (const integration of integrations) {
    lastResult.organization_id = integration.organization_id;

    const { data: formConfig, error: configError } = await supabase
      .from("meta_form_configs")
      .select("*")
      .eq("integration_id", integration.id)
      .eq("form_id", formId)
      .maybeSingle();

    if (configError) {
      lastResult = {
        status: "failed",
        error: `form_config_query_error:${configError.message}`,
        organization_id: integration.organization_id,
      };
      continue;
    }

    if (!formConfig) {
      lastResult = {
        status: "skipped",
        error: "form_not_configured",
        organization_id: integration.organization_id,
      };
      continue;
    }

    if (formConfig.is_active !== true) {
      lastResult = {
        status: "skipped",
        error: "form_inactive",
        organization_id: integration.organization_id,
      };
      continue;
    }

    const { pipelineId, stageId } = await resolveLeadTarget(supabase, formConfig, integration);
    if (!pipelineId || !stageId) {
      lastResult = {
        status: "failed",
        error: "missing_pipeline_or_stage",
        organization_id: integration.organization_id,
      };
      continue;
    }

    const defaultValues = formConfig?.default_values || {};
    const propertyId = formConfig?.property_id || defaultValues?.property_id || null;
    const autoTags = Array.isArray(formConfig?.auto_tags) && formConfig.auto_tags.length > 0
      ? formConfig.auto_tags
      : (Array.isArray(defaultValues?.auto_tags) ? defaultValues.auto_tags : []);
    const fieldMapping = formConfig?.field_mapping || {};

    let valorInteresse: number | null = null;
    if (propertyId) {
      const { data: property } = await supabase
        .from("properties").select("preco").eq("id", propertyId).single();
      if (property?.preco) valorInteresse = property.preco;
    }

    const leadUrl = `${META_GRAPH_BASE_URL}/${leadgenId}?access_token=${integration.access_token}&fields=id,created_time,field_data,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,form_id,platform`;
    const leadResponse = await fetch(leadUrl);
    const leadData = await leadResponse.json();

    if (leadData.error) {
      lastResult = {
        status: "failed",
        error: `graph_api_error:${leadData.error.message}`,
        organization_id: integration.organization_id,
      };
      continue;
    }

    let creativeUrl = null;
    let creativeVideoUrl = null;
    let creativeInstagramUrl = null;
    if (leadData.ad_id) {
      try {
        const creativeApiUrl = `${META_GRAPH_BASE_URL}/${leadData.ad_id}?fields=creative{effective_image_url,thumbnail_url,video_id,instagram_permalink_url}&access_token=${integration.access_token}`;
        const creativeResponse = await fetch(creativeApiUrl);
        const creativeData = await creativeResponse.json();
        if (creativeData?.creative) {
          creativeUrl = creativeData.creative.effective_image_url || creativeData.creative.thumbnail_url || null;
          creativeInstagramUrl = creativeData.creative.instagram_permalink_url || null;
          if (creativeData.creative.video_id) {
            const videoApiUrl = `${META_GRAPH_BASE_URL}/${creativeData.creative.video_id}?fields=source,permalink_url&access_token=${integration.access_token}`;
            const videoResponse = await fetch(videoApiUrl);
            const videoData = await videoResponse.json();
            creativeVideoUrl = videoData?.source || videoData?.permalink_url || null;
          }
        }
      } catch (e) { console.warn("Creative fetch error", e); }
    }

    let name = "Lead Facebook", email = "", phone = "", message = "", cargo = "", empresa = "", cidade = "", bairro = "";
    const customFields: any = {};

    for (const field of leadData.field_data || []) {
      const value = field.values?.[0] || "";
      const fieldKey = field.name.toLowerCase();
      const mappedTo = fieldMapping[field.name] || fieldMapping[fieldKey];
      if (mappedTo) {
        if (mappedTo === "name") name = value || name;
        else if (mappedTo === "email") email = value;
        else if (mappedTo === "phone") phone = value;
        else if (mappedTo === "message") message = value;
        else if (mappedTo === "cargo") cargo = value;
        else if (mappedTo === "empresa") empresa = value;
        else if (mappedTo === "cidade") cidade = value;
        else if (mappedTo === "bairro") bairro = value;
        else if (mappedTo === "custom") customFields[field.name] = value;
      } else {
        if (fieldKey.includes("nome") || fieldKey.includes("name") || fieldKey === "full_name") name = value || name;
        else if (fieldKey.includes("email")) email = value;
        else if (fieldKey.includes("telefone") || fieldKey.includes("phone") || fieldKey.includes("whatsapp")) phone = value;
        else customFields[field.name] = value;
      }
    }

    const { data: newLead, error: leadError } = await supabase.from("leads").insert({
      organization_id: integration.organization_id,
      pipeline_id: pipelineId,
      stage_id: stageId,
      name, email, phone,
      message: message || `Lead gerado via Facebook Lead Ads`,
      source: "meta",
      interest_property_id: propertyId,
      valor_interesse: valorInteresse,
      meta_lead_id: leadgenId,
      meta_form_id: formId,
    }).select("id").single();

    if (leadError) {
      // Pode ser violação do índice único (corrida) — tratar como duplicate, não como falha
      if ((leadError as any).code === "23505") {
        lastResult = {
          status: "duplicate",
          error: "unique_violation_meta_lead_id",
          organization_id: integration.organization_id,
        };
        continue;
      }
      lastResult = {
        status: "failed",
        error: `lead_insert_error:${leadError.message}`,
        organization_id: integration.organization_id,
      };
      continue;
    }

    if (autoTags.length > 0) {
      for (const tagId of autoTags) await supabase.from("lead_tags").insert({ lead_id: newLead.id, tag_id: tagId });
    }

    const contactNotesLines = [];
    if (cargo) contactNotesLines.push(`Cargo: ${cargo}`);
    if (empresa) contactNotesLines.push(`Empresa: ${empresa}`);
    if (cidade) contactNotesLines.push(`Cidade: ${cidade}`);
    if (bairro) contactNotesLines.push(`Bairro: ${bairro}`);
    for (const [k, v] of Object.entries(customFields)) contactNotesLines.push(`${k}: ${v}`);

    await supabase.from("lead_meta").insert({
      lead_id: newLead.id, page_id: pageId, form_id: formId,
      ad_id: leadData.ad_id, adset_id: leadData.adset_id, campaign_id: leadData.campaign_id,
      ad_name: leadData.ad_name, adset_name: leadData.adset_name, campaign_name: leadData.campaign_name,
      platform: leadData.platform, contact_notes: contactNotesLines.join("\n"),
      creative_url: creativeUrl, creative_video_url: creativeVideoUrl, creative_instagram_url: creativeInstagramUrl,
      raw_payload: JSON.stringify(leadData),
    });

    await supabase.from("meta_integrations").update({
      leads_received: (integration.leads_received || 0) + 1,
      last_lead_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", integration.id);

    await supabase.from("meta_form_configs").update({
      leads_received: (formConfig.leads_received || 0) + 1,
      last_lead_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", formConfig.id);

    return { status: "processed", organization_id: integration.organization_id };
  }

  return lastResult;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(req.url);

  // Verification handshake (Meta GET)
  if (req.method === "GET") {
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    if (mode === "subscribe" && token === META_WEBHOOK_VERIFY_TOKEN) {
      return new Response(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
    }
    return new Response("Forbidden", { status: 403 });
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  // FASE 1: HMAC obrigatório (fail-closed)
  if (!META_APP_SECRET) {
    console.error("META_APP_SECRET not configured — refusing webhook");
    return new Response(JSON.stringify({ error: "server_misconfigured" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const rawBody = await req.text();
  const signature = req.headers.get("X-Hub-Signature-256") || "";
  const sigValid = verifySignature(rawBody, signature);

  let body: any = null;
  try { body = JSON.parse(rawBody); } catch { body = null; }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // FASE 1: persistir o evento bruto SEMPRE (mesmo com assinatura inválida)
  const eventId = await persistEvent(supabase, body ?? { raw: rawBody }, rawBody, sigValid);

  if (!sigValid) {
    console.error("Invalid webhook signature — payload persisted as failed");
    // Retornamos 200 para não causar reentrega infinita; o evento ficou registrado para auditoria.
    return new Response("OK", { status: 200 });
  }

  if (!body) {
    await updateEvent(supabase, eventId, { status: "failed", error_message: "invalid_json", processed_at: new Date().toISOString() });
    return new Response("OK", { status: 200 });
  }

  // Processa todos os entries; agrega resultado
  const results: { status: string; error?: string; organization_id?: string }[] = [];
  try {
    if (body.object === "page" || body.object === "instagram") {
      for (const entry of body.entry || []) {
        const pageId = entry.id;

        if (entry.messaging) {
          for (const messagingItem of entry.messaging) {
            try {
              await handleMessaging(supabase, messagingItem, pageId, body.object === "instagram" ? "instagram" : "messenger");
            } catch (e) {
              console.error("messaging handler error:", e);
            }
          }
        }

        if (entry.changes) {
          for (const change of entry.changes) {
            try {
              if (change.field === "leadgen") {
                const r = await processLeadgen(supabase, pageId, change.value);
                results.push(r);
              } else if (change.field === "comments" || change.field === "feed") {
                await handleComment(supabase, pageId, change.value, body.object === "instagram" ? "instagram" : "messenger");
              }
            } catch (e) {
              console.error("change handler error:", e);
              results.push({ status: "failed", error: `handler_threw:${(e as Error).message}` });
            }
          }
        }
      }
    }
  } catch (e) {
    console.error("Top-level processing error:", e);
    results.push({ status: "failed", error: `top_level:${(e as Error).message}` });
  }

  // Determina status final do evento (prioriza failed > skipped > duplicate > processed)
  const final = results.find(r => r.status === "failed")
    ?? results.find(r => r.status === "skipped")
    ?? results.find(r => r.status === "duplicate")
    ?? results.find(r => r.status === "processed")
    ?? { status: body?.entry?.[0]?.changes?.[0]?.field === "leadgen" ? "failed" : "processed" };

  await updateEvent(supabase, eventId, {
    status: final.status,
    error_message: final.error ?? null,
    organization_id: final.organization_id ?? null,
    processed_at: new Date().toISOString(),
  });

  // Sempre 200 quando o payload foi persistido — evita reentrega infinita do Meta.
  return new Response("OK", { status: 200 });
});
