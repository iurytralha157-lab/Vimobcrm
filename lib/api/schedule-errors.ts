import { getFriendlyErrorMessage } from "@/lib/error-handler";

/** Both conflicts retain the draft, but only an edited event needs a refresh. */
export function getScheduleMutationErrorMessage(error: unknown): string {
  const details = error && typeof error === "object" ? error as { code?: unknown; status?: unknown } : null;
  if (details?.status === 409) {
    if (details.code === "google_calendar_disconnecting") {
      return "A integração com o Google Agenda está sendo desconectada. Aguarde e tente salvar novamente.";
    }
    if (details.code === "schedule_conflict") {
      return "Esta atividade foi alterada ou esta operação já foi registrada. Atualize a agenda e confira os dados antes de tentar novamente.";
    }
  }
  return getFriendlyErrorMessage(error);
}
