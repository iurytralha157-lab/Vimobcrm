import { z } from 'zod'
import {
  apiEnvelopeSchema,
  nonNegativeIntegerSchema,
  timestampSchema,
  uuidSchema,
} from './common'

const optionalText = (max: number) => z.string().trim().max(max).nullish()
const optionalUUID = uuidSchema.nullish()
const optionalEmailSchema = z.union([
  z.string().trim().email().max(254),
  z.literal(''),
  z.null(),
]).optional().transform((value) => value || undefined)
const decimalStringSchema = z.string().trim().max(40).refine(
  (value) => value === '' || Number.isFinite(Number(value)),
  'Valor decimal invalido',
)

export const leadDealStatusSchema = z.enum(['open', 'won', 'lost'])

const leadProfileSchema = z.object({
  personType: z.enum(['individual', 'company']).optional(),
  gender: z.enum(['male', 'female', 'other']).optional(),
  socialName: z.string().trim().max(180).optional(),
  birthDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  cpf: z.string().trim().max(18).optional(),
  rg: z.string().trim().max(30).optional(),
  cnpj: z.string().trim().max(20).optional(),
  corporateName: z.string().trim().max(180).optional(),
  tradeName: z.string().trim().max(180).optional(),
  stateRegistration: z.string().trim().max(40).optional(),
}).strict()

export const leadCreateInputSchema = z.object({
  name: z.string().trim().min(2).max(180),
  email: optionalEmailSchema,
  phone: optionalText(40),
  source: optionalText(80),
  message: optionalText(2_000),
  feedback: optionalText(2_000),
  propertyCode: optionalText(80),
  propertyId: optionalUUID,
  interestPropertyIds: z.array(uuidSchema).max(20).optional(),
  pipelineId: optionalUUID,
  stageId: optionalUUID,
  assignedUserId: optionalUUID,
  teamId: optionalUUID,
  interestValue: decimalStringSchema.nullish(),
  dealStatus: leadDealStatusSchema.nullish(),
  lostReason: optionalText(300),
  isOwnResource: z.boolean().nullish(),
  conversationId: optionalUUID,
  tagIds: z.array(uuidSchema).max(50).optional(),
  cargo: optionalText(120),
  empresa: optionalText(160),
  profissao: optionalText(120),
  endereco: optionalText(200),
  bairro: optionalText(120),
  numero: optionalText(40),
  cep: optionalText(20),
  cidade: optionalText(120),
  uf: optionalText(2),
  rendaFamiliar: optionalText(80),
  faixaValorImovel: optionalText(80),
  profile: leadProfileSchema.optional(),
  importMode: z.boolean().optional(),
}).strict().superRefine((input, ctx) => {
  if (input.dealStatus === 'lost' && !input.lostReason) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['lostReason'],
      message: 'Motivo da perda e obrigatorio',
    })
  }
})

export const leadUpdateInputSchema = z.object({
  name: z.string().trim().min(2).max(180).optional(),
  email: z.string().trim().email().max(254).nullable().optional(),
  phone: optionalText(40),
  source: optionalText(80),
  message: optionalText(2_000),
  propertyCode: optionalText(80),
  propertyId: optionalUUID,
  interestPropertyId: optionalUUID,
  pipelineId: optionalUUID,
  stageId: optionalUUID,
  assignedUserId: optionalUUID,
  teamId: optionalUUID,
  interestPropertyIds: z.array(uuidSchema).max(20).optional(),
  interestValue: decimalStringSchema.nullish(),
  commissionPercentage: decimalStringSchema.nullish(),
  dealStatus: leadDealStatusSchema.nullable().optional(),
  lostReason: optionalText(300),
  feedback: optionalText(2_000),
  cargo: optionalText(120),
  empresa: optionalText(160),
  profissao: optionalText(120),
  endereco: optionalText(200),
  numero: optionalText(40),
  complemento: optionalText(120),
  bairro: optionalText(120),
  cep: optionalText(20),
  cidade: optionalText(120),
  uf: optionalText(2),
  rendaFamiliar: optionalText(80),
  faixaValorImovel: optionalText(80),
  finalidadeCompra: optionalText(120),
  trabalha: z.boolean().nullish(),
  procuraFinanciamento: z.boolean().nullish(),
  isOwnResource: z.boolean().nullish(),
  profile: leadProfileSchema.optional(),
}).strict().refine(
  (input) => Object.values(input).some((value) => value !== undefined),
  'Informe ao menos uma alteracao',
)

export const leadMoveStageInputSchema = z.object({
  stageId: uuidSchema,
  isOwnResource: z.boolean().nullish(),
  boardOrderAt: timestampSchema.nullish(),
}).strict()

