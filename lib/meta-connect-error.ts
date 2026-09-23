const META_CONNECT_ERROR_MESSAGES = {
  api_timeout:
    "A confirmação da página demorou. Atualize a lista para verificar se ela foi conectada antes de tentar novamente.",
  meta_leads_retrieval_required:
    "A Meta não liberou a leitura dos leads. Autorize leads_retrieval e conecte a página novamente.",
  meta_lead_forms_access_failed:
    "Não foi possível validar o acesso aos formulários de leads na Meta. Confira as permissões da página e tente novamente.",
  meta_webhook_subscription_failed:
    "Não foi possível ativar o envio de leads desta página na Meta. Confira o acesso à página e tente novamente.",
  meta_webhook_subscription_check_failed:
    "Não foi possível verificar na Meta se esta página está enviando leads. Tente novamente em instantes.",
  meta_webhook_subscription_unverified:
    "A Meta não confirmou a assinatura de leads desta página. Tente conectar novamente em instantes.",
  meta_leadgen_subscription_missing:
    "Esta página já tem outros eventos assinados na Meta, mas não está enviando leads. A assinatura precisa ser corrigida sem remover os outros eventos.",
  meta_page_subscription_busy:
    "Outra conexão desta página está em andamento. Aguarde um instante, atualize a lista e tente novamente se necessário.",
  meta_request_timeout:
    "A Meta demorou para responder. Atualize a lista para verificar a conexão antes de tentar novamente.",
  meta_request_failed:
    "A Meta não respondeu à solicitação. Tente novamente em instantes.",
  meta_temporarily_unavailable:
    "A Meta está temporariamente indisponível. Tente novamente em instantes.",
  meta_integration_write_failed:
    "O CRM não conseguiu salvar a conexão. Atualize a lista antes de tentar novamente.",
  oauth_flow_finalize_failed:
    "Não foi possível confirmar o fim da conexão. Atualize a lista para verificar se a página foi conectada.",
  oauth_flow_not_available:
    "Esta autorização expirou ou já foi usada. Autorize a conta Meta novamente.",
} as const;

type MetaConnectErrorCode = keyof typeof META_CONNECT_ERROR_MESSAGES;

function stableMetaConnectErrorCode(error: unknown): MetaConnectErrorCode | null {
  if (!error || typeof error !== "object") return null;

  const candidate = error as { code?: unknown; technicalMessage?: unknown; message?: unknown };
  // The API intentionally hides 5xx details in `message`, but its code-only
  // response remains available in `technicalMessage`. Only mapped codes are shown.
  for (const value of [candidate.code, candidate.technicalMessage, candidate.message]) {
    if (
      typeof value === "string" &&
      Object.prototype.hasOwnProperty.call(META_CONNECT_ERROR_MESSAGES, value.trim())
    ) {
      return value.trim() as MetaConnectErrorCode;
    }
  }

  return null;
}

export function isMetaOAuthFlowUnavailableError(error: unknown) {
  return stableMetaConnectErrorCode(error) === "oauth_flow_not_available";
}

export function metaConnectErrorMessage(error: unknown) {
  const stableCode = stableMetaConnectErrorCode(error);
  if (stableCode) return META_CONNECT_ERROR_MESSAGES[stableCode];

  return error instanceof Error ? error.message : "Não foi possível conectar esta página.";
}
