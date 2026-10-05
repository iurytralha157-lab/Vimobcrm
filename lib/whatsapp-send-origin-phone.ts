import { leadsAPI } from '@/lib/api/leads';
import { normalizePhoneToE164, normalizeWhatsAppContactPhoneToE164 } from '@/lib/phone-utils';

export async function resolveWhatsAppSendOriginPhone(input: {
  contactPhone: string | null;
  remoteJid: string | null;
  leadId: string;
  organizationId: string;
}): Promise<string | null> {
  const conversationPhone = normalizeWhatsAppContactPhoneToE164(input.contactPhone, input.remoteJid);
  if (conversationPhone) return conversationPhone;

  // A LID is not a phone number. Use only the visible lead's stored phone,
  // resolved by the organization-scoped and lead-visibility-checked API.
  const { data: lead } = await leadsAPI.getLead(input.leadId, input.organizationId);
  if (lead?.id !== input.leadId || lead.organization_id !== input.organizationId) return null;
  return normalizePhoneToE164(lead.phone);
}