export const leadAssignInputSchema = z.object({
  assignedUserId: uuidSchema.nullable(),
}).strict()

export const leadTagInputSchema = z.object({ tagId: uuidSchema }).strict()

export const leadListQuerySchema = z.object({
  limit: z.number().int().min(1).max(200).optional(),
  offset: z.number().int().min(0).max(100_000).optional(),
  stageId: uuidSchema.optional(),
  assigneeId: uuidSchema.optional(),
  assigned: z.literal('none').optional(),
  search: z.string().trim().max(100).optional(),
  dealStatus: leadDealStatusSchema.optional(),
}).strict().refine(
  (input) => !(input.assigned === 'none' && input.assigneeId),
  'assigned e assigneeId nao podem ser usados juntos',
)

const leadAdditionalFieldsSchema = z.object({
  cargo: z.string().optional(),
  empresa: z.string().optional(),
  profissao: z.string().optional(),
  endereco: z.string().optional(),
  bairro: z.string().optional(),
  numero: z.string().optional(),
  cep: z.string().optional(),
  cidade: z.string().optional(),
  uf: z.string().optional(),
  rendaFamiliar: z.string().optional(),
  faixaValorImovel: z.string().optional(),
	personType: z.enum(['individual', 'company']).optional(),
	gender: z.enum(['male', 'female', 'other']).optional(),
	socialName: z.string().optional(),
	birthDate: z.string().optional(),
	hasCPF: z.boolean().optional(),
	hasRG: z.boolean().optional(),
	cnpj: z.string().optional(),
	corporateName: z.string().optional(),
	tradeName: z.string().optional(),
	stateRegistration: z.string().optional(),
	interestPropertyIds: z.array(uuidSchema).optional(),
}).passthrough()

export const leadSensitiveProfileSchema = z.object({
	cpf: z.string().max(18).optional(),
	rg: z.string().max(30).optional(),
}).strict()

export const apiLeadSensitiveProfileResponseSchema = z.object({
	data: leadSensitiveProfileSchema,
}).strict()

export const apiLeadSchema = z.object({
  id: uuidSchema,
  organizationId: uuidSchema,
  name: z.string().min(1),
  email: z.string().optional(),
  phone: z.string().optional(),
  source: z.string(),
  status: z.string(),
  dealStatus: z.string(),
  lostReason: z.string().optional(),
  priority: z.string(),
  message: z.string().optional(),
  propertyCode: z.string().optional(),
  propertyId: uuidSchema.optional(),
  interestPropertyId: uuidSchema.optional(),
  pipelineId: uuidSchema.optional(),
  stageId: uuidSchema.optional(),
  assignedUserId: uuidSchema.optional(),
  teamId: uuidSchema.optional(),
  interestValue: z.string().optional(),
  commissionPercentage: z.string().optional(),
  feedback: z.string().optional(),
  finalidadeCompra: z.string().optional(),
  trabalha: z.boolean().optional(),
  procuraFinanciamento: z.boolean().optional(),
  isOwnResource: z.boolean().optional(),
  reentryCount: nonNegativeIntegerSchema,
  stage: z.object({
    id: uuidSchema,
    name: z.string(),
    color: z.string().optional(),
    stageKey: z.string().optional(),
  }).passthrough().optional(),
  assignee: z.object({
    id: uuidSchema,
    name: z.string(),
    avatarUrl: z.string().optional(),
  }).passthrough().optional(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  stageEnteredAt: timestampSchema.optional(),
  boardOrderAt: timestampSchema.optional(),
  lastContactAt: timestampSchema.optional(),
  nextFollowUpAt: timestampSchema.optional(),
  additionalFields: leadAdditionalFieldsSchema.optional(),
}).passthrough()

export const apiLeadListResponseSchema = z.object({
  data: z.array(apiLeadSchema),
  total: nonNegativeIntegerSchema,
  limit: z.number().int().min(1).max(200),
  offset: nonNegativeIntegerSchema,
}).passthrough()

export const apiLeadResponseSchema = z.object({
  data: apiLeadSchema,
  reentry: z.boolean().optional(),
  assignedUserName: z.string().optional(),
}).passthrough()

export const apiLeadRoundRobinResponseSchema = z.object({
  success: z.boolean(),
  leadId: uuidSchema,
  pipelineId: uuidSchema.optional(),
  stageId: uuidSchema.optional(),
  assignedUserId: uuidSchema.optional(),
  roundRobinUsed: z.boolean(),
  roundRobinId: uuidSchema.optional(),
  error: z.string().optional(),
}).passthrough()

export const leadUnknownListEnvelopeSchema = apiEnvelopeSchema(z.array(z.unknown()))
