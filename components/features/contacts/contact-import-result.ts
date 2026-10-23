type ImportFailure = { rowNumber: number; name: string; code: string; message: string };

// An unknown response or transport failure may follow a successful commit. Only
// explicit negative outcomes may be prepared for another user-confirmed attempt.
const CONFIRMED_FAILURE_CODES = new Set([
  'invalid_import_row', 'invalid_input', 'invalid_domain_input', 'invalid_json',
  'invalid_lead_reference', 'lead_not_found', 'lead_already_exists', 'lead_phone_conflict',
  'lead_lost_reason_required', 'permission_denied', 'organization_access_denied',
  'organization_required', 'session_revoked', 'unauthorized', 'rate_limited', 'rate_limit_exceeded',
  'tag_not_found', 'tag_already_exists', 'local_read_only',
  'lead_import_idempotency_unavailable',
  // The server rejects before COMMIT and rolls the whole creation back.
  'lead_creation_workflow_unavailable',
  // Pool reentry rejects before COMMIT; review can retry after a valid claim.
  'queue_pool_changed',
]);

export function isConfirmedContactImportFailure(failure: Pick<ImportFailure, 'code' | 'rowNumber'>, unknownPreparationRows: ReadonlySet<number> = new Set()) {
  return !unknownPreparationRows.has(failure.rowNumber) && CONFIRMED_FAILURE_CODES.has(failure.code);
}

export function contactImportFailureReport(failures: readonly ImportFailure[], unknownPreparationRows: ReadonlySet<number> = new Set()) {
  return failures.map((failure) => [failure.rowNumber, failure.name, failure.code, failure.message,
    unknownPreparationRows.has(failure.rowNumber) ? 'Preparação de tags sem confirmação; contato não enviado'
      : failure.code === 'lead_import_request_conflict' ? 'Dados diferentes na mesma tentativa; revisão necessária'
      : isConfirmedContactImportFailure(failure, unknownPreparationRows) ? 'Falha confirmada' : 'Resultado sem confirmação; confira antes de repetir']);
}
