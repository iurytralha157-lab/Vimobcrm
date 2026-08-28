import { createClient } from "npm:@supabase/supabase-js@2";
import { authorizePrivateWorkerRequest } from "../_shared/private-worker-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type LeadRecord = {
  id: string;
  organization_id: string;
  pipeline_id: string | null;
  assigned_user_id: string | null;
  name: string | null;
  source: string | null;
  created_at: string;
  utm_campaign: string | null;
};

const sourceLabels: Record<string, string> = {
  whatsapp: "WhatsApp",
  webhook: "Webhook",
  facebook: "Facebook Ads",
  instagram: "Instagram Ads",
  website: "Site",
  manual: "Manual",
  meta: "Meta Ads",
  meta_ads: "Meta Ads",
  wordpress: "WordPress",
};

function getSourceLabel(source: string | null) {
  if (!source) return "Nao informada";
  return sourceLabels[source] || source;
}

function formatLeadDate(value: string) {
  const date = new Date(value);
  const datePart = new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "America/Sao_Paulo",
  }).format(date);
  const timePart = new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "America/Sao_Paulo",
  }).format(date);
  return `${datePart} | ${timePart}`;
}

async function fetchCampaignName(supabase: any, lead: LeadRecord) {
  const { data: meta } = await supabase
    .from("lead_meta")
    .select("campaign_name, utm_campaign")
    .eq("lead_id", lead.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return meta?.campaign_name || meta?.utm_campaign || lead.utm_campaign || "Nao informado";
}

async function dispatchNotification(
  supabaseUrl: string,
  serviceRoleKey: string,
  body: Record<string, unknown>,
) {
  const resp = await fetch(`${supabaseUrl}/functions/v1/notification-dispatcher`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${serviceRoleKey}`,
    },
    body: JSON.stringify(body),
  });

  const data = await resp.json().catch(() => ({}));
  return { ok: resp.ok, status: resp.status, data };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  }

  if (!authorizePrivateWorkerRequest(req)) {
    return new Response(
      JSON.stringify({ error: "Unauthorized" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  try {
    const { lead_id } = await req.json();
    if (!lead_id) {
      return new Response(
        JSON.stringify({ success: false, error: "lead_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const { data: lead, error: leadError } = await supabase
      .from("leads")
      .select("id, organization_id, pipeline_id, assigned_user_id, name, source, created_at, utm_campaign")
      .eq("id", lead_id)
      .maybeSingle();

    if (leadError) throw leadError;
    if (!lead) {
      return new Response(
        JSON.stringify({ success: false, error: "Lead not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const typedLead = lead as LeadRecord;
    const [{ data: pipeline }, campaignNameResult] = await Promise.all([
      typedLead.pipeline_id
        ? supabase.from("pipelines").select("name").eq("id", typedLead.pipeline_id).maybeSingle()
        : Promise.resolve({ data: null }),
      fetchCampaignName(supabase, typedLead),
    ]);

    const campaignName = campaignNameResult;
    const variables = {
      lead_name: typedLead.name || "Sem nome",
      source: getSourceLabel(typedLead.source),
      campaign_name: campaignName,
      lead_created_at: formatLeadDate(typedLead.created_at),
      pipeline_name: pipeline?.name || "Padrao",
    };

    const targetUserIds = new Set<string>();
    if (typedLead.assigned_user_id) {
      targetUserIds.add(typedLead.assigned_user_id);
    }

    const results = [];
    for (const userId of targetUserIds) {
      results.push({
        user_id: userId,
        result: await dispatchNotification(supabaseUrl, serviceRoleKey, {
          event_key: "new_lead_received",
          organization_id: typedLead.organization_id,
          user_id: userId,
          lead_id: typedLead.id,
          variables,
          dedupe_key: `new_lead_received:${typedLead.id}:${userId}`,
        }),
      });
    }

    return new Response(
      JSON.stringify({ success: true, lead_id: typedLead.id, targets: targetUserIds.size, results }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("Lead notification dispatcher error:", error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
