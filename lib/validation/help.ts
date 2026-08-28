import { z } from 'zod'

import { apiEnvelopeSchema, uuidSchema } from './common'

const helpInternalHrefSchema = z.string().trim().max(240).refine(
  (value) => (
    value.startsWith('/')
    && !value.startsWith('//')
    && !/[\u0000-\u001f\u007f]/.test(value)
  ),
  { message: 'Use um caminho interno válido do Vimob.' },
)

const helpImagePathSchema = z.string().trim().max(500).refine(
  (value) => (
    value.startsWith('/help/')
    || value.startsWith('/images/help/')
  ),
  { message: 'Use uma imagem armazenada no diretório público da Central de Ajuda.' },
)

export const helpArticleSlugSchema = z.string().trim().min(1).max(180).regex(
  /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
  'Use um slug minúsculo separado por hífens.',
)

export const helpArticleAnnotationSchema = z.object({
  x: z.number().min(0).max(100),
  y: z.number().min(0).max(100),
  label: z.string().trim().min(1).max(80),
  title: z.string().trim().min(1).max(180).optional(),
}).strict()

export const helpArticleStepSchema = z.object({
  id: z.string().trim().min(1).max(80),
  title: z.string().trim().min(1).max(180),
  body: z.string().trim().min(1).max(5000),
  imageUrl: helpImagePathSchema.optional(),
  imageAlt: z.string().trim().min(1).max(300).optional(),
  imageCaption: z.string().trim().min(1).max(500).optional(),
  actionLabel: z.string().trim().min(1).max(80).optional(),
  actionHref: helpInternalHrefSchema.optional(),
  annotations: z.array(helpArticleAnnotationSchema).max(20).optional(),
}).strict().superRefine((step, context) => {
  if (step.imageUrl && !step.imageAlt) {
    context.addIssue({
      code: 'custom',
      path: ['imageAlt'],
      message: 'Toda captura precisa de texto alternativo.',
    })
  }
  if ((step.actionHref && !step.actionLabel) || (step.actionLabel && !step.actionHref)) {
    context.addIssue({
      code: 'custom',
      path: ['actionHref'],
      message: 'Informe juntos o texto e o destino da ação.',
    })
  }
})

export const apiHelpArticleSummarySchema = z.object({
  id: uuidSchema,
  slug: helpArticleSlugSchema,
  category: z.string().trim().min(1).max(80),
  moduleKey: z.string().trim().min(1).max(80),
  title: z.string().trim().min(1).max(180),
  summary: z.string().trim().min(1).max(320),
  routeHref: helpInternalHrefSchema.nullable().optional(),
  actionLabel: z.string().trim().min(1).max(80).nullable().optional(),
  estimatedMinutes: z.number().int().min(1).max(60),
  displayOrder: z.number().int(),
  updatedAt: z.string().datetime({ offset: true }),
}).passthrough()

export const apiHelpArticleSchema = apiHelpArticleSummarySchema.extend({
  content: z.string().trim().min(1).max(20000),
  searchKeywords: z.array(z.string().trim().min(1).max(80)).max(40),
  steps: z.array(helpArticleStepSchema).max(40),
  relatedSlugs: z.array(helpArticleSlugSchema).max(20),
  imageUrl: helpImagePathSchema.nullable().optional(),
  videoUrl: helpImagePathSchema.nullable().optional(),
  lastReviewedAt: z.string().datetime({ offset: true }).nullable().optional(),
}).passthrough()

export const helpSearchInputSchema = z.object({
  query: z.string().trim().min(2).max(500),
  limit: z.number().int().min(1).max(12).default(8),
}).strict()

export const apiHelpArticleListResponseSchema = apiEnvelopeSchema(
  z.array(apiHelpArticleSummarySchema),
)

export const apiHelpArticleResponseSchema = apiEnvelopeSchema(apiHelpArticleSchema)

export const apiHelpSearchResponseSchema = apiEnvelopeSchema(
  z.array(apiHelpArticleSummarySchema),
)

export type HelpArticleAnnotation = z.infer<typeof helpArticleAnnotationSchema>
export type HelpArticleStep = z.infer<typeof helpArticleStepSchema>
export type HelpArticleSummary = z.infer<typeof apiHelpArticleSummarySchema>
export type HelpArticle = z.infer<typeof apiHelpArticleSchema>
export type HelpSearchInput = z.input<typeof helpSearchInputSchema>
