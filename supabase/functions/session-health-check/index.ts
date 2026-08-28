import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function checkInstanceConnection(
  session: any
): Promise<{ isConnected: boolean; data: any }> {
  const isGo = session.provider === "evolution_go";
  const evolutionUrl = isGo ? Deno.env.get("EVOLUTION_GO_API_URL") : Deno.env.get("EVOLUTION_API_URL");
  const evolutionKey = isGo ? Deno.env.get("EVOLUTION_GO_API_KEY") : Deno.env.get("EVOLUTION_API_KEY");

  if (!evolutionUrl || !evolutionKey) {
    throw new Error(`Missing config for provider ${session.provider}`);
  }

  const endpoint = isGo 
    ? `/instance/status?instanceId=${session.instance_id || session.instance_name}` 
    : `/instance/connectionState/${session.instance_name}`;
  
  const response = await fetch(`${evolutionUrl}${endpoint}`, {
    headers: { "apikey": evolutionKey }
  });
  
  if (!response.ok) {
    return { isConnected: false, data: { status: response.status, error: "HTTP error" } };
  }

  const data = await response.json();
  
  let isConnected = false;
  if (isGo) {
    const s = data?.data?.data ?? data?.data ?? {};
    isConnected = s.connected === true || s.Connected === true || s.state === "open" || s.LoggedIn === true;
  } else {
    const state = (data?.instance?.state || data?.state || "").toLowerCase();
    isConnected = state === "open" || state === "connected";
  }
  
  return { isConnected, data };
}

function isAuthorizedCronCall(req: Request): boolean {
  const cronSecret = Deno.env.get('CRON_SECRET');
  if (!cronSecret) return false;
  const provided = req.headers.get('x-cron-secret');
  return !!provided && provided === cronSecret;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Restrict invocation to authorized cron callers (shared secret) or super_admin JWTs.
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    if (!isAuthorizedCronCall(req)) {
      const authHeader = req.headers.get('Authorization');
      if (!authHeader?.startsWith('Bearer ')) {
        return new Response(JSON.stringify({ success: false, error: 'Unauthorized' }), {
          status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const token = authHeader.replace('Bearer ', '');
      const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
      if (authErr || !user) {
        return new Response(JSON.stringify({ success: false, error: 'Invalid token' }), {
          status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const { data: profile } = await supabase.from('users').select('role').eq('id', user.id).single();
      if (profile?.role !== 'super_admin') {
        return new Response(JSON.stringify({ success: false, error: 'Forbidden' }), {
          status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    const { data: sessions, error: sessionsError } = await supabase
      .from("whatsapp_sessions")
      .select("*")
      .in("status", ["connected", "connecting"])
      .order("updated_at", { ascending: true, nullsFirst: true })
      .limit(20);

    if (sessionsError) {
      console.error("Error fetching sessions:", sessionsError);
      return new Response(
        JSON.stringify({ success: false, error: sessionsError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Processing ${sessions?.length || 0} sessions for health check`);

    const results = [];

    for (const session of sessions || []) {
      try {
        const firstCheck = await checkInstanceConnection(session);
        console.log(`Health check #1 for ${session.instance_name}:`, firstCheck.data);

        const updateData: any = {
          updated_at: new Date().toISOString(),
        };

        if (firstCheck.isConnected) {
          if (session.status !== "connected") {
            updateData.status = "connected";
            updateData.last_connected_at = new Date().toISOString();
          }

          await supabase
            .from("whatsapp_sessions")
            .update(updateData)
            .eq("id", session.id);

          results.push({
            session_id: session.id,
            instance_name: session.instance_name,
            previous_status: session.status,
            new_status: "connected",
            success: true
          });
        } else {
          console.log(`Session ${session.instance_name} failed first check, retrying in 3s...`);
          await new Promise(resolve => setTimeout(resolve, 3000));

          const secondCheck = await checkInstanceConnection(session);
          console.log(`Health check #2 for ${session.instance_name}:`, secondCheck.data);

          if (secondCheck.isConnected) {
            console.log(`Session ${session.instance_name} recovered on retry - keeping connected`);
            
            if (session.status !== "connected") {
              updateData.status = "connected";
              updateData.last_connected_at = new Date().toISOString();
            }

            await supabase
              .from("whatsapp_sessions")
              .update(updateData)
              .eq("id", session.id);

            results.push({
              session_id: session.id,
              instance_name: session.instance_name,
              previous_status: session.status,
              new_status: "connected",
              retried: true,
              success: true
            });
          } else {
            console.log(`Session ${session.instance_name} confirmed disconnected after retry`);
            updateData.status = "disconnected";

            const displayName = session.display_name || session.instance_name;

            // Notify session owner via Dispatcher
            await fetch(`${SUPABASE_URL}/functions/v1/notification-dispatcher`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
              },
              body: JSON.stringify({
                event_key: "whatsapp_disconnected",
                organization_id: session.organization_id,
                user_id: session.owner_user_id,
                variables: { nome_sessao: displayName },
                dedupe_key: `whatsapp_disconnected:${session.id}:${session.owner_user_id}`
              }),
            });

            // Notify admins
            const { data: admins } = await supabase
              .from("users")
              .select("id")
              .eq("organization_id", session.organization_id)
              .eq("role", "admin")
              .neq("id", session.owner_user_id);

            if (admins && admins.length > 0) {
              for (const admin of admins) {
                await fetch(`${SUPABASE_URL}/functions/v1/notification-dispatcher`, {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
                  },
                  body: JSON.stringify({
                    event_key: "whatsapp_disconnected_admin",
                    organization_id: session.organization_id,
                    user_id: admin.id,
                    variables: { nome_sessao: displayName },
                    dedupe_key: `whatsapp_disconnected:${session.id}:${admin.id}`
                  }),
                });
              }
            }

            await supabase
              .from("whatsapp_sessions")
              .update(updateData)
              .eq("id", session.id);

            // Audit log
            await supabase.from("audit_logs").insert({
              action: "whatsapp.session_disconnected",
              entity_type: "whatsapp_session",
              entity_id: session.id,
              organization_id: session.organization_id,
              new_data: {
                instance_name: session.instance_name,
                previous_status: session.status,
                new_status: "disconnected",
                first_check: firstCheck.data,
                second_check: secondCheck.data,
              }
            });

            console.log(`Session ${session.instance_name} status changed: ${session.status} -> disconnected`);

            results.push({
              session_id: session.id,
              instance_name: session.instance_name,
              previous_status: session.status,
              new_status: "disconnected",
              retried: true,
              success: true
            });
          }
        }

      } catch (error) {
        console.error(`Error checking session ${session.instance_name}:`, error);
        results.push({
          session_id: session.id,
          instance_name: session.instance_name,
          success: false,
          error: error instanceof Error ? error.message : "Unknown error"
        });
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        processed: results.length,
        results
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Session health check error:", error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});