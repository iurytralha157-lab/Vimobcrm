type ErrorDetails = {
  code?: unknown;
  direction?: unknown;
  message?: unknown;
  name?: unknown;
  requestId?: unknown;
  status?: unknown;
};

export type MarketingDashboardErrorKind =
  "filters" | "contract" | "schema" | "capacity" | "service" | "unknown";

export interface MarketingDashboardErrorState {
  kind: MarketingDashboardErrorKind;
  title: string;
  description: string;
  canRetry: boolean;
  shouldClearFilters: boolean;
}

function readErrorDetails(error: unknown): ErrorDetails {
  return error && typeof error === "object" ? (error as ErrorDetails) : {};
}

function readText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function withRequestReference(message: string, requestId: string) {
  return requestId ? `${message} Referência: ${requestId}.` : message;
}

export function getMarketingDashboardErrorState(
  error: unknown,
): MarketingDashboardErrorState {
  const details = readErrorDetails(error);
  const code = readText(details.code).toLowerCase();
  const direction = readText(details.direction).toLowerCase();
  const requestId = readText(details.requestId);
  const status = typeof details.status === "number" ? details.status : null;

  if (direction === "input" || code === "invalid_analytics_filters") {
    return {
      kind: "filters",
      title: "Revise os filtros de Marketing",
      description:
        "O período ou um filtro salvo não é mais válido. Limpe os filtros e selecione o período novamente.",
      canRetry: true,
      shouldClearFilters: true,
    };
  }

  if (direction === "response" || code === "domain_validation_error") {
    return {
      kind: "contract",
      title: "O dashboard precisa ser atualizado",
      description: withRequestReference(
        "A API respondeu em um formato incompatível com esta versão do CRM. Nenhuma métrica foi estimada.",
        requestId,
      ),
      canRetry: true,
      shouldClearFilters: false,
    };
  }

  if (code === "marketing_schema_unavailable") {
    return {
      kind: "schema",
      title: "Estrutura de Marketing em atualização",
      description: withRequestReference(
        "A estrutura de dados deste ambiente ainda não está pronta. Um administrador precisa concluir a atualização antes da sincronização.",
        requestId,
      ),
      canRetry: true,
      shouldClearFilters: false,
    };
  }

  if (code === "marketing_capacity_unavailable") {
    return {
      kind: "capacity",
      title: "Capacidade de dados temporariamente esgotada",
      description: withRequestReference(
        "O limite temporário de conexões foi atingido. Aguarde alguns instantes e tente novamente; os dados anteriores não foram substituídos.",
        requestId,
      ),
      canRetry: true,
      shouldClearFilters: false,
    };
  }

  if (
    code === "marketing_query_timeout" ||
    code === "api_timeout" ||
    code === "api_unavailable" ||
    status === 0 ||
    status === 502 ||
    status === 503 ||
    status === 504
  ) {
    return {
      kind: "service",
      title: "Serviço de Marketing temporariamente indisponível",
      description: withRequestReference(
        "A consulta não pôde ser concluída agora. Aguarde alguns instantes e tente novamente; nenhuma métrica foi estimada.",
        requestId,
      ),
      canRetry: true,
      shouldClearFilters: false,
    };
  }

  const message = readText(details.message);
  return {
    kind: "unknown",
    title: "Não foi possível carregar os dados de Marketing",
    description: withRequestReference(
      message ||
        "Tente novamente. Nenhuma métrica foi estimada enquanto a consulta falhou.",
      requestId,
    ),
    canRetry: true,
    shouldClearFilters: false,
  };
}
