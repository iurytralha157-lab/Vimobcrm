import { z } from 'zod';
import { apiEnvelopeSchema, uuidSchema } from '@/lib/validation/common';

export const LEAD_CONTACT_OUTCOME_NOTES_LIMIT = 2000;
const notes = z.string().trim().refine(value => Array.from(value).length <= LEAD_CONTACT_OUTCOME_NOTES_LIMIT,
  'Use até 2.000 caracteres nas anotações.').refine(value => !value.includes('\u0000'), 'Remova caracteres inválidos das anotações.');
const recordedAt = z.string().trim().datetime({ offset: true, message: 'Data de confirmação inválida.' })
  .refine(value => Number.isFinite(Date.parse(value)), 'Data de confirmação inválida.');
export const leadContactOutcomeCommandSchema = z.discriminatedUnion('channel', [
  z.object({ commandId: uuidSchema, channel: z.literal('call'),
    outcome: z.enum(['answered', 'not_answered', 'invalid_number', 'busy', 'scheduled']), notes }).strict(),
  z.object({ commandId: uuidSchema, channel: z.literal('email'),
    outcome: z.enum(['replied', 'not_replied', 'bounced']), notes }).strict(),
]);
export const leadContactOutcomeReceiptSchema = z.object({
  commandId: uuidSchema, leadId: uuidSchema, channel: z.enum(['call', 'email']),
  activityId: uuidSchema, recordedAt,
});
export const leadContactOutcomeResponseSchema = apiEnvelopeSchema(leadContactOutcomeReceiptSchema);
export type LeadContactOutcomeCommand = z.infer<typeof leadContactOutcomeCommandSchema>;
export type LeadContactOutcomeReceipt = z.infer<typeof leadContactOutcomeReceiptSchema>;
