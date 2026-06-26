import { notificationsAPI } from "@/lib/api/notifications";
import { usersAPI } from "@/lib/api/users";

/**
 * Gamification Notifier logic for handling position changes and goal achievements.
 */
interface GamificationMetadata {
  newRank?: number;
  oldRank?: number;
  missionTitle?: string;
  bonusPoints?: number;
  [key: string]: unknown;
}

export async function handleGamificationNotifications(
  organizationId: string,
  userId: string,
  type: 'ranking_change' | 'mission_completed' | 'goal_reached',
  metadata: GamificationMetadata
) {
  try {
    const users = await usersAPI.listUsers(organizationId);
    const profile = users.find((user) => user.id === userId);

    if (!profile) return;

    // 2. Prepare notification content based on type
    let title = '';
    let message = '';

    if (type === 'ranking_change') {
      const { newRank, oldRank } = metadata;
      if (typeof newRank !== 'number' || typeof oldRank !== 'number') return;

      if (newRank < oldRank) {
        title = 'Você subiu no ranking! 🏆';
        message = `Parabéns! Você agora ocupa a ${newRank}ª posição no ranking geral.`;
      } else {
        return; // Don't notify for drops unless specifically requested
      }
    } else if (type === 'mission_completed') {
      title = 'Missão cumprida! 🎉';
      message = `Você concluiu a missão "${metadata.missionTitle}" e ganhou ${metadata.bonusPoints} pontos!`;
    }

    if (!title || !message) return;

    await notificationsAPI.create({
      organization_id: organizationId,
      user_id: userId,
      title,
      content: message,
      type: 'gamification',
    });

    if (profile.email) {
      try {
        const { notificationService } = await import('@/services/NotificationService');
        await notificationService.send({
          eventKey: 'gamification_update',
          organizationId,
          userId,
          recipient: profile.email,
          variables: {
            user_name: profile.name,
            title,
            message,
            ...metadata
          }
        });
      } catch (emailErr) {
        console.error('Failed to send gamification email notification:', emailErr);
      }
    }
  } catch (error) {
    console.error('Gamification notification error:', error);
  }
}
