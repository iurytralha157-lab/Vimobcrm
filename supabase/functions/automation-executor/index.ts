import {
  authorizeServiceRequest,
  jsonResponse,
  parseObjectBody,
  processSpecificExecution,
} from "../_shared/automation-runtime.ts";

declare const EdgeRuntime: { waitUntil?: (promise: Promise<unknown>) => void } | undefined;

Deno.serve(async (req) => {
  if (req.method !== "POST") return jsonResponse({ ok: false, error: "method_not_allowed" }, 405);
  const unauthorized = authorizeServiceRequest(req);
  if (unauthorized) return unauthorized;
  try {
    const body = await parseObjectBody(req);
    const keys = Object.keys(body);
    if (keys.some((key) => key !== "execution_id") || typeof body.execution_id !== "string") {
      return jsonResponse({ ok: false, error: "execution_id_only" }, 400);
    }
    const task = processSpecificExecution(body.execution_id);
    if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) {
      EdgeRuntime.waitUntil(task.catch((error) => console.error("automation-executor background task failed", error)));
      return jsonResponse({ ok: true, accepted: true, status: "queued" }, 202);
    }
    const result = await task;
    return jsonResponse({ ok: true, ...result }, 202);
  } catch (error) {
    console.error("automation-executor failed", error);
    return jsonResponse({ ok: false, error: error instanceof Error ? error.message : "runtime_failed" }, 500);
  }
});
