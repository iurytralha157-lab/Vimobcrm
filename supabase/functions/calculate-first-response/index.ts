import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface FirstResponseRequest {
  lead_id: string;
  channel: string; // 'whatsapp', 'phone', 'email', 'manual'
  actor_user_id: string | null;
  is_automation: boolean;
  organization_id: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const body: FirstResponseRequest = await req.json();
    const { lead_id, channel, actor_user_id, is_automation, organization_id } = body;

    if (!lead_id || !organization_id) {
      console.log("Missing lead_id or organization_id");
      return new Response(
        JSON.stringify({ success: false, error: "Missing required fields" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Calculating first response for lead ${lead_id}, channel: ${channel}, is_automation: ${is_automation}`);

    // 1. Check if lead already has first_response_at (idempotency)
    const { data: lead, error: leadError } = await supabase
      .from("leads")
      .select("first_response_at, pipeline_id, created_at")
      .eq("id", lead_id)
      .single();

    if (leadError) {
      console.error("Error fetching lead:", leadError);
      return new Response(
        JSON.stringify({ success: false, error: "Lead not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (lead.first_response_at) {
      console.log(`Lead ${lead_id} already has first_response_at, skipping (idempotent)`);
      return new Response(
        JSON.stringify({ success: true, message: "Already calculated", first_response_at: lead.first_response_at }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 2. Fetch pipeline configuration
    let firstResponseStart = 'lead_created';
    let includeAutomation = true;

    if (lead.pipeline_id) {
      const { data: pipeline } = await supabase
        .from("pipelines")
        .select("first_response_start, include_automation_in_first_response")
        .eq("id", lead.pipeline_id)
        .single();

      if (pipeline) {
        firstResponseStart = pipeline.first_response_start || 'lead_created';
        includeAutomation = pipeline.include_automation_in_first_response ?? true;
      }
    }

    console.log(`Pipeline config: start=${firstResponseStart}, include_automation=${includeAutomation}`);

    // 3. If this is automation and pipeline doesn't include automation, skip
    if (is_automation && !includeAutomation) {
      console.log(`Automation message but pipeline excludes automation, skipping`);
      return new Response(
        JSON.stringify({ success: true, message: "Automation excluded by pipeline config" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 4. Get the start timestamp based on pipeline config
    let startTime: Date;

    if (firstResponseStart === 'lead_assigned') {
      // Find the first lead_assigned event
      const { data: assignedEvent } = await supabase
        .from("lead_timeline_events")
        .select("event_at")
        .eq("lead_id", lead_id)
        .eq("event_type", "lead_assigned")
        .order("event_at", { ascending: true })
        .limit(1)
        .maybeSingle();

      if (!assignedEvent) {
        console.log(`No lead_assigned event found for lead ${lead_id}, using lead_created`);
        startTime = new Date(lead.created_at);
      } else {
        startTime = new Date(assignedEvent.event_at);
      }
    } else {
      // Default: use lead_created
      const { data: createdEvent } = await supabase
        .from("lead_timeline_events")
        .select("event_at")
        .eq("lead_id", lead_id)
        .eq("event_type", "lead_created")
        .order("event_at", { ascending: true })
        .limit(1)
        .maybeSingle();

      if (createdEvent) {
        startTime = new Date(createdEvent.event_at);
      } else {
        // Fallback to lead.created_at
        startTime = new Date(lead.created_at);
      }
    }

    // 5. Calculate time difference
    const now = new Date();
    const diffMs = now.getTime() - startTime.getTime();
    const diffSeconds = Math.floor(diffMs / 1000);

    console.log(`First response calculated: ${diffSeconds} seconds (start: ${startTime.toISOString()}, now: ${now.toISOString()})`);

    // 6. Prepare update data - include first_touch if this is a human action
    const updateData: Record<string, unknown> = {
      first_response_at: now.toISOString(),
      first_response_seconds: diffSeconds,
      first_response_channel: channel,
      first_response_actor_user_id: actor_user_id,
      first_response_is_automation: is_automation,
    };

    // If this is a human action (not automation), also record first_touch
    if (!is_automation && actor_user_id) {
      updateData.first_touch_at = now.toISOString();
      updateData.first_touch_seconds = diffSeconds;
      updateData.first_touch_actor_user_id = actor_user_id;
      updateData.first_touch_channel = channel;
      console.log(`Recording first_touch (human action) for lead ${lead_id}`);
    }

    const { error: updateError } = await supabase
      .from("leads")
      .update(updateData)
      .eq("id", lead_id);

    if (updateError) {
      console.error("Error updating lead first response:", updateError);
      return new Response(
        JSON.stringify({ success: false, error: "Failed to update lead" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 7. Insert first_response event to timeline
    const { error: eventError } = await supabase
      .from("lead_timeline_events")
      .insert({
        organization_id: organization_id,
        lead_id: lead_id,
        event_type: "first_response",
        user_id: actor_user_id,
        title: channel === 'stage_move' ? 'Tempo de resposta (moveu lead)' : `Tempo de resposta via ${channel}`,
        description: `Tempo de resposta: ${diffSeconds} segundos`,
        metadata: {
          channel: channel,
          is_automation: is_automation,
          start_event_type: firstResponseStart,
          start_time: startTime.toISOString(),
          response_seconds: diffSeconds
        }
      });

    if (eventError) {
      console.error("Error inserting first_response event:", eventError);
      // Don't fail, lead was already updated
    }

    // 8. Also insert the whatsapp_message_sent event (if it's whatsapp channel)
    if (channel === 'whatsapp') {
      await supabase
        .from("lead_timeline_events")
        .insert({
          organization_id: organization_id,
          lead_id: lead_id,
          event_type: "whatsapp_message_sent",
          user_id: actor_user_id,
          title: "Mensagem WhatsApp enviada",
          description: "Primeira mensagem que registrou tempo de resposta",
          metadata: { 
            channel: "whatsapp",
            is_automation: is_automation,
            triggered_first_response: true 
          }
        });
    }

    console.log(`First response recorded for lead ${lead_id}: ${diffSeconds}s via ${channel}`);

    return new Response(
      JSON.stringify({
        success: true,
        first_response_at: now.toISOString(),
        first_response_seconds: diffSeconds,
        channel: channel,
        is_automation: is_automation
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: unknown) {
    console.error("Calculate first response error:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
