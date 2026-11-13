import {
  authorizeServiceRequest,
  jsonResponse,
  parseObjectBody,
  runAutomationRuntime,
} from "../_shared/automation-runtime.ts";
import { safeAutomationError } from "../_shared/automation-runtime-errors.ts";

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
    const failure = safeAutomationError(error);
    console.error("automation-runner failed", failure);
    return jsonResponse({ ok: false, error: failure }, 500);
  }
});
