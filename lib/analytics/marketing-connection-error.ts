function getMarketingErrorCode(error: unknown) {
  const code = typeof error === "string" ? error :
    error !== null && typeof error === "object" && "code" in error ? error.code : "";
  if (typeof code !== "string") return "";
  return code.slice(code.lastIndexOf(":") + 1).trim();
}

export function shouldPauseMarketingSync(error: unknown) {
  const code = getMarketingErrorCode(error);
  return code === "meta_rate_limited" || code === "sync_runtime_exceeded" ||
    code === "api_timeout" || code === "meta_access_token_invalid";
}

export function getMarketingSyncErrorMessage(error: unknown) {
  switch (getMarketingErrorCode(error)) {
    case "meta_rate_limited":
      return "A Meta limitou as solicitações temporariamente. Aguarde antes de sincronizar novamente.";
    case "sync_runtime_exceeded":
    case "api_timeout":
      return "A sincronização demorou mais que o previsto. Selecione um período menor no Marketing e tente novamente.";
    case "meta_access_token_invalid":
      return "A autorização da Meta expirou ou foi revogada. Entre de novo na integração de Marketing.";
    case "marketing_sync_in_progress":
      return "Já há uma sincronização em andamento. Aguarde a conclusão.";
    default:
      return "Não foi possível concluir a sincronização de Marketing. Tente novamente mais tarde.";
  }
}
