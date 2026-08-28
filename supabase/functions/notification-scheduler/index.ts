import { createClient } from "npm:@supabase/supabase-js@2";
import { authorizePrivateWorkerRequest } from "../_shared/private-worker-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const REMINDER_INTERVALS = [
  { minutes: 30, type: "reminder", target: "user" },
  { minutes: 15, type: "reminder", target: "user" },
  { minutes: 10, type: "reminder", target: "user" },
  { minutes: 5, type: "reminder", target: "user" },
  { minutes: 0, type: "starting_now", target: "user" },
] as const;

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
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const now = new Date();

    const { data: upcomingEvents, error: eventsError } = await supabase
      .from("schedule_events")
      .select(`
        id, user_id, organization_id, title, start_time, lead_id, event_type,
        lead:leads(id, name, phone)
      `)
      .neq("status", "cancelled")
      .gte("start_time", new Date(now.getTime() - 5 * 60 * 1000).toISOString())
      .lte("start_time", new Date(now.getTime() + 70 * 60 * 1000).toISOString());

    if (eventsError) throw eventsError;

    console.log(`Processing ${upcomingEvents?.length || 0} upcoming events at ${now.toISOString()}`);

    for (const event of upcomingEvents || []) {
      const startTime = new Date(event.start_time);
      const diffMinutes = Math.round((startTime.getTime() - now.getTime()) / (1000 * 60));
      const eventType = event.event_type;
      const isCritical = ["meeting", "visit", "call"].includes(eventType || "");

      console.log(`Checking event "${event.title}" (${event.id}) - Type: ${eventType} - Starts in ${diffMinutes}m`);

      for (const interval of REMINDER_INTERVALS) {
        if (!isCritical && interval.minutes <= 30) {
          continue;
        }

        if (diffMinutes < interval.minutes - 1 || diffMinutes > interval.minutes + 1) {
          continue;
        }

        const reminderTag = `[EVT_${event.id}_${interval.minutes}_${interval.target}]`;

        const { data: existingNotif } = await supabase
          .from("notification_logs")
          .select("id")
          .eq("dedupe_key", reminderTag)
          .limit(1);

        if (existingNotif && existingNotif.length > 0) {
          console.log(`Reminder ${reminderTag} already sent, skipping.`);
          continue;
        }

        const formattedTime = startTime.toLocaleTimeString("pt-BR", {
          hour: "2-digit",
          minute: "2-digit",
          timeZone: "America/Sao_Paulo",
        });

        console.log(`Sending user appointment reminder: ${reminderTag}`);

        await fetch(`${supabaseUrl}/functions/v1/notification-dispatcher`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${supabaseServiceKey}`,
          },
          body: JSON.stringify({
            event_key: "appointment_reminder",
            organization_id: event.organization_id,
            user_id: event.user_id,
            lead_id: event.lead_id,
            variables: {
              titulo: event.title,
              horario: formattedTime,
              minutos: interval.minutes,
              nome_lead: event.lead?.name || "Nao informado",
            },
            dedupe_key: reminderTag,
          }),
        });
      }
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = today.toISOString().split("T")[0];

    const { data: financialEntries, error: financialError } = await supabase
      .from("financial_entries")
      .select(`
        id,
        organization_id,
        type,
        description,
        amount,
        due_date,
        organization:organizations(is_financial_module_enabled)
      `)
      .eq("status", "pending");

    if (financialError) {
      console.error("Error fetching financial entries:", financialError);
    }

    for (const entry of financialEntries || []) {
      const org = entry.organization as any;
      if (!org?.is_financial_module_enabled) continue;

      const typeLabel = entry.type === "payable" ? "A Pagar" : "A Receber";
      let fTitle = "";
      if (entry.due_date === todayStr) fTitle = "Conta vence hoje!";
      else if (entry.due_date < todayStr) fTitle = "Conta em atraso!";

      if (fTitle) {
        const { data: admins } = await supabase
          .from("users")
          .select("id")
          .eq("organization_id", entry.organization_id)
          .eq("role", "admin");

        for (const admin of admins || []) {
          const { data: existing } = await supabase
            .from("notifications")
            .select("id")
            .eq("user_id", admin.id)
            .ilike("title", fTitle)
            .ilike("content", `%${entry.description}%`)
            .gte("created_at", today.toISOString())
            .limit(1);

          if (existing?.length === 0) {
            await supabase.from("notifications").insert({
              user_id: admin.id,
              organization_id: entry.organization_id,
              title: fTitle,
              content: `${typeLabel}: ${entry.description}`,
              type: "commission",
            });
          }
        }
      }
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Scheduler error:", error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
