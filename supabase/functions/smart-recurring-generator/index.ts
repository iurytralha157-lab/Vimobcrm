import { authorizePrivateWorkerRequest } from "../_shared/private-worker-auth.ts";

const jsonHeaders = { "Content-Type": "application/json" };

/**
 * Financial recurrence is deliberately fail-closed.
 *
 * The current schema has only a non-unique index on `parent_entry_id`. Without
 * an atomic database primitive (for example, a unique recurrence key consumed
 * by an RPC/upsert), concurrent worker invocations can create duplicate money
 * movements. Re-enable generation only after that invariant is deployed and
 * covered by a database-backed concurrency test.
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
      error: "Financial recurrence is temporarily unavailable",
      code: "financial_recurring_atomicity_required",
    }),
    {
      status: 503,
      headers: { ...jsonHeaders, "Retry-After": "3600" },
    },
  );
});
