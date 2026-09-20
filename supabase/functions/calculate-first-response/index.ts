import { createClient } from "npm:@supabase/supabase-js@2";
import { authorizePrivateWorkerRequest } from "../_shared/private-worker-auth.ts";
import {
  readSupabaseSecretKeyEnvironment,
  selectSupabaseAdminSecretKey,
} from "../_shared/supabase-secret-keys.ts";
import { parseFirstResponseRequest } from "./request.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(null, {
      status: 405,
      headers: { ...corsHeaders, Allow: "POST, OPTIONS" },
    });
  }

  try {
    // This function intentionally has verify_jwt=false for service-to-service
    // compatibility. Authenticate before parsing attacker-controlled input,
    // selecting an admin key, creating a service client, or touching data.
    const secretEnvironment = readSupabaseSecretKeyEnvironment();
    if (!authorizePrivateWorkerRequest(req, secretEnvironment)) {
      return jsonResponse({ success: false, error: "Unauthorized" }, 401);
    }

    let requestBody: unknown;
    try {
      requestBody = await req.json();
    } catch {
      return jsonResponse({ success: false, error: "Invalid JSON body" }, 400);
    }

    const input = parseFirstResponseRequest(requestBody);
    if (!input) {
      return jsonResponse({ success: false, error: "Invalid request body" }, 400);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const supabaseAdminKey = selectSupabaseAdminSecretKey(secretEnvironment);
    if (!supabaseUrl || !supabaseAdminKey) {
      console.error("Calculate first response configuration unavailable");
      return jsonResponse(
        { success: false, error: "Worker configuration unavailable" },
        500,
      );
    }

    const supabase = createClient(supabaseUrl, supabaseAdminKey);
    const {
      lead_id: leadId,
      channel,
      actor_user_id: actorUserId,
      is_automation: isAutomation,
      organization_id: organizationId,
    } = input;

    // A service-role client bypasses RLS, so every lookup and mutation must
    // carry the tenant key explicitly. Never infer organization from lead_id.
    const { data: lead, error: leadError } = await supabase
      .from("leads")
      .select("first_response_at, pipeline_id, created_at")
      .eq("organization_id", organizationId)
      .eq("id", leadId)
      .maybeSingle();

    if (leadError) {
      console.error("Unable to load lead for first response", {
        code: leadError.code || "unknown",
      });
      return jsonResponse({ success: false, error: "Failed to load lead" }, 500);
    }
    if (!lead) {
      return jsonResponse({ success: false, error: "Lead not found" }, 404);
    }

    if (lead.first_response_at) {
      return jsonResponse({
        success: true,
        message: "Already calculated",
        first_response_at: lead.first_response_at,
      });
    }

    if (actorUserId) {
      const { data: actor, error: actorError } = await supabase
        .from("users")
        .select("id")
        .eq("organization_id", organizationId)
        .eq("id", actorUserId)
        .maybeSingle();
      if (actorError) {
        console.error("Unable to validate first-response actor", {
          code: actorError.code || "unknown",
        });
        return jsonResponse(
          { success: false, error: "Failed to validate actor" },
          500,
        );
      }
      if (!actor) {
        return jsonResponse(
          { success: false, error: "Actor does not belong to organization" },
          400,
        );
      }
    }

    let firstResponseStart = "lead_created";
    let includeAutomation = true;
    if (lead.pipeline_id) {
      const { data: pipeline, error: pipelineError } = await supabase
        .from("pipelines")
        .select("first_response_start, include_automation_in_first_response")
        .eq("organization_id", organizationId)
        .eq("id", lead.pipeline_id)
        .maybeSingle();
      if (pipelineError) {
        console.error("Unable to load first-response pipeline configuration", {
          code: pipelineError.code || "unknown",
        });
        return jsonResponse(
          { success: false, error: "Failed to load pipeline" },
          500,
        );
      }
      if (pipeline) {
        firstResponseStart = pipeline.first_response_start || "lead_created";
        includeAutomation =
          pipeline.include_automation_in_first_response ?? true;
      }
    }

    if (isAutomation && !includeAutomation) {
      return jsonResponse({
        success: true,
        message: "Automation excluded by pipeline config",
      });
    }

    let startTime = new Date(lead.created_at);
    const startEventType = firstResponseStart === "lead_assigned"
      ? "lead_assigned"
      : "lead_created";
    const { data: startEvent, error: startEventError } = await supabase
      .from("lead_timeline_events")
      .select("event_at")
      .eq("organization_id", organizationId)
      .eq("lead_id", leadId)
      .eq("event_type", startEventType)
      .order("event_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (startEventError) {
      console.error("Unable to load first-response baseline", {
        code: startEventError.code || "unknown",
      });
      return jsonResponse(
        { success: false, error: "Failed to load response baseline" },
        500,
      );
    }
    if (startEvent?.event_at) startTime = new Date(startEvent.event_at);
    if (!Number.isFinite(startTime.getTime())) {
      console.error("Lead has an invalid first-response baseline", { leadId });
      return jsonResponse(
        { success: false, error: "Invalid response baseline" },
        500,
      );
    }

    const now = new Date();
    const recordedAt = now.toISOString();
    const diffSeconds = Math.max(
      0,
      Math.floor((now.getTime() - startTime.getTime()) / 1000),
    );
    const updateData: Record<string, unknown> = {
      first_response_at: recordedAt,
      first_response_seconds: diffSeconds,
      first_response_channel: channel,
      first_response_actor_user_id: actorUserId,
      first_response_is_automation: isAutomation,
    };
    if (!isAutomation && actorUserId) {
      updateData.first_touch_at = recordedAt;
      updateData.first_touch_seconds = diffSeconds;
      updateData.first_touch_actor_user_id = actorUserId;
      updateData.first_touch_channel = channel;
    }

    // The null predicate is the idempotency boundary. Concurrent deliveries
    // may calculate in parallel, but exactly one can own the lead mutation and
    // therefore the timeline side effects below.
    const { data: updatedLead, error: updateError } = await supabase
      .from("leads")
      .update(updateData)
      .eq("organization_id", organizationId)
      .eq("id", leadId)
      .is("first_response_at", null)
      .select("first_response_at, first_response_seconds")
      .maybeSingle();
    if (updateError) {
      console.error("Unable to record first response", {
        code: updateError.code || "unknown",
      });
      return jsonResponse({ success: false, error: "Failed to update lead" }, 500);
    }

    if (!updatedLead) {
      const { data: currentLead, error: currentLeadError } = await supabase
        .from("leads")
        .select("first_response_at, first_response_seconds")
        .eq("organization_id", organizationId)
        .eq("id", leadId)
        .maybeSingle();
      if (currentLeadError) {
        console.error("Unable to verify concurrent first response", {
          code: currentLeadError.code || "unknown",
        });
        return jsonResponse(
          { success: false, error: "Failed to verify lead update" },
          500,
        );
      }
      if (!currentLead) {
        return jsonResponse({ success: false, error: "Lead not found" }, 404);
      }
      if (currentLead.first_response_at) {
        return jsonResponse({
          success: true,
          message: "Already calculated",
          first_response_at: currentLead.first_response_at,
          first_response_seconds: currentLead.first_response_seconds,
        });
      }
      return jsonResponse(
        { success: false, error: "First response was not recorded" },
        409,
      );
    }

    const timelineEvents: Array<Record<string, unknown>> = [
      {
        organization_id: organizationId,
        lead_id: leadId,
        event_type: "first_response",
        user_id: actorUserId,
        actor_user_id: actorUserId,
        title: channel === "stage_move"
          ? "Tempo de resposta (moveu lead)"
          : `Tempo de resposta via ${channel}`,
        description: `Tempo de resposta: ${diffSeconds} segundos`,
        metadata: {
          channel,
          is_automation: isAutomation,
          start_event_type: startEventType,
          start_time: startTime.toISOString(),
          response_seconds: diffSeconds,
        },
      },
    ];
    if (channel === "whatsapp") {
      timelineEvents.push({
        organization_id: organizationId,
        lead_id: leadId,
        event_type: "whatsapp_message_sent",
        user_id: actorUserId,
        actor_user_id: actorUserId,
        title: "Mensagem WhatsApp enviada",
        description: "Primeira mensagem que registrou tempo de resposta",
        metadata: {
          channel: "whatsapp",
          is_automation: isAutomation,
          triggered_first_response: true,
        },
      });
    }

    // Insert the related events in one statement. The lead CAS is already
    // durable, so timeline failure is reported in the response without asking
    // the caller to replay a completed first-response mutation.
    const { error: timelineError } = await supabase
      .from("lead_timeline_events")
      .insert(timelineEvents);
    if (timelineError) {
      console.error("First response recorded without timeline events", {
        code: timelineError.code || "unknown",
        leadId,
      });
    }

    return jsonResponse({
      success: true,
      first_response_at: updatedLead.first_response_at,
      first_response_seconds: updatedLead.first_response_seconds,
      channel,
      is_automation: isAutomation,
      timeline_recorded: !timelineError,
    });
  } catch (error: unknown) {
    console.error("Calculate first response failed", error);
    return jsonResponse(
      { success: false, error: "Internal server error" },
      500,
    );
  }
});
