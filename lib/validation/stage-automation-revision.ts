import { z } from 'zod'
import { stageAutomationInputSchema } from '@/lib/validation/auxiliary'

// Keep the original server text: Date would truncate PostgreSQL microseconds.
const originalAutomationRevisionSchema = z.string().min(1).datetime({ offset: true })

export const stageAutomationUpdateInputSchema = stageAutomationInputSchema
  .safeExtend({ expected_updated_at: originalAutomationRevisionSchema })
  .strict()
  .refine((value) => Object.keys(value).length > 1, 'Informe ao menos um campo para alterar')

export const stageAutomationStatusInputSchema = z.object({
  is_active: z.boolean(),
  expected_updated_at: originalAutomationRevisionSchema,
}).strict()

export const stageAutomationDeleteInputSchema = z.object({
  expected_updated_at: originalAutomationRevisionSchema,
}).strict()

export type StageAutomationUpdateInput = z.infer<typeof stageAutomationUpdateInputSchema>
export type StageAutomationStatusInput = z.infer<typeof stageAutomationStatusInputSchema>
export type StageAutomationDeleteInput = z.infer<typeof stageAutomationDeleteInputSchema>
