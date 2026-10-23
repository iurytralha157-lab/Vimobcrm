import {
  isValidWhatsAppDistributionAutoReplyDelay,
  MAX_WHATSAPP_DISTRIBUTION_AUTO_REPLY_DELAY_SECONDS,
  MAX_WHATSAPP_DISTRIBUTION_AUTO_REPLY_LENGTH,
  type DistributionQueueFormData,
} from '@/lib/round-robin/distribution-queue-form';
import { countDistributionQueueInputCharacters } from '@/lib/round-robin/input-text';

/** Keep navigation, readiness and submission on the same configured reply. */
export function distributionQueueAutoReplyError(
  form: Pick<DistributionQueueFormData, 'conditions' | 'settings'>,
): string | null {
  const configured = form.conditions.some((condition) =>
    condition.type === 'whatsapp_message_contains' && condition.values.some((value) => value.trim()));
  if (!configured || form.settings.whatsapp_distribution_auto_reply_enabled !== true) return null;

  const rawMessage = form.settings.whatsapp_distribution_auto_reply_message;
  const length = countDistributionQueueInputCharacters(typeof rawMessage === 'string' ? rawMessage : '');
  if (length < 1 || length > MAX_WHATSAPP_DISTRIBUTION_AUTO_REPLY_LENGTH) {
    return `A resposta automática deve conter entre 1 e ${MAX_WHATSAPP_DISTRIBUTION_AUTO_REPLY_LENGTH} caracteres.`;
  }
  if (!isValidWhatsAppDistributionAutoReplyDelay(form.settings.whatsapp_distribution_auto_reply_delay_seconds)) {
    return `O atraso da resposta automática deve ficar entre 1 e ${MAX_WHATSAPP_DISTRIBUTION_AUTO_REPLY_DELAY_SECONDS} segundos.`;
  }
  return null;
}
