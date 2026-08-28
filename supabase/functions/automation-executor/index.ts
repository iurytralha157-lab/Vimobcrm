import {
  authorizeServiceRequest,
  jsonResponse,
  parseObjectBody,
  processSpecificExecution,
} from "../_shared/automation-runtime.ts";

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
    const result = await processSpecificExecution(body.execution_id);
    return jsonResponse({ ok: true, ...result }, 202);
  } catch (error) {
    console.error("automation-executor failed", error);
    return jsonResponse({ ok: false, error: error instanceof Error ? error.message : "runtime_failed" }, 500);
  }
});
