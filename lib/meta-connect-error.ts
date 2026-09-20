const META_CONNECT_ERROR_MESSAGES = {
  meta_leads_retrieval_required:
    "A Meta não liberou a leitura dos leads. Autorize leads_retrieval e conecte a página novamente.",
  meta_lead_forms_access_failed:
    "A Meta não liberou o acesso aos formulários de leads. Revise as permissões da página e conecte-a novamente.",
} as const;

type MetaConnectErrorCode = keyof typeof META_CONNECT_ERROR_MESSAGES;

function stableMetaConnectErrorCode(error: unknown): MetaConnectErrorCode | null {
  if (!error || typeof error !== "object") return null;

  const candidate = error as { code?: unknown; message?: unknown };
  for (const value of [candidate.code, candidate.message]) {
    if (
      typeof value === "string" &&
      Object.prototype.hasOwnProperty.call(META_CONNECT_ERROR_MESSAGES, value.trim())
    ) {
      return value.trim() as MetaConnectErrorCode;
    }
  }

  return null;
}

export function metaConnectErrorMessage(error: unknown) {
  const stableCode = stableMetaConnectErrorCode(error);
  if (stableCode) return META_CONNECT_ERROR_MESSAGES[stableCode];

  return error instanceof Error ? error.message : "Não foi possível conectar esta página.";
}
