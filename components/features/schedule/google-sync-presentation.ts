type GoogleSyncTarget = "calendar" | "tasks" | null;

type GoogleSyncFeedback = {
  tone: "neutral" | "pending" | "success" | "warning";
  title: string;
  description: string;
  requiresConnection: boolean;
};

export const GOOGLE_TASKS_DATE_ONLY_NOTICE =
  "No Google Tasks aparece apenas a data. Os horários e lembretes continuam no Vimob.";

export function getGoogleSyncFeedback({
  target,
  status,
  isMasked,
}: {
  target?: GoogleSyncTarget;
  status?: string | null;
  isMasked: boolean;
}): GoogleSyncFeedback | null {
  if (isMasked) return null;
  // Older APIs expose only failures from the original Calendar integration.
  const destination = target === undefined && (status === "error" || status === "conflict")
    ? "calendar" : target;
  if (!destination) return null;

  const label = destination === "tasks" ? "Google Tasks" : "Google Agenda";
  const notice = destination === "tasks" ? ` ${GOOGLE_TASKS_DATE_ONLY_NOTICE}` : "";
  if (status === "needs_auth" || status === "not_connected") {
    return {
      tone: "warning", title: `Autorize o ${label}`,
      description: `Abra Integrações para autorizar o envio desta atividade.${notice}`,
      requiresConnection: true,
    };
  }
  if (status === "error" || status === "conflict") {
    return {
      tone: "warning", title: `Envio ao ${label} precisa de atenção`,
      description: `O último envio não foi concluído. Confira a conexão Google nas Integrações e tente novamente.${notice}`,
      requiresConnection: true,
    };
  }
  if (status === "pending" || status === "syncing") {
    return {
      tone: "pending", title: `Envio ao ${label} pendente`,
      description: `A atividade foi salva no Vimob e aguarda confirmação do Google.${notice}`,
      requiresConnection: false,
    };
  }
  if (status === "synced") {
    return {
      tone: "success", title: `Enviado ao ${label}`,
      description: `O último envio desta atividade foi confirmado.${notice}`,
      requiresConnection: false,
    };
  }
  return destination === "tasks" ? {
    tone: "neutral", title: "Google Tasks", description: GOOGLE_TASKS_DATE_ONLY_NOTICE,
    requiresConnection: false,
  } : null;
}
