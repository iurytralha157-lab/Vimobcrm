import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.108.1";

declare const EdgeRuntime: { waitUntil?: (promise: Promise<unknown>) => void } | undefined;

const jsonHeaders = { "Content-Type": "application/json" };
const scheduledSecretHeader = "x-vimob-cron-secret";
const syncConcurrency = 2;

type VistaIntegration = { organization_id: string };

function jsonResponse(body: Record<string, unknown>, status: number) {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}

async function constantTimeEqual(left: string, right: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(left)),
    crypto.subtle.digest("SHA-256", encoder.encode(right)),
  ]);
  const leftBytes = new Uint8Array(leftHash);
  const rightBytes = new Uint8Array(rightHash);
  let difference = 0;
  for (let index = 0; index < leftBytes.length; index += 1) {
    difference |= leftBytes[index] ^ rightBytes[index];
  }
  return difference === 0;
}

async function authorizeScheduledRequest(req: Request): Promise<Response | null> {
  const expected = Deno.env.get("VISTA_SCHEDULED_SYNC_SECRET")?.trim() ?? "";
  if (!expected) {
    console.error("[vista-scheduled-sync] VISTA_SCHEDULED_SYNC_SECRET is not configured");
    return jsonResponse({ ok: false, error: "scheduler_secret_not_configured" }, 503);
  }
  const provided = req.headers.get(scheduledSecretHeader)?.trim() ?? "";
  if (!provided || !(await constantTimeEqual(provided, expected))) {
    return jsonResponse({ ok: false, error: "unauthorized" }, 401);
  }
  return null;
}

async function syncOrganization(supabase: SupabaseClient, organizationId: string) {
  try {
    const { data, error } = await supabase.functions.invoke("vista-sync", {
      body: { action: "sync", organization_id: organizationId },
    });
    if (error) {
      console.error(`[vista-scheduled-sync] Sync failed for org ${organizationId}:`, error);
      return;
    }
    console.log(
      `[vista-scheduled-sync] Org ${organizationId} completed with ${data?.synced ?? 0} properties and ${data?.errors?.length ?? 0} errors`,
    );
  } catch (error) {
    console.error(`[vista-scheduled-sync] Sync exception for org ${organizationId}:`, error);
  }
}

async function runWithConcurrency(
  supabase: SupabaseClient,
  integrations: VistaIntegration[],
): Promise<void> {
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < integrations.length) {
      const integration = integrations[nextIndex];
      nextIndex += 1;
      await syncOrganization(supabase, integration.organization_id);
    }
  }
  const workerCount = Math.min(syncConcurrency, integrations.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return jsonResponse({ ok: false, error: "method_not_allowed" }, 405);
  }

  const unauthorized = await authorizeScheduledRequest(req);
  if (unauthorized) return unauthorized;

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const { data, error } = await supabase
      .from("vista_integrations")
      .select("organization_id")
      .eq("is_active", true);

    if (error) {
      console.error("[vista-scheduled-sync] Could not list active integrations:", error);
      return jsonResponse({ ok: false, error: "integration_lookup_failed" }, 500);
    }

    const integrations = (data ?? []) as VistaIntegration[];
    if (integrations.length === 0) {
      return jsonResponse({ ok: true, accepted: false, queued: 0 }, 200);
    }

    const task = runWithConcurrency(supabase, integrations).catch((error) => {
      console.error("[vista-scheduled-sync] Background batch failed:", error);
    });
    if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) {
      EdgeRuntime.waitUntil(task);
      return jsonResponse({ ok: true, accepted: true, queued: integrations.length }, 202);
    }

    await task;
    return jsonResponse({ ok: true, accepted: true, queued: integrations.length }, 202);
  } catch (error) {
    console.error("[vista-scheduled-sync] Fatal error:", error);
    return jsonResponse({ ok: false, error: "scheduler_failed" }, 500);
  }
});
