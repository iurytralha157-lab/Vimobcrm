import { createClient } from "npm:@supabase/supabase-js@2";
import { withWhatsAppLegacyHttpDeadline } from "../_shared/whatsapp-legacy-http.ts";
import { observedWhatsAppConnection } from "../_shared/whatsapp-connection-state.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Verify caller is super_admin — auth is REQUIRED (no optional bypass).
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ success: false, error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) {
      return new Response(
        JSON.stringify({ success: false, error: "Invalid token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const { data: userData, error: profileError } = await supabase
      .from("users")
      .select("role, is_active")
      .eq("id", user.id)
      .single();
    if (profileError || userData?.role !== "super_admin" || userData?.is_active !== true) {
      return new Response(
        JSON.stringify({ success: false, error: "Forbidden" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { instance_name } = await req.json();

    if (!instance_name) {
      return new Response(
        JSON.stringify({ success: false, error: "instance_name is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const EVOLUTION_API_URL = Deno.env.get("EVOLUTION_API_URL");
    const EVOLUTION_API_KEY = Deno.env.get("EVOLUTION_API_KEY");

    if (!EVOLUTION_API_URL || !EVOLUTION_API_KEY) {
      return new Response(
        JSON.stringify({ success: false, error: "Evolution API not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { response, data } = await withWhatsAppLegacyHttpDeadline(`${EVOLUTION_API_URL}/instance/connectionState/${instance_name}`, {
      method: "GET",
      headers: {
        "apikey": EVOLUTION_API_KEY,
      },
    }, async response => ({ response, data: await response.json() }));
    console.log("Global WhatsApp status check completed", { status: response.status });

    if (!response.ok) throw new Error(`whatsapp_status_unavailable:${response.status}`);
    const isConnected = observedWhatsAppConnection(data, false);
    if (isConnected === null) throw new Error("whatsapp_status_unknown");

    return new Response(
      JSON.stringify({ success: true, connected: isConnected, data }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Global WhatsApp status check failed");
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
