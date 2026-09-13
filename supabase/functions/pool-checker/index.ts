import { createClient } from "npm:@supabase/supabase-js@2";
import { authorizePrivateWorkerRequest } from "../_shared/private-worker-auth.ts";
import { buildDistributionIdempotencyKey } from "../_shared/distribution-idempotency.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface LeadToRedistribute {
  id: string;
  name: string;
  organization_id: string;
  assigned_user_id: string;
  assigned_at: string;
  created_at: string;
  stage_id: string | null;
  stage_entered_at: string | null;
  deal_status: string | null;
  first_response_at: string | null;
  first_touch_at: string | null;
  last_contact_at: string | null;
  owner_last_activity_at: string | null;
  redistribution_warning_sent_at: string | null;
  redistribution_count: number | null;
  pipeline_id: string;
  distribution_round_robin_id?: string | null;
  distribution_assignment_at?: string | null;
}

interface DistributionAssignment {
  lead_id: string;
  assigned_user_id: string;
  round_robin_id: string | null;
  reason: string | null;
  created_at: string;
  assigned_at: string | null;
}

const LEAD_SELECT =
  "id, name, organization_id, assigned_user_id, assigned_at, created_at, stage_id, stage_entered_at, deal_status, first_response_at, first_touch_at, last_contact_at, owner_last_activity_at, redistribution_warning_sent_at, redistribution_count, pipeline_id";

const CLOSED_DEAL_STATUSES = new Set([
  "won",
  "ganho",
  "lost",
  "perdido",
  "closed",
  "fechado",
]);
const HUMAN_ACTIVITY_EVENT_TYPES = new Set([
  "whatsapp_message_sent",
  "first_response",
  "call_initiated",
  "call_completed",
  "note_created",
  "stage_changed",
  "agenda_created",
  "agenda_rescheduled",
  "agenda_completed",
  "agenda_cancelled",
  "schedule_comment",
]);

function isClosedDealStatus(status: string | null | undefined) {
  return CLOSED_DEAL_STATUSES.has(
    String(status || "open").trim().toLowerCase(),
  );
}

