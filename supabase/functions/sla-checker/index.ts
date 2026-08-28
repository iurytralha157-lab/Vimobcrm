import { createClient } from "npm:@supabase/supabase-js@2";
import { authorizePrivateWorkerRequest } from "../_shared/private-worker-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface PendingLead {
  lead_id: string;
  organization_id: string;
  pipeline_id: string;
  assigned_user_id: string | null;
  lead_name: string;
  sla_start_at: string;
  current_sla_status: string;
  warn_after_seconds: number;
  overdue_after_seconds: number;
  notify_assignee: boolean;
  notify_manager: boolean;
  sla_notified_warning_at: string | null;
  sla_notified_overdue_at: string | null;
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
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    console.log("SLA Checker started at", new Date().toISOString());

    // 1. Get all leads pending SLA check via RPC function
    const { data: pendingLeads, error: rpcError } = await supabase
      .rpc("get_sla_pending_leads");

    if (rpcError) {
      console.error("Error fetching pending leads:", rpcError);
      return new Response(
        JSON.stringify({ success: false, error: rpcError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!pendingLeads || pendingLeads.length === 0) {
      console.log("No pending leads to check");
      return new Response(
        JSON.stringify({ success: true, message: "No pending leads", processed: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Found ${pendingLeads.length} leads to check`);

    const now = new Date();
    let warningsCreated = 0;
    let overduesCreated = 0;

    for (const lead of pendingLeads as PendingLead[]) {
      const startAt = new Date(lead.sla_start_at);
      const elapsedSeconds = Math.floor((now.getTime() - startAt.getTime()) / 1000);

      // Determine new status
      let newStatus = "ok";
      if (elapsedSeconds >= lead.overdue_after_seconds) {
        newStatus = "overdue";
      } else if (elapsedSeconds >= lead.warn_after_seconds) {
        newStatus = "warning";
      }

      console.log(`Lead ${lead.lead_id}: elapsed=${elapsedSeconds}s, status=${lead.current_sla_status} -> ${newStatus}`);

      // Update lead with SLA info
      const updateData: Record<string, unknown> = {
        sla_status: newStatus,
        sla_seconds_elapsed: elapsedSeconds,
        sla_last_checked_at: now.toISOString(),
      };

      // Check if status changed to WARNING (and not already notified)
      if (newStatus === "warning" && lead.current_sla_status !== "warning" && !lead.sla_notified_warning_at) {
        updateData.sla_notified_warning_at = now.toISOString();
        warningsCreated++;

        // Create activity
        await supabase.from("activities").insert({
          lead_id: lead.lead_id,
          type: "sla_warning",
          content: `SLA em alerta: ${Math.floor(elapsedSeconds / 60)} minutos sem resposta`,
          metadata: {
            elapsed_seconds: elapsedSeconds,
            warn_threshold: lead.warn_after_seconds,
            overdue_threshold: lead.overdue_after_seconds,
          },
        });

        // Create timeline event
        await supabase.from("lead_timeline_events").insert({
          organization_id: lead.organization_id,
          lead_id: lead.lead_id,
          event_type: "sla_warning",
          event_at: now.toISOString(),
          channel: "system",
          metadata: {
            elapsed_seconds: elapsedSeconds,
            warn_threshold: lead.warn_after_seconds,
          },
        });

        // Create notification for assigned user
        if (lead.notify_assignee && lead.assigned_user_id) {
          await fetch(`${SUPABASE_URL}/functions/v1/notification-dispatcher`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
            },
            body: JSON.stringify({
              event_key: "sla_warning",
              organization_id: lead.organization_id,
              user_id: lead.assigned_user_id,
              variables: { lead_name: lead.lead_name, minutes: Math.floor(elapsedSeconds / 60) },
              lead_id: lead.lead_id,
              dedupe_key: `sla_warning:${lead.lead_id}:${now.getHours()}` // dedupe por hora
            }),
          });
        }


        console.log(`Created WARNING notification for lead ${lead.lead_id}`);
      }

      // Check if status changed to OVERDUE (and not already notified)
      if (newStatus === "overdue" && lead.current_sla_status !== "overdue" && !lead.sla_notified_overdue_at) {
        updateData.sla_notified_overdue_at = now.toISOString();
        overduesCreated++;

        // Create activity
        await supabase.from("activities").insert({
          lead_id: lead.lead_id,
          type: "sla_overdue",
          content: `SLA estourado: ${Math.floor(elapsedSeconds / 60)} minutos sem resposta`,
          metadata: {
            elapsed_seconds: elapsedSeconds,
            warn_threshold: lead.warn_after_seconds,
            overdue_threshold: lead.overdue_after_seconds,
          },
        });

        // Create timeline event
        await supabase.from("lead_timeline_events").insert({
          organization_id: lead.organization_id,
          lead_id: lead.lead_id,
          event_type: "sla_overdue",
          event_at: now.toISOString(),
          channel: "system",
          metadata: {
            elapsed_seconds: elapsedSeconds,
            overdue_threshold: lead.overdue_after_seconds,
          },
        });

        // Create notification for assigned user
        if (lead.notify_assignee && lead.assigned_user_id) {
          await fetch(`${SUPABASE_URL}/functions/v1/notification-dispatcher`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
            },
            body: JSON.stringify({
              event_key: "sla_overdue",
              organization_id: lead.organization_id,
              user_id: lead.assigned_user_id,
              variables: { lead_name: lead.lead_name, minutes: Math.floor(elapsedSeconds / 60) },
              lead_id: lead.lead_id,
              dedupe_key: `sla_overdue:${lead.lead_id}:${now.getHours()}`
            }),
          });
        }


        // Notify managers if configured
        if (lead.notify_manager) {
          const { data: managers } = await supabase
            .from("users")
            .select("id")
            .eq("organization_id", lead.organization_id)
            .in("role", ["admin", "manager"]);

          if (managers) {
            for (const manager of managers) {
              if (manager.id !== lead.assigned_user_id) {
                await fetch(`${SUPABASE_URL}/functions/v1/notification-dispatcher`, {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
                  },
                  body: JSON.stringify({
                    event_key: "sla_overdue_manager",
                    organization_id: lead.organization_id,
                    user_id: manager.id,
                    variables: { lead_name: lead.lead_name, minutes: Math.floor(elapsedSeconds / 60) },
                    lead_id: lead.lead_id,
                    dedupe_key: `sla_overdue_manager:${lead.lead_id}:${manager.id}:${now.getHours()}`
                  }),
                });
              }
            }
          }
        }

        console.log(`Created OVERDUE notification for lead ${lead.lead_id}`);
      }

      // Update lead
      await supabase.from("leads").update(updateData).eq("id", lead.lead_id);
    }

    const result = {
      success: true,
      processed: pendingLeads.length,
      warnings_created: warningsCreated,
      overdues_created: overduesCreated,
      timestamp: now.toISOString(),
    };

    console.log("SLA Checker completed:", result);

    return new Response(
      JSON.stringify(result),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: unknown) {
    console.error("SLA Checker error:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
