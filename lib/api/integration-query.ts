type IntegrationQueryErrorDetails = {
  code?: unknown;
  status?: unknown;
};

export type IntegrationQueryErrorMessages = {
  moduleUnavailable: string;
  permissionDenied: string;
  loadFailed: string;
};

function getErrorDetails(error: unknown): IntegrationQueryErrorDetails {
  if (!error || typeof error !== "object") return {};
  return error as IntegrationQueryErrorDetails;
}

function getErrorCode(error: unknown) {
  const { code } = getErrorDetails(error);
  return typeof code === "string" ? code.trim().toLowerCase() : "";
}

function getErrorStatus(error: unknown) {
  const { status } = getErrorDetails(error);
  return typeof status === "number" ? status : null;
}

export function getIntegrationQueryErrorMessage(
  error: unknown,
  messages: IntegrationQueryErrorMessages,
) {
  const code = getErrorCode(error);

  if (code === "module_unavailable") return messages.moduleUnavailable;
  if (code === "permission_denied" || getErrorStatus(error) === 403) {
    return messages.permissionDenied;
  }

  return messages.loadFailed;
}

export function shouldRetryIntegrationQuery(
  failureCount: number,
  error: unknown,
) {
  const status = getErrorStatus(error);

  // Retrying authorization, validation or module-gate responses only repeats a
  // deterministic failure. Transient/network errors still get two retries.
  if (status !== null && status >= 400 && status < 500) return false;
  return failureCount < 2;
}