function toDate(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function fiveSecondsBefore(date: Date) {
  return new Date(date.getTime() - 5_000);
}

function tenSecondsAfter(date: Date) {
  return new Date(date.getTime() + 10_000);
}

async function getClosedStageIds(supabase: any, pipelineId: string) {
  const { data, error } = await supabase
    .from("stages")
    .select("id, is_won, is_lost")
    .eq("pipeline_id", pipelineId);

  if (error) {
    throw new Error(`pool_closed_stage_lookup_failed:${error.message}`);
  }

  return new Set<string>(
    (data || [])
      .filter((stage: any) => Boolean(stage.is_won) || Boolean(stage.is_lost))
      .map((stage: any) => stage.id),
  );
}

async function filterRedistributableLeads(
  supabase: any,
  leads: LeadToRedistribute[],
  poolActivationDate: string,
  closedStageIds: Set<string>,
) {
  const baseFiltered = leads.filter((lead) => {
    if (!lead.assigned_user_id || !lead.assigned_at) return false;
    if (isClosedDealStatus(lead.deal_status)) return false;
    if (lead.stage_id && closedStageIds.has(lead.stage_id)) return false;
    if (
      lead.first_response_at || lead.first_touch_at ||
      lead.owner_last_activity_at || lead.last_contact_at
    ) return false;

    const assignedAt = toDate(lead.assigned_at);
    const stageEnteredAt = toDate(lead.stage_entered_at);
    if (
      assignedAt && stageEnteredAt &&
      stageEnteredAt > tenSecondsAfter(assignedAt)
    ) return false;

    return true;
  });

  if (baseFiltered.length === 0) return [];

  const leadById = new Map(baseFiltered.map((lead) => [lead.id, lead]));
  const leadIds = [...leadById.keys()];

  const { data: assignments, error: assignmentError } = await supabase
    .from("assignments_log")
    .select(
      "lead_id, assigned_user_id, round_robin_id, reason, created_at, assigned_at",
    )
    .in("lead_id", leadIds)
    .in("reason", ["round_robin_auto", "round_robin", "canonical_round_robin"])
    .not("round_robin_id", "is", null)
    .order("created_at", { ascending: false });

  if (assignmentError) {
    throw new Error(
      `pool_distribution_assignment_lookup_failed:${assignmentError.message}`,
    );
  }

  const assignmentByLead = new Map<string, DistributionAssignment>();
  for (const assignment of (assignments || []) as DistributionAssignment[]) {
    const lead = leadById.get(assignment.lead_id);
    if (!lead) continue;
    if (assignment.assigned_user_id !== lead.assigned_user_id) continue;
    if (!assignmentByLead.has(assignment.lead_id)) {
      assignmentByLead.set(assignment.lead_id, assignment);
    }
  }

  const activationAt = toDate(poolActivationDate);
  const queueLeads = baseFiltered.filter((lead) => {
    const assignment = assignmentByLead.get(lead.id);
    if (!assignment) return false;

    const assignmentAt = toDate(assignment.assigned_at) ||
      toDate(assignment.created_at) || toDate(lead.assigned_at) ||
      toDate(lead.created_at);
    if (!assignmentAt) return false;
    if (activationAt && assignmentAt < activationAt) return false;

    return true;
  });

  if (queueLeads.length === 0) return [];

  const assignmentTimes = queueLeads
    .map((lead) => {
      const assignment = assignmentByLead.get(lead.id);
      return toDate(assignment?.assigned_at) ||
        toDate(assignment?.created_at) || toDate(lead.assigned_at) ||
        toDate(lead.created_at);
    })
    .filter(Boolean) as Date[];
  const earliestActivityBoundary = new Date(
    Math.min(
      ...assignmentTimes.map((date) => fiveSecondsBefore(date).getTime()),
    ),
  ).toISOString();
  const queueLeadIds = queueLeads.map((lead) => lead.id);

  const [
    { data: timelineEvents, error: timelineError },
    { data: whatsappMessages, error: whatsappError },
  ] = await Promise.all([
    supabase
      .from("lead_timeline_events")
      .select("lead_id, event_type, created_at")
      .in("lead_id", queueLeadIds)
      .gte("created_at", earliestActivityBoundary),
    supabase
      .from("whatsapp_messages")
      .select("lead_id, created_at, from_me, sender_user_id")
      .in("lead_id", queueLeadIds)
      .gte("created_at", earliestActivityBoundary),
  ]);

  if (timelineError) {
    throw new Error(
      `pool_timeline_activity_lookup_failed:${timelineError.message}`,
    );
  }

  if (whatsappError) {
    throw new Error(
      `pool_whatsapp_activity_lookup_failed:${whatsappError.message}`,
    );
  }

  const timelineByLead = new Map<
    string,
    Array<{ event_type: string; created_at: string }>
  >();
  for (const event of timelineEvents || []) {
    if (!HUMAN_ACTIVITY_EVENT_TYPES.has(event.event_type)) continue;
    const events = timelineByLead.get(event.lead_id) || [];
    events.push(event);
    timelineByLead.set(event.lead_id, events);
  }

  const whatsappByLead = new Map<
    string,
    Array<
      { created_at: string; from_me: boolean; sender_user_id: string | null }
    >
  >();
  for (const message of whatsappMessages || []) {
    if (!message.from_me && !message.sender_user_id) continue;
    const messages = whatsappByLead.get(message.lead_id) || [];
    messages.push(message);
    whatsappByLead.set(message.lead_id, messages);
  }

  return queueLeads.filter((lead) => {
    const assignment = assignmentByLead.get(lead.id);
    const assignmentAt = toDate(assignment?.assigned_at) ||
      toDate(assignment?.created_at) || toDate(lead.assigned_at) ||
      toDate(lead.created_at);
    if (!assignmentAt) return false;

    const activityBoundary = fiveSecondsBefore(assignmentAt);
    const hasTimelineActivity = (timelineByLead.get(lead.id) || []).some(
      (event) => {
        const eventAt = toDate(event.created_at);
        return Boolean(eventAt && eventAt >= activityBoundary);
      },
    );
    if (hasTimelineActivity) return false;

    const hasWhatsAppActivity = (whatsappByLead.get(lead.id) || []).some(
      (message) => {
        const messageAt = toDate(message.created_at);
        return Boolean(messageAt && messageAt >= activityBoundary);
      },
    );
    if (hasWhatsAppActivity) return false;

    return true;
  }).map((lead) => {
    const assignment = assignmentByLead.get(lead.id);
    return {
      ...lead,
      distribution_round_robin_id: assignment?.round_robin_id ?? null,
      distribution_assignment_at: assignment?.assigned_at ||
        assignment?.created_at || lead.assigned_at || lead.created_at,
    };
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", {
      status: 405,
      headers: corsHeaders,
    });
  }

  if (!authorizePrivateWorkerRequest(req)) {
    return new Response(
      JSON.stringify({ error: "Unauthorized" }),
      {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get(
      "SUPABASE_SERVICE_ROLE_KEY",
    )!;

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    console.log("Starting pool checker...");

    // Get all pipelines with pool enabled
    const { data: pipelines, error: pipelineError } = await supabase
      .from("pipelines")
      .select(
        "id, organization_id, pool_enabled, pool_timeout_minutes, pool_warning_minutes, pool_max_redistributions, pool_enabled_at",
      )
      .eq("pool_enabled", true);

    if (pipelineError) {
      console.error("Error fetching pipelines:", pipelineError);
      return new Response(
        JSON.stringify({ success: false, error: pipelineError.message }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    if (!pipelines || pipelines.length === 0) {
      console.log("No pipelines with pool enabled");
      return new Response(
        JSON.stringify({
          success: true,
          message: "No pipelines with pool enabled",
          redistributed: 0,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    console.log(`Found ${pipelines.length} pipelines with pool enabled`);

    const results: Array<{
      leadId: string;
      success: boolean;
      skipped?: boolean;
      error?: string;
    }> = [];
    const warningResults: Array<{
      leadId: string;
      success: boolean;
      skipped?: boolean;
      error?: string;
    }> = [];

    for (const pipeline of pipelines) {
      const timeoutMinutes = pipeline.pool_timeout_minutes || 10;
      const warningMinutes = Math.max(
        0,
        Math.min(pipeline.pool_warning_minutes ?? 2, timeoutMinutes - 1),
      );
      const maxRedistributions = pipeline.pool_max_redistributions ?? 3;
      const cutoffTime = new Date(Date.now() - timeoutMinutes * 60 * 1000)
        .toISOString();
      const warningCutoffTime = new Date(
        Date.now() - Math.max(1, timeoutMinutes - warningMinutes) * 60 * 1000,
      ).toISOString();

      // Only process leads assigned after redistribution was enabled.
      const poolActivationDate = pipeline.pool_enabled_at ||
        new Date().toISOString();
      const closedStageIds = await getClosedStageIds(supabase, pipeline.id);

      console.log(
        `Checking pipeline ${pipeline.id}: timeout=${timeoutMinutes}min, warning=${warningMinutes}min, max=${maxRedistributions}, activation=${poolActivationDate}`,
      );

      if (warningMinutes > 0) {
        let warningQuery = supabase
          .from("leads")
          .select(LEAD_SELECT)
          .eq("pipeline_id", pipeline.id)
          .eq("deal_status", "open")
          .not("assigned_user_id", "is", null)
          .not("assigned_at", "is", null)
          .is("first_response_at", null)
          .is("first_touch_at", null)
          .is("owner_last_activity_at", null)
          .is("last_contact_at", null)
          .is("redistribution_warning_sent_at", null)
          .gt("assigned_at", poolActivationDate)
          .lt("assigned_at", warningCutoffTime)
          .gte("assigned_at", cutoffTime);

        if (maxRedistributions > 0) {
          warningQuery = warningQuery.or(
            `redistribution_count.is.null,redistribution_count.lt.${maxRedistributions}`,
          );
        }

        const { data: warningLeads, error: warningError } = await warningQuery;

        if (warningError) {
          throw new Error(
            `pool_warning_candidate_query_failed:${warningError.message}`,
          );
        } else {
          const eligibleWarningLeads = await filterRedistributableLeads(
            supabase,
            (warningLeads || []) as LeadToRedistribute[],
            poolActivationDate,
            closedStageIds,
          );

          for (const lead of eligibleWarningLeads) {
            const warningAttemptedAt = new Date().toISOString();
            const { data: warningResult, error: warningRpcError } =
              await supabase.rpc(
                "send_pool_redistribution_warning_from_backend",
                {
                  p_organization_id: lead.organization_id,
                  p_lead_id: lead.id,
                  p_round_robin_id: lead.distribution_round_robin_id,
                  p_expected_assigned_user_id: lead.assigned_user_id,
                  p_expected_lead_assigned_at: lead.assigned_at,
                  p_expected_distribution_assignment_at:
                    lead.distribution_assignment_at,
                  p_expected_redistribution_count: Number(
                    lead.redistribution_count || 0,
                  ),
                  p_now: warningAttemptedAt,
                },
              );

            if (warningRpcError) {
              console.error(
                `Error sending pool warning for lead ${lead.id}:`,
                warningRpcError,
              );
              warningResults.push({
                leadId: lead.id,
                success: false,
                error: warningRpcError.message,
              });
            } else if (warningResult?.success) {
              warningResults.push({
                leadId: lead.id,
                success: true,
                skipped: Boolean(warningResult?.skipped),
                error: warningResult?.skipped
                  ? String(warningResult?.reason || "skipped")
                  : undefined,
              });
            } else {
              warningResults.push({
                leadId: lead.id,
                success: false,
                error: String(warningResult?.reason || "warning_failed"),
              });
            }
          }
        }
      }

      // Find leads that need redistribution:
      // - Have an assigned user
      // - Were assigned by a distribution queue after the pool activation date
      // - Were assigned before the cutoff time
      // - Are open and not in won/lost stages
      // - Have no contact, owner activity, timeline movement, call/schedule/note, or human WhatsApp message
      // - Haven't exceeded max redistributions
      let leadsQuery = supabase
        .from("leads")
        .select(LEAD_SELECT)
        .eq("pipeline_id", pipeline.id)
        .eq("deal_status", "open")
        .not("assigned_user_id", "is", null)
        .not("assigned_at", "is", null)
        .is("first_response_at", null)
        .is("first_touch_at", null)
        .is("owner_last_activity_at", null)
        .is("last_contact_at", null)
        .gt("assigned_at", poolActivationDate)
        .lt("assigned_at", cutoffTime);

      if (maxRedistributions > 0) {
        // Legacy rows may still have a NULL counter; the database aggregate
        // treats that state as zero, so discovery must not silently exclude it.
        leadsQuery = leadsQuery.or(
          `redistribution_count.is.null,redistribution_count.lt.${maxRedistributions}`,
        );
      }

      const { data: leads, error: leadsError } = await leadsQuery;

      if (leadsError) {
        throw new Error(
          `pool_redistribution_candidate_query_failed:${leadsError.message}`,
        );
      }

      const redistributableLeads = await filterRedistributableLeads(
        supabase,
        (leads || []) as LeadToRedistribute[],
        poolActivationDate,
        closedStageIds,
      );

      if (!redistributableLeads || redistributableLeads.length === 0) {
        console.log(`No leads to redistribute in pipeline ${pipeline.id}`);
        continue;
      }

      console.log(
        `Found ${redistributableLeads.length} leads to redistribute in pipeline ${pipeline.id}`,
      );

      for (const lead of redistributableLeads) {
        try {
          console.log(`Redistributing lead ${lead.id} (${lead.name})`);

          const distributionIdempotencyKey =
            await buildDistributionIdempotencyKey(
              "pool-timeout",
              {
                leadId: lead.id,
                assignedUserId: lead.assigned_user_id,
                assignmentAt: lead.distribution_assignment_at ||
                  lead.assigned_at,
                roundRobinId: lead.distribution_round_robin_id || null,
                redistributionCount: lead.redistribution_count,
              },
            );
          const attemptedAt = new Date().toISOString();

          if (!lead.distribution_round_robin_id) {
            throw new Error("pool_distribution_queue_missing");
          }

          // The database wrapper revalidates the stale-candidate snapshot and
          // commits canonical assignment, counter, history and notification in
          // one transaction. There is no crash window after assignment.
          const { data, error } = await supabase.rpc(
            "redistribute_lead_from_pool_backend",
            {
              p_organization_id: lead.organization_id,
              p_lead_id: lead.id,
              p_idempotency_key: distributionIdempotencyKey,
              p_round_robin_id: lead.distribution_round_robin_id,
              p_expected_assigned_user_id: lead.assigned_user_id,
              p_expected_assigned_at: lead.assigned_at,
              p_expected_redistribution_count: Number(
                lead.redistribution_count || 0,
              ),
              p_now: attemptedAt,
            },
          );

          if (error) {
            console.error(`Error redistributing lead ${lead.id}:`, error);
            results.push({
              leadId: lead.id,
              success: false,
              error: (error as any)?.message,
            });
          } else if ((data as any)?.success) {
            const assignedUserId = String((data as any)?.assigned_user_id || "")
              .trim();
            if (!assignedUserId) {
              throw new Error("canonical_distribution_missing_assignee");
            }

            if (!(data as any)?.pool_finalized) {
              throw new Error("pool_distribution_not_finalized");
            }

            console.log(`Successfully redistributed lead ${lead.id}:`, data);
            results.push({ leadId: lead.id, success: true });
          } else {
            console.log(`Skipped lead ${lead.id}:`, data);
            results.push({
              leadId: lead.id,
              success: false,
              skipped: Boolean((data as any)?.skipped),
              error: (data as any)?.reason || "skipped",
            });
          }
        } catch (error) {
          console.error(`Exception redistributing lead ${lead.id}:`, error);
          results.push({
            leadId: lead.id,
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
          });
        }
      }
    }

    const successCount = results.filter((r) => r.success).length;
    const skippedCount = results.filter((r) => r.skipped).length +
      warningResults.filter((r) => r.skipped).length;
    const failCount = results.filter((r) => !r.success && !r.skipped).length +
      warningResults.filter((r) => !r.success && !r.skipped).length;

    console.log(
      `Pool checker completed: ${successCount} redistributed, ${skippedCount} skipped, ${failCount} failed`,
    );

    return new Response(
      JSON.stringify({
        success: failCount === 0,
        redistributed: successCount,
        skipped: skippedCount,
        failed: failCount,
        warnings: warningResults,
        results,
      }),
      {
        status: failCount > 0 ? 500 : 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (error) {
    console.error("Pool checker error:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
