import { z } from 'zod'

import { uuidSchema } from './common'

const publicationTimestampSchema = z.string().trim().datetime({ offset: true })
const nullablePublicationTimestampSchema = publicationTimestampSchema.nullable()

export const propertyPublicationCommandChannelSchema = z.enum([
  'site',
  'grupo_olx',
])

const safePublicURLSchema = z.string().trim().min(1).max(2_048).refine((value) => {
  if (value.startsWith('/') && !value.startsWith('//')) return true

  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}, 'Use uma URL publica HTTP, HTTPS ou um caminho absoluto')

export const propertyPublicationDesiredStateSchema = z.enum([
  'published',
  'paused',
  'unpublished',
])

export const propertyPublicationObservedStateSchema = z.enum([
  'draft',
  'queued',
  'publishing',
  'published',
  'pausing',
  'paused',
  'unpublishing',
  'unpublished',
  'error',
])

export const propertyPublicationReadinessStateSchema = z.enum([
  'unknown',
  'ready',
  'blocked',
])

export const propertyPublicationCheckSchema = z.object({
  code: z.string().trim().min(1).max(120),
  label: z.string().trim().min(1).max(240),
  severity: z.enum(['info', 'warning', 'error']).optional(),
  resolved: z.boolean(),
  message: z.string().trim().min(1).max(1_000).optional(),
}).strict()

export const propertyPublicationErrorSchema = z.object({
  code: z.string().trim().min(1).max(160),
  message: z.string().trim().min(1).max(4_000),
}).strict()

export const propertyPublicationPreviewSchema = z.object({
  title: z.string().trim().max(4_000).optional(),
  description: z.string().trim().max(10_000).optional(),
  price: z.union([z.number().finite(), z.string().trim().max(120), z.null()]).optional(),
  price_label: z.string().trim().max(120).optional(),
  address: z.string().trim().max(1_000).optional(),
  image_urls: z.array(safePublicURLSchema).optional(),
  primary_image_url: safePublicURLSchema.nullable().optional(),
  bedrooms: z.number().int().min(0).nullable().optional(),
  bathrooms: z.number().int().min(0).nullable().optional(),
  parking_spaces: z.number().int().min(0).nullable().optional(),
  area: z.number().finite().min(0).nullable().optional(),
  public_url: safePublicURLSchema.nullable().optional(),
}).strict()

export const propertyPublicationJobStatusSchema = z.enum([
  'pending',
  'processing',
  'retry',
  'succeeded',
  'superseded',
  'dead',
])

export const propertyPublicationJobSchema = z.object({
  id: uuidSchema,
  action: z.enum(['publish', 'update', 'unpublish', 'revalidate']),
  status: propertyPublicationJobStatusSchema,
  version: z.number().int().min(1).nullable().optional(),
  attempts: z.number().int().min(0),
  max_attempts: z.number().int().min(1).max(50),
  next_attempt_at: nullablePublicationTimestampSchema.optional(),
  last_error: propertyPublicationErrorSchema.nullable().optional(),
  completed_at: nullablePublicationTimestampSchema.optional(),
  created_at: publicationTimestampSchema,
}).strict()

export const propertyPublicationCapabilitiesSchema = z.object({
  can_publish: z.boolean(),
  can_unpublish: z.boolean(),
  can_retry: z.boolean(),
  can_preview: z.boolean(),
}).strict()

export const propertyPublicationProviderFeedbackSchema = z.object({
  scope: z.literal('listing_id'),
  version_bound: z.literal(false),
  listing_id: z.string().trim().min(1).max(50),
  report_id: z.string().trim().min(1).max(512),
  severity: z.enum(['warning', 'error']),
  messages: z.array(z.string().trim().min(1).max(1_000)).min(1).max(1_000),
  provider_occurred_at: nullablePublicationTimestampSchema.optional(),
  received_at: publicationTimestampSchema,
}).strict()

export const propertyChannelPublicationSchema = z.object({
  id: uuidSchema.nullable(),
  channel: z.string().trim().min(1).max(64).regex(/^[a-z][a-z0-9_.-]*$/),
  channel_account_key: z.string().trim().min(1).max(160)
    .regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/),
  label: z.string().trim().min(1).max(240),
  available: z.boolean(),
  desired_state: propertyPublicationDesiredStateSchema,
  observed_state: propertyPublicationObservedStateSchema,
  readiness_state: propertyPublicationReadinessStateSchema,
  readiness_score: z.number().int().min(0).max(100),
  checks: z.array(propertyPublicationCheckSchema),
  current_version: z.number().int().min(0),
  published_version: z.number().int().min(1).nullable(),
  is_outdated: z.boolean(),
  public_url: safePublicURLSchema.nullable(),
  preview: propertyPublicationPreviewSchema,
  capabilities: propertyPublicationCapabilitiesSchema,
  provider_feedback: propertyPublicationProviderFeedbackSchema.nullable().optional(),
  last_error: propertyPublicationErrorSchema.nullable(),
  last_requested_at: nullablePublicationTimestampSchema.optional(),
  last_attempt_at: nullablePublicationTimestampSchema.optional(),
  last_succeeded_at: nullablePublicationTimestampSchema.optional(),
  updated_at: nullablePublicationTimestampSchema.optional(),
  recent_jobs: z.array(propertyPublicationJobSchema).max(20).default([]),
}).strict()

export const apiPropertyPublicationOverviewResponseSchema = z.object({
  data: z.object({
    property_id: uuidSchema,
    property_updated_at: publicationTimestampSchema,
    publications: z.array(propertyChannelPublicationSchema),
  }).strict(),
  meta: z.object({
    can_manage: z.boolean(),
  }).strict(),
}).strict()

export const publishPropertyInputSchema = z.object({
  expected_property_updated_at: publicationTimestampSchema,
  // null means the caller observed no canonical row for this channel.
  expected_publication_updated_at: nullablePublicationTimestampSchema,
}).strict()

export const mutatePropertyPublicationInputSchema = z.object({
  expected_publication_updated_at: publicationTimestampSchema,
}).strict()

export type PropertyPublicationDesiredState = z.infer<typeof propertyPublicationDesiredStateSchema>
export type PropertyPublicationCommandChannel = z.infer<typeof propertyPublicationCommandChannelSchema>
export type PropertyPublicationObservedState = z.infer<typeof propertyPublicationObservedStateSchema>
export type PropertyPublicationReadinessState = z.infer<typeof propertyPublicationReadinessStateSchema>
export type PropertyPublicationCheck = z.infer<typeof propertyPublicationCheckSchema>
export type PropertyPublicationError = z.infer<typeof propertyPublicationErrorSchema>
export type PropertyPublicationPreview = z.infer<typeof propertyPublicationPreviewSchema>
export type PropertyPublicationJobStatus = z.infer<typeof propertyPublicationJobStatusSchema>
export type PropertyPublicationJob = z.infer<typeof propertyPublicationJobSchema>
export type PropertyPublicationCapabilities = z.infer<typeof propertyPublicationCapabilitiesSchema>
export type PropertyPublicationProviderFeedback = z.infer<typeof propertyPublicationProviderFeedbackSchema>
export type PropertyChannelPublication = z.infer<typeof propertyChannelPublicationSchema>
export type PropertyPublicationOverview = z.infer<typeof apiPropertyPublicationOverviewResponseSchema>
export type PublishPropertyInput = z.infer<typeof publishPropertyInputSchema>
export type MutatePropertyPublicationInput = z.infer<typeof mutatePropertyPublicationInputSchema>
