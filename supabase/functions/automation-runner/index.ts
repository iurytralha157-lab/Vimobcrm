import {
  authorizeServiceRequest,
  jsonResponse,
  parseObjectBody,
  runAutomationRuntime,
} from "../_shared/automation-runtime.ts";

const allowedFields = new Set([
  "cancel_batch_size",
  "schedule_batch_size",
  "inactivity_batch_size",
  "run_inactivity",
  "event_batch_size",
  "delay_batch_size",
  "execution_batch_size",
]);

Deno.serve(async (req) => {
  if (req.method !== "POST") return jsonResponse({ ok: false, error: "method_not_allowed" }, 405);
  const unauthorized = authorizeServiceRequest(req);
  if (unauthorized) return unauthorized;
  try {
    const body = await parseObjectBody(req);
    if (Object.keys(body).some((key) => !allowedFields.has(key))) return jsonResponse({ ok: false, error: "invalid_fields" }, 400);
    return jsonResponse({ ok: true, ...(await runAutomationRuntime(body)) });
  } catch (error) {
    console.error("automation-runner failed", error);
    return jsonResponse({ ok: false, error: error instanceof Error ? error.message : "runtime_failed" }, 500);
  }
});
