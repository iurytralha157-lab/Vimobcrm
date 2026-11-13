import { AutomationStageCommandError } from "./automation-stage-command.ts";

const runtimeCodes = new Set([
  "request_too_large", "invalid_json_body", "runtime_not_configured",
  "automation_candidate_page_limit_exceeded", "unsafe_webhook_url", "unsafe_webhook_host",
  "webhook_allowlist_required", "webhook_host_not_allowlisted", "unsafe_webhook_dns_target",
  "webhook_redirects_are_disabled", "effect_finish_fencing_conflict", "module_disabled",
  "lead_missing_after_internal_effect", "lead_not_found_in_tenant", "organization_not_found",
  "published_flow_version_not_found", "invalid_published_graph", "current_node_missing_from_published_graph",
  "step_attempt_already_processed_fail_closed", "invalid_delay_config", "trigger_node_cannot_be_executed",
  "unclassified_reply_requires_review", "invalid_execution_id", "execution_not_found",
]);

const stageCommandCodes = new Set([
  "automation_actor_forbidden", "automation_command_invalid", "automation_command_rejected",
  "automation_command_retryable", "automation_command_unavailable", "automation_destination_mismatch",
  "automation_effect_conflict", "automation_execution_changed", "automation_execution_not_running",
  "automation_lead_required", "automation_lease_changed", "automation_module_disabled", "automation_node_invalid",
  "automation_queue_unavailable", "automation_queue_protected", "automation_queue_same_owner", "automation_queue_destination_unavailable",
  "invalid_lead_input", "invalid_lead_reference", "lead_changed", "lead_lost_reason_required", "lead_not_found",
  "lead_property_relink_while_won", "lead_property_unavailable", "lead_reservation_unverified", "lead_stage_changed",
]);

const phaseReasons = {
  whatsapp_resolve: new Set([
    "invalid_whatsapp_session", "execution_session_or_lead_unavailable", "lead_has_no_valid_whatsapp_phone",
    "matching_conversation_not_found", "conversation_has_no_canonical_whatsapp_destination",
    "automation_whatsapp_resolution_argument_missing", "automation_whatsapp_execution_unavailable",
    "automation_whatsapp_lead_unavailable", "automation_whatsapp_session_unavailable", "automation_whatsapp_session_access_denied",
    "automation_whatsapp_conversation_resolution_failed", "whatsapp_identity_belongs_to_another_lead",
    "automation_whatsapp_binding_context_mismatch", "automation_whatsapp_binding_activation_failed",
    "automation_whatsapp_execution_fencing_conflict", "automation_whatsapp_alias_belongs_to_another_lead",
  ]),
  whatsapp_media_download: new Set(["cross_tenant_or_invalid_media_path", "invalid_automation_media_size", "invalid_automation_media_mime", "media_download_failed"]),
  whatsapp_media_upload: new Set(["automation_immutable_media_mismatch"]),
  whatsapp_reserve: new Set(["execution_not_running", "failed", "missing", "unknown"]),
  whatsapp_outbox_enqueue: new Set([
    "unsupported_automation_whatsapp_message_type", "invalid_automation_whatsapp_effect_identity",
    "invalid_automation_whatsapp_text_payload", "invalid_or_cross_tenant_automation_whatsapp_media", "invalid_automation_whatsapp_immutable_media",
    "automation_whatsapp_queue_context_mismatch", "automation_whatsapp_queue_binding_mismatch",
    "automation_whatsapp_attendance_required", "automation_whatsapp_effect_fencing_conflict", "automation_whatsapp_session_access_denied",
    "conversation_has_no_canonical_whatsapp_destination", "automation_whatsapp_message_idempotency_collision",
    "automation_whatsapp_outbox_idempotency_collision", "automation_whatsapp_dispatch_idempotency_collision",
  ]),
  external_effect_reserve: new Set(["execution_not_running", "failed", "missing", "sending", "unknown"]),
  internal_effect: new Set(["execution_not_running", "failed", "missing", "sending", "unknown"]),
  inbound_message: new Set(["invalid_input"]),
};

type RuntimePhase = keyof typeof phaseReasons;

function errorFields(error: unknown): Record<string, unknown> | undefined {
  return error !== null && typeof error === "object" ? error as Record<string, unknown> : undefined;
}

function databaseCode(error: Record<string, unknown> | undefined): string | undefined {
  const code = error?.code;
  // PostgreSQL SQLSTATE or a PostgREST error code. Never use message/details/hint
  // from either protocol unless the full message matches a fixed domain code.
  return typeof code === "string" && /^(?:[0-9][0-9A-Z]{4}|P[0-9A-Z]{4}|XX[0-9]{3}|PGRST[0-9]{3})$/.test(code)
    ? code : undefined;
}

export class AutomationPhaseError extends Error {
  constructor(phase: RuntimePhase, failure?: unknown) {
    const fields = errorFields(failure);
    const reason = typeof failure === "string" ? failure : fields?.message;
    const knownReason = typeof reason === "string" && phaseReasons[phase].has(reason) ? reason : undefined;
    const status = fields?.status ?? fields?.statusCode;
    const httpStatus = (typeof status === "string" || typeof status === "number") && /^[45][0-9]{2}$/.test(String(status))
      ? `http_${status}` : undefined;
    const code = databaseCode(fields) ?? httpStatus;
    super([phase, knownReason, code].filter(Boolean).join(":"));
    this.name = "AutomationPhaseError";
  }
}

export function safeAutomationError(error: unknown): string {
  if (error instanceof AutomationPhaseError) return error.message;
  if (error instanceof AutomationStageCommandError) {
    return stageCommandCodes.has(error.code) ? error.code : "automation_command_rejected";
  }
  if (error instanceof Error && (runtimeCodes.has(error.message) || /^webhook_http_[45][0-9]{2}$/.test(error.message))) {
    return error.message;
  }
  const code = databaseCode(errorFields(error));
  return code ? `automation_database_error:${code}` : "runtime_failed";
}
