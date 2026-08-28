
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { processLeadgenEvent } from "../_shared/meta-utils.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    
    // Select failed events that haven't reached max attempts and are ready for retry
    const { data: events, error: fetchError } = await supabase
      .from("meta_webhook_events")
      .select("*")
      .eq("status", "failed")
      .lt("attempts", 5)
      .lte("next_retry_at", new Date().toISOString())
      .limit(10); // Process in batches

    if (fetchError) throw fetchError;

    const results = [];

    for (const event of events) {
      console.log(`Replaying event: ${event.id} (Lead: ${event.leadgen_id})`);
      
      const payload = event.raw_payload;
      const firstEntry = payload?.entry?.[0] || {};
      const change = firstEntry?.changes?.[0]?.value || {};
      
      const result = await processLeadgenEvent(supabase, event.page_id, change, event.id);
      
      const patch: any = {
        status: result.status,
        processed_at: new Date().toISOString(),
        attempts: (event.attempts || 0) + 1,
        organization_id: result.organization_id || event.organization_id,
        error_message: result.error || null,
        last_error: result.error || null,
      };

      if (result.status === "failed") {
        // Schedule next retry (exponential backoff: 5min, 15min, 1h, 4h)
        const backoffMinutes = [5, 15, 60, 240];
        const wait = backoffMinutes[event.attempts] || 480;
        patch.next_retry_at = new Date(Date.now() + wait * 60000).toISOString();
      }

      await supabase.from("meta_webhook_events").update(patch).eq("id", event.id);
      results.push({ id: event.id, status: result.status });
    }

    return new Response(JSON.stringify({ success: true, processed: results.length, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Replay error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
