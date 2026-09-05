export type MessageMediaPolicyKind = "image" | "video" | "audio" | "document" | "sticker";

export type MessageMediaPolicyPresentation = {
  title: string;
  description: string;
  canRequestDownload: boolean;
  isQueued: boolean;
};

export const MAX_MANUAL_MESSAGE_MEDIA_BYTES = 25 * 1024 * 1024;

const AUTOMATIC_MEDIA_LIMIT_MIB: Partial<Record<MessageMediaPolicyKind, number>> = {
  audio: 25,
  image: 10,
  sticker: 5,
};

const MEDIA_KIND_LABEL: Record<MessageMediaPolicyKind, string> = {
  audio: "áudio",
  document: "documento",
  image: "imagem",
  sticker: "figurinha",
  video: "vídeo",
};

const formatMediaSize = (sizeBytes: number) => {
  const sizeMiB = sizeBytes / (1024 * 1024);
  const formatted = sizeMiB.toFixed(1).replace(".", ",").replace(",0", "");
  return `${formatted} MB`;
};

const hasMediaPolicyError = (error: string, code: string) =>
  error.toLowerCase().includes(code);

export function getMessageMediaPolicyPresentation({
  error,
  kind,
  sizeBytes,
}: {
  error: string | null | undefined;
  kind: MessageMediaPolicyKind;
  sizeBytes?: number | null;
}): MessageMediaPolicyPresentation | null {
  const normalizedError = String(error || "").trim();
  if (!normalizedError) return null;

  const hasKnownSize = typeof sizeBytes === "number" && Number.isFinite(sizeBytes) && sizeBytes > 0;
  const withinManualLimit = hasKnownSize && sizeBytes <= MAX_MANUAL_MESSAGE_MEDIA_BYTES;
  const mediaLabel = kind === "document" ? "documento" : `arquivo de ${MEDIA_KIND_LABEL[kind]}`;
  const sizeLabel = hasKnownSize ? formatMediaSize(sizeBytes) : null;

  if (hasMediaPolicyError(normalizedError, "media_provider_outcome_unknown")) {
    return {
      title: "Processamento pausado por segurança",
      description: "Não foi possível confirmar o download deste arquivo. Para evitar uma nova tentativa duplicada, entre em contato com o suporte.",
      canRequestDownload: false,
      isQueued: false,
    };
  }

  if (
    hasMediaPolicyError(normalizedError, "media_manual_download_queued")
    || hasMediaPolicyError(normalizedError, "media_download_retry_scheduled")
  ) {
    return {
      title: "Download na fila",
      description: "O arquivo aparecerá aqui assim que o processamento terminar.",
      canRequestDownload: false,
      isQueued: true,
    };
  }

  if (hasMediaPolicyError(normalizedError, "media_policy_unknown_size")) {
    return {
      title: "Tamanho do arquivo não informado",
      description: `O WhatsApp não informou o tamanho deste ${mediaLabel}. Por segurança, o CRM não pode baixá-lo agora.`,
      canRequestDownload: false,
      isQueued: false,
    };
  }

  if (hasMediaPolicyError(normalizedError, "media_policy_too_large")) {
    if (!withinManualLimit) {
      return {
        title: "Arquivo acima do limite",
        description: sizeLabel
          ? `Este ${mediaLabel} tem ${sizeLabel} e ultrapassa o limite máximo de 25 MB do CRM.`
          : `Este ${mediaLabel} ultrapassa o limite máximo de 25 MB do CRM.`,
        canRequestDownload: false,
        isQueued: false,
      };
    }

    const automaticLimitMiB = AUTOMATIC_MEDIA_LIMIT_MIB[kind];
    return {
      title: "Arquivo não baixado automaticamente",
      description: automaticLimitMiB
        ? `Este ${mediaLabel} tem ${sizeLabel}. O download automático é limitado a ${automaticLimitMiB} MB.`
        : `Este ${mediaLabel} tem ${sizeLabel} e precisa ser solicitado manualmente.`,
      canRequestDownload: true,
      isQueued: false,
    };
  }

  if (hasMediaPolicyError(normalizedError, "media_policy_manual_only_type")) {
    if (!withinManualLimit) {
      return {
        title: hasKnownSize ? "Arquivo acima do limite" : "Tamanho do arquivo não informado",
        description: sizeLabel
          ? `Este ${mediaLabel} tem ${sizeLabel} e ultrapassa o limite máximo de 25 MB do CRM.`
          : `O WhatsApp não informou o tamanho deste ${mediaLabel}. Por segurança, o CRM não pode baixá-lo agora.`,
        canRequestDownload: false,
        isQueued: false,
      };
    }

    return {
      title: "Arquivo disponível para download",
      description: `Para proteger as conexões do WhatsApp, este ${mediaLabel} de ${sizeLabel} não foi baixado automaticamente.`,
      canRequestDownload: true,
      isQueued: false,
    };
  }

  if (hasMediaPolicyError(normalizedError, "media_legacy_job_retired")) {
    return {
      title: "Arquivo precisa ser solicitado novamente",
      description: withinManualLimit
        ? `Este ${mediaLabel} veio do processamento anterior e pode ser colocado na nova fila.`
        : `Este ${mediaLabel} veio do processamento anterior, mas não possui tamanho válido para um novo download.`,
      canRequestDownload: withinManualLimit,
      isQueued: false,
    };
  }

  return null;
}
