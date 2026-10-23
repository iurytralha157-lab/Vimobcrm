import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { withWhatsAppLegacyHttpDeadline } from "../_shared/whatsapp-legacy-http.ts";
import { observedWhatsAppConnection } from "../_shared/whatsapp-connection-state.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface SessionRecord {
  id: string;
  provider: string;
  instance_id: string | null;
  instance_name: string;
  status: string;
  is_active: boolean | null;
  display_name: string | null;
  organization_id: string;
  owner_user_id: string;
  updated_at: string;
  last_connected_at: string | null;
  created_at: string;
}

async function checkInstanceConnection(
  session: Pick<SessionRecord, "provider" | "instance_id" | "instance_name">,
): Promise<{ isConnected: boolean; data: unknown }> {
  const isGo = session.provider === "evolution_go";
  const evolutionUrl = isGo
    ? Deno.env.get("EVOLUTION_GO_API_URL")
    : Deno.env.get("EVOLUTION_API_URL");
  const evolutionKey = isGo
    ? Deno.env.get("EVOLUTION_GO_API_KEY")
    : Deno.env.get("EVOLUTION_API_KEY");

  if (!evolutionUrl || !evolutionKey) {
    throw new Error(`Missing config for provider ${session.provider}`);
  }

  const endpoint = isGo
    ? `/instance/status?instanceId=${
      session.instance_id || session.instance_name
    }`
    : `/instance/connectionState/${session.instance_name}`;

  const { response, data } = await withWhatsAppLegacyHttpDeadline(`${evolutionUrl}${endpoint}`, {
    headers: { "apikey": evolutionKey },
  }, async response => ({ response, data: response.ok ? await response.json() as unknown : null }));
  if (!response.ok) throw new Error(`whatsapp_status_unavailable:${response.status}`);
  const isConnected = observedWhatsAppConnection(data, isGo);
  if (isConnected === null) throw new Error("whatsapp_status_unknown");

  return { isConnected, data };
}

// Optimistic fencing follows provider I/O without holding database locks.
// A newer lifecycle/webhook update wins, including when the status is unchanged.
function sessionSnapshotQuery(supabase: SupabaseClient, session: SessionRecord,
  update?: { updated_at: string; status?: "connected" | "disconnected"; last_connected_at?: string }) {
  const table = supabase.from("whatsapp_sessions");
  let query = (update ? table.update(update).select("id") : table.select("id"))
    .eq("id", session.id).eq("organization_id", session.organization_id)
    .eq("owner_user_id", session.owner_user_id).eq("provider", session.provider)
    .eq("instance_name", session.instance_name).eq("status", session.status)
    .eq("updated_at", session.updated_at);
  query = session.instance_id == null ? query.is("instance_id", null) : query.eq("instance_id", session.instance_id);
  query = session.is_active == null ? query.is("is_active", null) : query.eq("is_active", session.is_active);
  return query.maybeSingle();
}

async function requireSessionSnapshot(supabase: SupabaseClient, session: SessionRecord,
  update?: { updated_at: string; status?: "connected" | "disconnected"; last_connected_at?: string }) {
  const { data, error } = await sessionSnapshotQuery(supabase, session, update);
  if (error) throw new Error(update ? "whatsapp_session_status_update_failed" : "whatsapp_session_snapshot_lookup_failed");
  if (!data) throw new Error("whatsapp_session_snapshot_changed");
}

function isAuthorizedCronCall(req: Request): boolean {
  const cronSecret = Deno.env.get("CRON_SECRET");
  if (!cronSecret) return false;
  const provided = req.headers.get("x-cron-secret");
  return !!provided && provided === cronSecret;
}

