
import { createClient } from "npm:@supabase/supabase-js@2";

export async function processLeadgenEvent(
  supabase: any,
  pageId: string,
  changeValue: any,
  eventId: string | null = null
): Promise<{ status: string; error?: string; organization_id?: string }> {
  const leadgenId = changeValue?.leadgen_id;
  const formId = changeValue?.form_id;
  
  if (!leadgenId || !formId) {
    return { status: "failed", error: "missing_leadgen_or_form_id" };
  }

  // Deduplication check
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
    .eq("is_connected", true);

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

    if (!formConfig || formConfig.is_active !== true) {
      lastResult = {
        status: "skipped",
        error: !formConfig ? "form_not_configured" : "form_inactive",
        organization_id: integration.organization_id,
      };
      continue;
    }

    const pipelineId = formConfig.pipeline_id || integration.pipeline_id;
    const stageId = formConfig.stage_id || integration.stage_id;
    
    if (!pipelineId || !stageId) {
      lastResult = {
        status: "failed",
        error: "missing_pipeline_or_stage",
        organization_id: integration.organization_id,
      };
      continue;
    }

    const propertyId = formConfig?.property_id || null;
    const autoTags = formConfig?.auto_tags || [];
    const fieldMapping = formConfig?.field_mapping || {};

    let valorInteresse: number | null = null;
    if (propertyId) {
      const { data: property } = await supabase
        .from("properties").select("preco").eq("id", propertyId).single();
      if (property?.preco) valorInteresse = property.preco;
    }

    // Fetch lead data from Graph API
    const leadUrl = `https://graph.facebook.com/v21.0/${leadgenId}?access_token=${integration.access_token}&fields=id,created_time,field_data,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,form_id,platform`;
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

    // Process field mapping (simplified logic from meta-webhook)
    let name = "Lead Facebook", email = "", phone = "", message = "";
    const customFields: any = {};
    const extraFields: any = {};

    for (const field of leadData.field_data || []) {
      const value = field.values?.[0] || "";
      const fieldKey = field.name.toLowerCase();
      const mappedTo = fieldMapping[field.name] || fieldMapping[fieldKey];
      
      if (mappedTo) {
        if (mappedTo === "name") name = value || name;
        else if (mappedTo === "email") email = value;
        else if (mappedTo === "phone") phone = value;
        else if (mappedTo === "message") message = value;
        else extraFields[mappedTo] = value;
      } else {
        if (fieldKey.includes("nome") || fieldKey.includes("name") || fieldKey === "full_name") name = value || name;
        else if (fieldKey.includes("email")) email = value;
        else if (fieldKey.includes("telefone") || fieldKey.includes("phone") || fieldKey.includes("whatsapp")) phone = value;
        else customFields[field.name] = value;
      }
    }

    // Insert lead
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
      ...extraFields
    }).select("id").single();

    if (leadError) {
      if ((leadError as any).code === "23505") {
        return { status: "duplicate", organization_id: integration.organization_id };
      }
      lastResult = {
        status: "failed",
        error: `lead_insert_error:${leadError.message}`,
        organization_id: integration.organization_id,
      };
      continue;
    }

    // Auto tags
    if (autoTags.length > 0) {
      for (const tagId of autoTags) {
        await supabase.from("lead_tags").insert({ lead_id: newLead.id, tag_id: tagId });
      }
    }

    // Lead meta data
    const contactNotesLines = [];
    for (const [k, v] of Object.entries(customFields)) contactNotesLines.push(`${k}: ${v}`);

    await supabase.from("lead_meta").insert({
      lead_id: newLead.id, 
      page_id: pageId, 
      form_id: formId,
      ad_id: leadData.ad_id, 
      adset_id: leadData.adset_id, 
      campaign_id: leadData.campaign_id,
      ad_name: leadData.ad_name, 
      adset_name: leadData.adset_name, 
      campaign_name: leadData.campaign_name,
      platform: leadData.platform, 
      contact_notes: contactNotesLines.join("\n"),
      raw_payload: JSON.stringify(leadData),
    });

    // Update integration stats
    await supabase.from("meta_integrations").update({
      leads_received: (integration.leads_received || 0) + 1,
      last_lead_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", integration.id);

    return { status: "processed", organization_id: integration.organization_id };
  }

  return lastResult;
}
