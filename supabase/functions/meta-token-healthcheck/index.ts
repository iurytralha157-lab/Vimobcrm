
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const META_APP_ID = Deno.env.get("META_APP_ID") || "";
const META_APP_SECRET = Deno.env.get("META_APP_SECRET") || "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    
    // Get all connected integrations
    const { data: integrations, error: fetchError } = await supabase
      .from("meta_integrations")
      .select("*")
      .eq("is_connected", true);

    if (fetchError) throw fetchError;

    const results = [];

    for (const integration of integrations) {
      console.log(`Checking health for page: ${integration.page_name} (${integration.page_id})`);
      
      const debugTokenUrl = `https://graph.facebook.com/debug_token?input_token=${integration.access_token}&access_token=${META_APP_ID}|${META_APP_SECRET}`;
      
      try {
        const response = await fetch(debugTokenUrl);
        const data = await response.json();
        
        const patch: any = {
          last_validated_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };

        if (data.data?.is_valid) {
          patch.token_status = "active";
          if (data.data.data_access_expires_at) {
            patch.token_expires_at = new Date(data.data.data_access_expires_at * 1000).toISOString();
          }
          console.log(`Integration ${integration.page_id} is healthy.`);
        } else {
          console.warn(`Integration ${integration.page_id} token is INVALID:`, data.error || data.data?.error);
          patch.token_status = "expired";
          patch.is_connected = false;
          patch.last_error = data.error?.message || data.data?.error?.message || "Token invalid or expired";
        }

        await supabase.from("meta_integrations").update(patch).eq("id", integration.id);
        results.push({ id: integration.id, status: patch.token_status });
      } catch (e) {
        console.error(`Error debugging token for ${integration.page_id}:`, e);
        results.push({ id: integration.id, status: "error", error: e.message });
      }
    }

    return new Response(JSON.stringify({ success: true, processed: results.length, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Health check error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
