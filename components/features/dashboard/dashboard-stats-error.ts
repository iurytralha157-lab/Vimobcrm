type DashboardStatsErrorDetails = {
  code?: unknown;
  direction?: unknown;
  status?: unknown;
};

function getErrorDetails(error: unknown): DashboardStatsErrorDetails {
  return error && typeof error === "object"
    ? (error as DashboardStatsErrorDetails)
    : {};
}

function getErrorCode(details: DashboardStatsErrorDetails) {
  return typeof details.code === "string" ? details.code.toLowerCase() : "";
}

export function shouldDisplayCachedDashboardStats(error: unknown) {
  const details = getErrorDetails(error);
  const code = getErrorCode(details);
  return details.status !== 401 &&
    details.status !== 403 &&
    ![
      "missing_session",
      "permission_denied",
      "organization_required",
      "recovery_session_restricted",
    ].includes(code);
}

export function getDashboardStatsFailureState(
  hasData: boolean,
  isError: boolean,
  error: unknown,
): "none" | "stale" | "unavailable" {
  if (!isError) return "none";
  return hasData && shouldDisplayCachedDashboardStats(error)
    ? "stale"
    : "unavailable";
}

export function getDashboardStatsErrorDescription(error: unknown) {
  const details = getErrorDetails(error);
  const code = getErrorCode(details);
  const direction = details.direction;
  const status = details.status;

  if (status === 401 || code === "missing_session") {
    return "Sua sessão expirou. Entre novamente para carregar os indicadores.";
  }
  if (status === 403 || code === "permission_denied" || code === "organization_required" ||
      code === "recovery_session_restricted") {
    return "Seu acesso aos indicadores desta organização não está disponível. Verifique sua conta ou organização ativa.";
  }
  if (direction === "input" || status === 400) {
    return "O período ou algum filtro não foi aceito. Revise os filtros e tente novamente.";
  }
  if (direction === "response" || code === "domain_validation_error") {
    return "A API retornou indicadores incompatíveis com esta versão do CRM. Atualize a página e tente novamente.";
  }
  if (status === 404) {
    return "A consulta de indicadores não está disponível nesta versão da API. Tente novamente em instantes.";
  }
  if (code === "api_timeout" || status === 408 || status === 504) {
    return "A consulta demorou para responder. Aguarde alguns instantes e tente novamente.";
  }
  if (code === "api_unavailable" || status === 0 || status === 429 ||
      (typeof status === "number" && status >= 500)) {
    return "O serviço de indicadores está temporariamente indisponível. Aguarde alguns instantes e tente novamente.";
  }
  return "Tente novamente para carregar os indicadores.";
}
