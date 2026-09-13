import { useWhatsAppSessions } from "./use-whatsapp-sessions";

type UseAccessibleSessionsOptions = {
  enabled?: boolean;
};

export function useAccessibleSessions(options: UseAccessibleSessionsOptions = {}) {
  // The sessions endpoint already returns the sessions available to the
  // current user. Reuse the exact same query as the Integrations screen so
  // every WhatsApp entry point observes one status cache.
  return useWhatsAppSessions(options);
}
