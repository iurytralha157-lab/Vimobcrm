export function getMetaWebhookFailureGuidance(errorMessage: string | null | undefined) {
  const normalized = errorMessage?.trim().toLowerCase() ?? "";
  if (!normalized) return null;

  if (normalized.includes("apps in dev mode should only access leads")) {
    return "A Meta recebeu o evento, mas leads_retrieval ainda não está liberada para leads reais. Conclua a análise do aplicativo e depois atualize a conexão da página.";
  }

  if (
    normalized.includes("unsupported get request") ||
    normalized.includes("missing permissions")
  ) {
    return "A Meta entregou o aviso, mas recusou a leitura do lead. Confirme o acesso a leads da página e atualize a conexão no CRM.";
  }

  if (normalized.includes("meta page access token is missing")) {
    return "A credencial da página não está disponível. Atualize a conexão desta página no CRM.";
  }

  return null;
}
