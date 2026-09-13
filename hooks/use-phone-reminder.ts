import { useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { notificationService } from '@/services/NotificationService';

const phoneReminderRequestsInFlight = new Set<string>();

export function usePhoneReminder() {
  const { activeOrganization, profile } = useAuth();

  useEffect(() => {
    if (!profile?.id || !activeOrganization.organizationId) return;

    // Importante: se whatsapp for undefined, significa que o perfil completo ainda está carregando
    // Não devemos disparar o lembrete antes de termos certeza que o campo está vazio
    if (profile.whatsapp === undefined) return;
    if (profile.whatsapp && profile.whatsapp.trim() !== '') return;

    const profileId = profile.id;
    const organizationId = activeOrganization.organizationId;
    const userName = profile.name;
    const reminderDay = new Date().toDateString();
    const templateSlug = 'update_phone_reminder';
    const storageKey = `phone_reminder_shown_${profileId}_${reminderDay}`;
    const dedupeKey = `${templateSlug}:${profileId}:${reminderDay}`;
    if (localStorage.getItem(storageKey) || phoneReminderRequestsInFlight.has(dedupeKey)) return;

    phoneReminderRequestsInFlight.add(dedupeKey);

    const createReminder = async () => {
      try {
        const result = await notificationService.send({
          templateSlug,
          organizationId,
          userId: profileId,
          dedupeKey,
          variables: {
            user_name: userName
          }
        });

        if (result.success && result.queued && result.notification?.id) {
          localStorage.setItem(storageKey, 'true');
        }
      } catch (error) {
        console.error('Erro ao criar lembrete de telefone:', error);
      } finally {
        phoneReminderRequestsInFlight.delete(dedupeKey);
      }
    };

    createReminder();
  }, [profile?.id, profile?.name, activeOrganization.organizationId, profile?.whatsapp]);
}
