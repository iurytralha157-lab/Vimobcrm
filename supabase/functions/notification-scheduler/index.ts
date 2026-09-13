import { createClient } from "npm:@supabase/supabase-js@2.112.4";
import { authorizePrivateWorkerRequest } from "../_shared/private-worker-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function firstRelation<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] || null;
  return value || null;
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
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

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
      const org = firstRelation(entry.organization);
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
