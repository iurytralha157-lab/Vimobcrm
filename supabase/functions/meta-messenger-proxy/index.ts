import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const META_GRAPH_VERSION = Deno.env.get("META_GRAPH_VERSION") || "v25.0";
const META_GRAPH_BASE_URL = `https://graph.facebook.com/${META_GRAPH_VERSION}`;

const jsonResponse = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") || "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || ""
    );

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return jsonResponse({ error: "No authorization header" }, 401);

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    if (userError || !user) return jsonResponse({ error: "Invalid token" }, 401);

    const { data: profile, error: profileError } = await supabase
      .from("users")
      .select("organization_id")
      .eq("id", user.id)
      .single();

    if (profileError || !profile?.organization_id) {
      return jsonResponse({ error: "User organization not found" }, 403);
    }

    const body = await req.json();
    const { action, platform, recipientId, text, conversationId } = body;

    console.log(`Meta Proxy Action: ${action}`, { platform, recipientId, conversationId });

    if (action === "sendMessage") {
      if (!conversationId || !recipientId || !text?.trim()) {
        return jsonResponse({ error: "Missing conversationId, recipientId or text" }, 400);
      }

      const { data: conversation, error: conversationError } = await supabase
        .from("meta_conversations")
        .select("id, page_id, organization_id, external_id")
        .eq("id", conversationId)
        .eq("organization_id", profile.organization_id)
        .single();

      if (conversationError || !conversation) {
        return jsonResponse({ error: "Conversation not found for this organization" }, 403);
      }

      if (!conversation.page_id) {
        return jsonResponse({ error: "Conversation has no linked Meta page" }, 400);
      }

      if (conversation.external_id !== recipientId) {
        return jsonResponse({ error: "Recipient does not match conversation" }, 403);
      }

      const { data: integration } = await supabase
        .from("meta_integrations")
        .select("access_token")
        .eq("page_id", conversation.page_id)
        .eq("organization_id", profile.organization_id)
        .eq("is_connected", true)
        .single();

      if (!integration?.access_token) {
        return jsonResponse({ error: "Connected integration not found for this page" }, 403);
      }

      const url = `${META_GRAPH_BASE_URL}/me/messages?access_token=${integration.access_token}`;
      
      const payload = {
        recipient: { id: recipientId },
        message: { text: text.trim() }
      };

      console.log("Sending message to Meta API...");
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const result = await response.json();
      if (result.error) {
        console.error("Meta API Error:", result.error);
        throw new Error(result.error.message);
      }

      await supabase.from("meta_messages").insert({
        conversation_id: conversationId,
        external_id: result.message_id,
        content: text.trim(),
        message_type: "text",
        from_me: true,
        sent_at: new Date().toISOString()
      });

      await supabase.from("meta_conversations").update({
        last_message: text.trim(),
        last_message_at: new Date().toISOString()
      }).eq("id", conversationId);

      return jsonResponse(result);
    }

    return jsonResponse({ error: "Unknown action" }, 400);
  } catch (error) {
    console.error("Meta Proxy Error:", error.message);
    return jsonResponse({ error: error.message }, 500);
  }
});
