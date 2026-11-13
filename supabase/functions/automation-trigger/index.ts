import {
  authorizeServiceRequest,
  jsonResponse,
  parseObjectBody,
  processTriggerEvents,
} from "../_shared/automation-runtime.ts";
import { safeAutomationError } from "../_shared/automation-runtime-errors.ts";

Deno.serve(async (req) => {
  if (req.method !== "POST") return jsonResponse({ ok: false, error: "method_not_allowed" }, 405);
  const unauthorized = authorizeServiceRequest(req);
  if (unauthorized) return unauthorized;
  try {
    const body = await parseObjectBody(req);
    if (Object.keys(body).some((key) => key !== "batch_size")) return jsonResponse({ ok: false, error: "invalid_fields" }, 400);
    return jsonResponse({ ok: true, ...(await processTriggerEvents(body.batch_size)) });
  } catch (error) {
    const failure = safeAutomationError(error);
    console.error("automation-trigger failed", failure);
    return jsonResponse({ ok: false, error: failure }, 500);
  }
});