async function enqueueNotification(
  supabaseUrl: string,
  serviceRoleKey: string,
  payload: Record<string, unknown>,
) {
  const { response, result } = await withWhatsAppLegacyHttpDeadline(
    `${supabaseUrl}/functions/v1/notification-dispatcher`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": serviceRoleKey,
        "Authorization": `Bearer ${serviceRoleKey}`,
      },
      body: JSON.stringify(payload),
    }, async response => ({ response, result: await response.json().catch(() => null) as {
      success?: boolean; queued?: boolean; notification_id?: string; error?: string;
    } | null }),
  );
  if (
    !response.ok || result?.success !== true || result.queued !== true ||
    typeof result.notification_id !== "string"
  ) {
    throw new Error(
      `notification_enqueue_failed:${response.status}:${
        result?.error || "invalid_ack"
      }`,
    );
  }
  return result.notification_id;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Restrict invocation to authorized cron callers (shared secret) or super_admin JWTs.
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get(
      "SUPABASE_SERVICE_ROLE_KEY",
    )!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    if (!isAuthorizedCronCall(req)) {
      const authHeader = req.headers.get("Authorization");
      if (!authHeader?.startsWith("Bearer ")) {
        return new Response(
          JSON.stringify({ success: false, error: "Unauthorized" }),
          {
            status: 401,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }
      const token = authHeader.replace("Bearer ", "");
      const { data: { user }, error: authErr } = await supabase.auth.getUser(
        token,
      );
      if (authErr || !user) {
        return new Response(
          JSON.stringify({ success: false, error: "Invalid token" }),
          {
            status: 401,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }
      const { data: profile, error: profileError } = await supabase.from("users").select("role, is_active").eq(
        "id",
        user.id,
      ).single();
      if (profileError || profile?.role !== "super_admin" || profile?.is_active !== true) {
        return new Response(
          JSON.stringify({ success: false, error: "Forbidden" }),
          {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }
    }

    const { data: sessions, error: sessionsError } = await supabase
      .from("whatsapp_sessions")
      .select("*")
      .in("status", ["connected", "connecting"])
      .not("is_active", "is", false)
      .order("updated_at", { ascending: true, nullsFirst: true })
      .limit(20);

    if (sessionsError) {
      console.error("WhatsApp health-check session lookup failed");
      return new Response(
        JSON.stringify({ success: false, error: sessionsError.message }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    console.log(
      `Processing ${sessions?.length || 0} sessions for health check`,
    );

    const results = [];

    for (const session of (sessions || []) as SessionRecord[]) {
      try {
        if (session.is_active === false) throw new Error("whatsapp_session_inactive");
        const firstCheck = await checkInstanceConnection(session);
        console.log("WhatsApp health-check first probe completed", { connected: firstCheck.isConnected });

        const updateData: {
          updated_at: string;
          status?: "connected" | "disconnected";
          last_connected_at?: string;
        } = {
          updated_at: new Date().toISOString(),
        };

        if (firstCheck.isConnected) {
          if (session.status !== "connected") {
            updateData.status = "connected";
            updateData.last_connected_at = new Date().toISOString();
          }

          await requireSessionSnapshot(supabase, session, updateData);

          results.push({
            session_id: session.id,
            instance_name: session.instance_name,
            previous_status: session.status,
            new_status: "connected",
            success: true,
          });
        } else {
          console.log("WhatsApp health-check second probe scheduled");
          await new Promise((resolve) => setTimeout(resolve, 3000));

          const secondCheck = await checkInstanceConnection(session);
          console.log("WhatsApp health-check second probe completed", { connected: secondCheck.isConnected });

          if (secondCheck.isConnected) {
            console.log("WhatsApp health-check connection recovered");

            if (session.status !== "connected") {
              updateData.status = "connected";
              updateData.last_connected_at = new Date().toISOString();
            }

            await requireSessionSnapshot(supabase, session, updateData);

            results.push({
              session_id: session.id,
              instance_name: session.instance_name,
              previous_status: session.status,
              new_status: "connected",
              retried: true,
              success: true,
            });
          } else {
            console.log("WhatsApp health-check disconnection confirmed");
            updateData.status = "disconnected";

            // Do not notify for a stale observation. The final conditional write
            // repeats this check after notification I/O; accepted POSTs cannot be recalled.
            await requireSessionSnapshot(supabase, session);

            const displayName = session.display_name || session.instance_name;
            const disconnectEpisode = session.updated_at ||
              session.last_connected_at || session.created_at;

            // Notify session owner via Dispatcher
            if (session.owner_user_id) {
              await enqueueNotification(
                SUPABASE_URL,
                SUPABASE_SERVICE_ROLE_KEY,
                {
                  event_key: "whatsapp_disconnected",
                  organization_id: session.organization_id,
                  user_id: session.owner_user_id,
                  variables: {
                    nome_sessao: displayName,
                    disconnect_episode: disconnectEpisode,
                  },
                  dedupe_key:
                    `whatsapp_disconnected:${session.id}:${session.owner_user_id}:${disconnectEpisode}`,
                },
              );
            }

            // Notify admins
            const { data: admins, error: adminsError } = await supabase
              .from("users")
              .select("id")
              .eq("organization_id", session.organization_id)
              .eq("role", "admin")
              .neq("id", session.owner_user_id);

            if (adminsError) {
              throw new Error(
                `whatsapp_notification_admin_lookup_failed:${adminsError.code}`,
              );
            }

            if (admins && admins.length > 0) {
              for (const admin of admins) {
                await enqueueNotification(
                  SUPABASE_URL,
                  SUPABASE_SERVICE_ROLE_KEY,
                  {
                    event_key: "whatsapp_disconnected_admin",
                    organization_id: session.organization_id,
                    user_id: admin.id,
                    variables: {
                      nome_sessao: displayName,
                      disconnect_episode: disconnectEpisode,
                    },
                    dedupe_key:
                      `whatsapp_disconnected:${session.id}:${admin.id}:${disconnectEpisode}`,
                  },
                );
              }
            }

            await requireSessionSnapshot(supabase, session, updateData);

            // Audit log
            const { error: auditError } = await supabase.from("audit_logs").insert({
              action: "whatsapp.session_disconnected",
              entity_type: "whatsapp_session",
              entity_id: session.id,
              organization_id: session.organization_id,
              new_data: {
                previous_status: session.status,
                new_status: "disconnected",
                first_check: { connected: firstCheck.isConnected },
                second_check: { connected: secondCheck.isConnected },
              },
            });
            if (auditError) throw new Error("whatsapp_session_audit_failed");

            console.log("WhatsApp health-check disconnection recorded");

            results.push({
              session_id: session.id,
              instance_name: session.instance_name,
              previous_status: session.status,
              new_status: "disconnected",
              retried: true,
              success: true,
            });
          }
        }
      } catch (error) {
        console.error("WhatsApp health-check item failed");
        results.push({
          session_id: session.id,
          instance_name: session.instance_name,
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        processed: results.length,
        results,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("WhatsApp health-check request failed");
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
