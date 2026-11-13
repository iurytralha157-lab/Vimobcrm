import {
  authorizeServiceRequest,
  jsonResponse,
  parseObjectBody,
  processExecutions,
  releaseDueDelays,
} from "../_shared/automation-runtime.ts";
import { safeAutomationError } from "../_shared/automation-runtime-errors.ts";

Deno.serve(async (req) => {
  if (req.method !== "POST") return jsonResponse({ ok: false, error: "method_not_allowed" }, 405);
  const unauthorized = authorizeServiceRequest(req);
  if (unauthorized) return unauthorized;
  try {
    const body = await parseObjectBody(req);
    if (Object.keys(body).some((key) => !["batch_size", "execution_batch_size"].includes(key))) {
      return jsonResponse({ ok: false, error: "invalid_fields" }, 400);
    }
    const delays = await releaseDueDelays(body.batch_size);
    const executions = await processExecutions(body.execution_batch_size || body.batch_size);
    return jsonResponse({ ok: true, delays, executions });
  } catch (error) {
    const failure = safeAutomationError(error);
    console.error("automation-delay-processor failed", failure);
    return jsonResponse({ ok: false, error: failure }, 500);
  }
});
