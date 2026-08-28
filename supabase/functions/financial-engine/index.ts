import { authorizePrivateWorkerRequest } from "../_shared/private-worker-auth.ts";

const jsonHeaders = { "Content-Type": "application/json" };

/**
 * Retired legacy financial writer.
 *
 * Contract activation, receivables and commissions are owned by the Go API
 * (`POST /v1/contracts/:id/activate`), which applies tenant permissions and a
 * single database transaction. Keeping this private tombstone closes the old
 * service-role write path without silently accepting stale invocations.
 */
Deno.serve((request) => {
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...jsonHeaders, Allow: "POST" },
    });
  }

  if (!authorizePrivateWorkerRequest(request)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: jsonHeaders,
    });
  }

  return new Response(
    JSON.stringify({
      error: "Function retired",
      replacement: "POST /v1/contracts/:id/activate",
    }),
    { status: 410, headers: jsonHeaders },
  );
});
