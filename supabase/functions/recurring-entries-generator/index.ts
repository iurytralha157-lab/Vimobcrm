import { authorizePrivateWorkerRequest } from "../_shared/private-worker-auth.ts";

const jsonHeaders = { "Content-Type": "application/json" };

/**
 * Retired legacy generator.
 *
 * `smart-recurring-generator` is the only supported recurring-entry worker.
 * Keeping this authenticated tombstone prevents an old cron invocation from
 * running a second, non-atomic check-then-insert loop during rollout.
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
      replacement: "smart-recurring-generator",
    }),
    { status: 410, headers: jsonHeaders },
  );
});
