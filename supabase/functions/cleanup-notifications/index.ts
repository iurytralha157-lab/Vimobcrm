import { createClient } from "npm:@supabase/supabase-js@2.112.4";
import { authorizePrivateWorkerRequest } from "../_shared/private-worker-auth.ts";
import { canPurgeNotification } from "../_shared/notification-retention.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const RETENTION_DAYS = 15;
const SCAN_PAGE_SIZE = 250;
const MAX_SCANNED_PER_RUN = 5000;

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
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const cutoff = new Date(
      Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();
    let deletedCount = 0;
    let retainedCount = 0;
    let scannedCount = 0;
    let retainedOffset = 0;

    // Select before deleting because delivery state lives in JSON metadata.
    // The offset advances only by retained rows: deleted rows disappear from
    // the result set and the next eligible page shifts into the same range.
    while (scannedCount < MAX_SCANNED_PER_RUN) {
      const pageSize = Math.min(
        SCAN_PAGE_SIZE,
        MAX_SCANNED_PER_RUN - scannedCount,
      );
      const { data: candidates, error: selectError } = await supabase
        .from("notifications")
        .select("id, metadata")
        .lt("created_at", cutoff)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(retainedOffset, retainedOffset + pageSize - 1);

      if (selectError) {
        console.error("❌ Cleanup candidate scan failed:", selectError);
        return new Response(JSON.stringify({ error: selectError.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (!candidates || candidates.length === 0) break;

      scannedCount += candidates.length;
      const purgeableIds = candidates
        .filter((candidate) => canPurgeNotification(candidate.metadata))
        .map((candidate) => candidate.id);
      let deletedOnPage = 0;

      if (purgeableIds.length > 0) {
        const { data: deleted, error: deleteError } = await supabase
          .from("notifications")
          .delete()
          .in("id", purgeableIds)
          .lt("created_at", cutoff)
          // Re-check the absence of every delivery marker atomically with the
          // delete, so a concurrent worker cannot turn a selected in-app row
          // into delivery work between the scan and the mutation.
          .is("metadata->dispatch", null)
          .is("metadata->whatsapp_dispatch", null)
          .is("metadata->push_dispatch", null)
          .is("metadata->email_dispatch", null)
          .is("metadata->>whatsapp_dispatch_required", null)
          .is("metadata->>push_dispatch_required", null)
          .is("metadata->>email_dispatch_required", null)
          .is("metadata->>outcome_unknown", null)
          .select("id");

        if (deleteError) {
          console.error("❌ Cleanup delete failed:", deleteError);
          return new Response(JSON.stringify({ error: deleteError.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        deletedOnPage = deleted?.length || 0;
        deletedCount += deletedOnPage;
      }

      const retainedOnPage = candidates.length - deletedOnPage;
      retainedCount += retainedOnPage;
      retainedOffset += retainedOnPage;
    }

    const scanLimited = scannedCount >= MAX_SCANNED_PER_RUN;
    console.log(
      `🧹 Cleanup complete: ${deletedCount} deleted, ${retainedCount} delivery-backed notifications retained`,
    );

    return new Response(
      JSON.stringify({
        success: true,
        deleted: deletedCount,
        retained: retainedCount,
        scanned: scannedCount,
        scan_limited: scanLimited,
        retention_days: RETENTION_DAYS,
        timestamp: new Date().toISOString(),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err: unknown) {
    console.error("❌ Unexpected error:", err);
    const message = err instanceof Error ? err.message : "unexpected_error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
