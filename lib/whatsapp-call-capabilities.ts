import type { WhatsAppSession } from "@/lib/api/whatsapp";

export function isWhatsAppSessionFeatureEnabled(
  session: WhatsAppSession | undefined,
  setting: "whatsapp_calls_enabled" | "whatsapp_contact_save_enabled",
  currentUserId: string | null,
) {
  const settings = session?.advanced_settings;
  return session?.provider === "evolution_go"
    && Boolean(currentUserId && session.owner_user_id === currentUserId)
    && Boolean(settings && typeof settings === "object" && !Array.isArray(settings)
      && (settings as Record<string, unknown>)[setting] === true);
}
