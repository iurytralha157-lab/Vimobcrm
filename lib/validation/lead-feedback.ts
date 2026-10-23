import { z } from 'zod';
import { apiEnvelopeSchema, timestampSchema, uuidSchema } from '@/lib/validation/common';

export const leadFeedbackCommandSchema = z.object({
  commandId: uuidSchema,
  content: z.string().trim().min(1).refine(value => Array.from(value).length <= 2000,
    'Use até 2.000 caracteres no feedback.'),
}).strict();

export const leadFeedbackReceiptSchema = z.object({
  commandId: uuidSchema,
  leadId: uuidSchema,
  activityId: uuidSchema,
  recordedAt: timestampSchema,
});

export const leadFeedbackResponseSchema = apiEnvelopeSchema(leadFeedbackReceiptSchema);
export type LeadFeedbackCommand = z.infer<typeof leadFeedbackCommandSchema>;
export type LeadFeedbackReceipt = z.infer<typeof leadFeedbackReceiptSchema>;
