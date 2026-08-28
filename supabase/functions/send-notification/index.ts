import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { authorizePrivateWorkerRequest } from "../_shared/private-worker-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface NotificationPayload {
  user_id?: string;
  user_ids?: string[];
  organization_id: string;
  title: string;
  content?: string;
  type?: string;
  lead_id?: string;
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
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const payload: NotificationPayload = await req.json();
    console.log("[Send Notification] Payload:", JSON.stringify(payload));

    if (!payload.organization_id || !payload.title) {
      return new Response(
        JSON.stringify({ error: "organization_id and title are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const userIds: string[] = [];

    if (payload.user_id) {
      userIds.push(payload.user_id);
    } else if (payload.user_ids && payload.user_ids.length > 0) {
      userIds.push(...payload.user_ids);
    } else {
      // Send to all users in organization
      const { data: users, error: usersError } = await supabase
        .from("users")
        .select("id")
        .eq("organization_id", payload.organization_id)
        .eq("is_active", true);

      if (usersError) {
        console.error("[Send Notification] Error fetching users:", usersError);
        return new Response(
          JSON.stringify({ error: "Failed to fetch users" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (users) {
        userIds.push(...users.map((u) => u.id));
      }
    }

    if (userIds.length === 0) {
      return new Response(
        JSON.stringify({ error: "No users to notify" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("[Send Notification] Sending to users:", userIds);

    const notifications = userIds.map((userId) => ({
      user_id: userId,
      organization_id: payload.organization_id,
      title: payload.title,
      content: payload.content || null,
      type: payload.type || "info",
      lead_id: payload.lead_id || null,
      is_read: false,
    }));

    const { data, error } = await supabase
      .from("notifications")
      .insert(notifications)
      .select("id");

    if (error) {
      console.error("[Send Notification] Error inserting:", error);
      return new Response(
        JSON.stringify({ error: "Failed to create notifications" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("[Send Notification] Created:", data?.length, "notifications");

    return new Response(
      JSON.stringify({ success: true, count: data?.length || 0 }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[Send Notification] Error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
