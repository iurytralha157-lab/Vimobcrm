import {
  authorizeServiceRequest,
  jsonResponse,
  parseObjectBody,
  processSpecificExecution,
} from "../_shared/automation-runtime.ts";
import { safeAutomationError } from "../_shared/automation-runtime-errors.ts";

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
    const failure = safeAutomationError(error);
    console.error("automation-executor failed", failure);
    return jsonResponse({ ok: false, error: failure }, 500);
  }
});
