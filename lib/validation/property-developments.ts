import { z } from 'zod'

import { timestampSchema, uuidSchema } from './common'

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const inputTimestampSchema = z.string().trim().datetime({ offset: true })
const responseTimestampSchema = z.string().trim().datetime({ offset: true })
const nullableDateSchema = dateSchema.nullable()
const nullableTimestampSchema = timestampSchema.nullable()
const nullableInputTimestampSchema = inputTimestampSchema.nullable()
const nullableUUIDSchema = uuidSchema.nullable()
const nullableString = (max: number) => z.string().trim().max(max).nullable()
const nullableHTTPURL = (max: number) => z.string().trim().max(max).url()
  .regex(/^https?:\/\//i, 'Use uma URL HTTP ou HTTPS')
  .nullable()
const nullableCount = z.number().int().min(0).nullable()
const nullableArea = z.number().finite().positive().nullable()
const boundedInputCount = z.number().int().min(0).max(1_000).nullable()
const boundedInputArea = z.number().finite().positive().max(10_000_000).nullable()

export const propertyDevelopmentTypeSchema = z.enum([
  'vertical',
  'horizontal',
  'mixed_use',
  'land_subdivision',
  'commercial',
])

export const propertyDevelopmentStatusSchema = z.enum([
  'planning',
  'pre_launch',
  'launched',
  'under_construction',
  'ready',
  'delivered',
  'suspended',
  'cancelled',
  'archived',
])

export const propertyDevelopmentCommercialStatusSchema = z.enum([
  'draft',
  'active',
  'paused',
  'sold_out',
  'closed',
])

export const propertyDevelopmentPhaseStatusSchema = z.enum([
  'planned',
  'pre_launch',
  'launched',
  'under_construction',
  'delivered',
  'suspended',
  'cancelled',
])

export const propertyDevelopmentBuildingTypeSchema = z.enum([
  'tower',
  'block',
  'quadra',
  'sector',
  'street',
])

export const propertyDevelopmentBuildingStatusSchema = z.enum([
  'planned',
  'active',
  'delivered',
  'inactive',
])

export const propertyDevelopmentFloorPlanStatusSchema = z.enum([
  'draft',
  'active',
  'inactive',
  'archived',
])

export const propertyDevelopmentUnitStatusSchema = z.enum([
  'available',
  'negotiation',
  'reserved',
  'sold',
  'blocked',
  'unavailable',
  'withdrawn',
])

export const propertyDevelopmentMutableUnitStatusSchema = propertyDevelopmentUnitStatusSchema.exclude([
  'reserved',
])

export const propertyDevelopmentPriceTableStatusSchema = z.enum([
  'draft',
  'approved',
  'active',
  'expired',
  'archived',
])

export const propertyDevelopmentReservationStatusSchema = z.enum([
  'active',
  'converted',
  'cancelled',
  'expired',
])

export const propertyDevelopmentUnitEventTypeSchema = z.enum([
  'created',
  'updated',
  'status_changed',
  'price_changed',
  'property_linked',
  'reservation_created',
  'reservation_extended',
  'reservation_released',
  'reservation_cancelled',
  'reservation_converted',
  'reservation_expired',
  'imported',
])

export const propertyDeveloperSchema = z.object({
  id: uuidSchema,
  name: z.string().min(1),
  legal_name: z.string().nullable().optional(),
  logo_url: z.string().nullable().optional(),
  status: z.enum(['active', 'inactive', 'archived']),
}).passthrough()

export const propertyDevelopmentSchema = z.object({
  id: uuidSchema,
  organization_id: uuidSchema,
  developer_id: nullableUUIDSchema.optional(),
  developer: propertyDeveloperSchema.nullable().optional(),
  code: z.string().min(1),
  name: z.string().min(1),
  development_type: propertyDevelopmentTypeSchema,
  status: propertyDevelopmentStatusSchema,
  commercial_status: propertyDevelopmentCommercialStatusSchema,
  construction_progress: z.number().finite().min(0).max(100),
  registration_number: z.string().nullable().optional(),
  summary: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  address_number: z.string().nullable().optional(),
  complement: z.string().nullable().optional(),
  neighborhood: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  state: z.string().nullable().optional(),
  postal_code: z.string().nullable().optional(),
  latitude: z.number().finite().nullable().optional(),
  longitude: z.number().finite().nullable().optional(),
  public_address_visibility: z.enum(['exact', 'approximate', 'hidden']),
  launch_date: nullableDateSchema.optional(),
  construction_started_at: nullableDateSchema.optional(),
  expected_delivery_date: nullableDateSchema.optional(),
  delivered_at: nullableDateSchema.optional(),
  main_image_url: z.string().nullable().optional(),
  image_urls: z.array(z.string()),
  amenities: z.array(z.string()),
  published_on_site: z.boolean(),
  responsible_user_id: nullableUUIDSchema.optional(),
  metadata: z.record(z.unknown()),
  created_at: timestampSchema,
  updated_at: timestampSchema,
}).passthrough()

export const propertyDevelopmentInventorySchema = z.object({
  total: z.number().int().min(0),
  available: z.number().int().min(0),
  negotiation: z.number().int().min(0),
  reserved: z.number().int().min(0),
  sold: z.number().int().min(0),
  blocked: z.number().int().min(0),
  unavailable: z.number().int().min(0),
  withdrawn: z.number().int().min(0),
}).passthrough()

export const propertyDevelopmentPriceRangeSchema = z.object({
  minimum: z.number().finite().min(0).nullable(),
  maximum: z.number().finite().min(0).nullable(),
  currency: z.string().regex(/^[A-Z]{3}$/).nullable().optional(),
}).passthrough()

export const propertyDevelopmentListItemSchema = propertyDevelopmentSchema.extend({
  inventory: propertyDevelopmentInventorySchema,
  price_range: propertyDevelopmentPriceRangeSchema,
  floor_plan_count: z.number().int().min(0),
}).passthrough()

export const propertyDevelopmentPhaseSchema = z.object({
  id: uuidSchema,
  organization_id: uuidSchema,
  development_id: uuidSchema,
  code: z.string().min(1),
  name: z.string().min(1),
  sort_order: z.number().int().min(0),
  status: propertyDevelopmentPhaseStatusSchema,
  launch_date: nullableDateSchema.optional(),
  construction_started_at: nullableDateSchema.optional(),
  expected_delivery_date: nullableDateSchema.optional(),
  delivered_at: nullableDateSchema.optional(),
  metadata: z.record(z.unknown()).optional(),
  created_at: timestampSchema,
  updated_at: timestampSchema,
}).passthrough()

export const propertyDevelopmentBuildingSchema = z.object({
  id: uuidSchema,
  organization_id: uuidSchema,
  development_id: uuidSchema,
  phase_id: uuidSchema,
  code: z.string().min(1),
  name: z.string().min(1),
  building_type: propertyDevelopmentBuildingTypeSchema,
  floor_count: boundedInputCount.optional(),
  sort_order: z.number().int().min(0),
  status: propertyDevelopmentBuildingStatusSchema,
	unit_count: z.number().int().min(0).optional(),
  metadata: z.record(z.unknown()).optional(),
  created_at: timestampSchema,
  updated_at: timestampSchema,
}).passthrough()

export const propertyDevelopmentFloorPlanSchema = z.object({
  id: uuidSchema,
  organization_id: uuidSchema,
  development_id: uuidSchema,
  code: z.string().min(1),
  name: z.string().min(1),
  status: propertyDevelopmentFloorPlanStatusSchema,
  property_type: z.string().nullable().optional(),
  bedrooms: boundedInputCount.optional(),
  suites: boundedInputCount.optional(),
  bathrooms: boundedInputCount.optional(),
  parking_spaces: boundedInputCount.optional(),
  private_area: boundedInputArea.optional(),
  total_area: boundedInputArea.optional(),
  balcony_area: boundedInputArea.optional(),
  garden_area: boundedInputArea.optional(),
  description: z.string().nullable().optional(),
  image_url: z.string().nullable().optional(),
	unit_count: z.number().int().min(0).optional(),
  metadata: z.record(z.unknown()).optional(),
  created_at: timestampSchema,
  updated_at: timestampSchema,
}).passthrough()

export const propertyDevelopmentUnitSchema = z.object({
  id: uuidSchema,
  organization_id: uuidSchema,
  development_id: uuidSchema,
  building_id: uuidSchema,
	building_name: z.string().nullable().optional(),
  floor_plan_id: nullableUUIDSchema.optional(),
	floor_plan_name: z.string().nullable().optional(),
  property_id: nullableUUIDSchema.optional(),
  code: z.string().min(1),
  unit_number: z.string().min(1),
  floor_number: z.number().int().nullable().optional(),
  position: z.string().nullable().optional(),
  orientation: z.string().nullable().optional(),
  private_area: nullableArea.optional(),
  total_area: nullableArea.optional(),
  ideal_fraction: z.number().finite().positive().nullable().optional(),
  status: propertyDevelopmentUnitStatusSchema,
  published: z.boolean(),
  list_price: z.number().finite().positive().nullable().optional(),
  minimum_price: z.number().finite().positive().nullable().optional(),
  price_per_sqm: z.number().finite().positive().nullable().optional(),
  currency: z.string().regex(/^[A-Z]{3}$/).nullable().optional(),
  price_table_id: nullableUUIDSchema.optional(),
  price_table_name: z.string().nullable().optional(),
  price_table_status: propertyDevelopmentPriceTableStatusSchema.nullable().optional(),
  draft_list_price: z.number().finite().positive().nullable().optional(),
  draft_minimum_price: z.number().finite().positive().nullable().optional(),
  draft_price_per_sqm: z.number().finite().positive().nullable().optional(),
  draft_price_table_id: nullableUUIDSchema.optional(),
  draft_price_table_name: z.string().nullable().optional(),
  draft_price_table_updated_at: nullableTimestampSchema.optional(),
  metadata: z.record(z.unknown()).optional(),
  created_at: timestampSchema,
  updated_at: timestampSchema,
}).passthrough()

export const propertyDevelopmentReservationSchema = z.object({
  id: uuidSchema,
  organization_id: uuidSchema,
  development_id: uuidSchema,
  unit_id: uuidSchema,
  unit_number: z.string().nullable().optional(),
  unit_code: z.string().nullable().optional(),
  building_name: z.string().nullable().optional(),
  lead_id: nullableUUIDSchema.optional(),
  lead_name: z.string().nullable().optional(),
  price_table_id: nullableUUIDSchema.optional(),
  status: propertyDevelopmentReservationStatusSchema,
  reserved_by: uuidSchema,
  updated_by: nullableUUIDSchema.optional(),
  expires_at: responseTimestampSchema,
  converted_at: responseTimestampSchema.nullable().optional(),
  cancelled_at: responseTimestampSchema.nullable().optional(),
  cancellation_reason: z.string().nullable().optional(),
  list_price_snapshot: z.number().finite().positive().nullable().optional(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  can_operate: z.boolean().optional(),
  idempotency_key: nullableUUIDSchema.optional(),
  notes: z.string().nullable().optional(),
  created_at: responseTimestampSchema,
  updated_at: responseTimestampSchema,
}).strict()

export const propertyDevelopmentPriceTableSchema = z.object({
  id: uuidSchema,
  organization_id: uuidSchema,
  development_id: uuidSchema,
  name: z.string().min(1),
  version: z.number().int().positive(),
  status: propertyDevelopmentPriceTableStatusSchema,
  currency: z.string().regex(/^[A-Z]{3}$/),
  valid_from: nullableDateSchema.optional(),
  valid_until: nullableDateSchema.optional(),
  notes: z.string().nullable().optional(),
  approved_by: nullableUUIDSchema.optional(),
  approved_at: nullableTimestampSchema.optional(),
  priced_unit_count: z.number().int().min(0),
  minimum_list_price: z.number().finite().positive().nullable().optional(),
  maximum_list_price: z.number().finite().positive().nullable().optional(),
  metadata: z.record(z.unknown()).optional(),
  created_at: timestampSchema,
  updated_at: timestampSchema,
}).passthrough()

export const propertyDevelopmentUnitEventSchema = z.object({
  id: uuidSchema,
  organization_id: uuidSchema,
  development_id: uuidSchema,
  unit_id: uuidSchema,
  event_type: propertyDevelopmentUnitEventTypeSchema,
  before_data: z.record(z.unknown()).nullable().optional(),
  after_data: z.record(z.unknown()).nullable().optional(),
  metadata: z.record(z.unknown()).optional(),
  created_by: nullableUUIDSchema.optional(),
  created_at: timestampSchema,
}).passthrough()

export const propertyDevelopmentSummarySchema = z.object({
  phases: z.number().int().min(0),
  buildings: z.number().int().min(0),
  floor_plans: z.number().int().min(0),
  inventory: propertyDevelopmentInventorySchema,
  price_range: propertyDevelopmentPriceRangeSchema,
  completeness_score: z.number().int().min(0).max(100),
  publication_ready: z.boolean(),
  checklist: z.array(z.object({
    code: z.string().min(1),
    label: z.string().min(1),
    resolved: z.boolean(),
  }).passthrough()),
}).passthrough()

export const propertyDevelopmentWorkspaceSchema = z.object({
  development: propertyDevelopmentSchema,
  phases: z.array(propertyDevelopmentPhaseSchema),
  buildings: z.array(propertyDevelopmentBuildingSchema),
  floor_plans: z.array(propertyDevelopmentFloorPlanSchema),
  units: z.array(propertyDevelopmentUnitSchema),
  price_tables: z.array(propertyDevelopmentPriceTableSchema),
  recent_unit_events: z.array(propertyDevelopmentUnitEventSchema),
  summary: propertyDevelopmentSummarySchema,
}).passthrough()

export const propertyDevelopmentListFiltersSchema = z.object({
  search: z.string().trim().max(200).optional(),
  status: propertyDevelopmentStatusSchema.optional(),
  commercial_status: propertyDevelopmentCommercialStatusSchema.optional(),
  development_type: propertyDevelopmentTypeSchema.optional(),
  limit: z.number().int().min(1).max(100).default(50),
  offset: z.number().int().min(0).default(0),
}).strict()

export const propertyDevelopmentUnitListFiltersSchema = z.object({
	building_id: uuidSchema.optional(),
	floor_plan_id: uuidSchema.optional(),
	status: propertyDevelopmentUnitStatusSchema.optional(),
	search: z.string().trim().max(120).optional(),
	limit: z.number().int().min(1).max(200).default(50),
	offset: z.number().int().min(0).default(0),
}).strict()

export const propertyDevelopmentReservationListFiltersSchema = z.object({
  status: propertyDevelopmentReservationStatusSchema.optional(),
  unit_id: uuidSchema.optional(),
  lead_id: uuidSchema.optional(),
  limit: z.number().int().min(1).max(200).default(50),
  offset: z.number().int().min(0).default(0),
}).strict()

export const propertyDevelopmentCreateInputSchema = z.object({
  developer_id: uuidSchema.optional(),
  code: z.string().trim().min(1).max(80),
  name: z.string().trim().min(2).max(200),
  developer_name: z.string().trim().min(2).max(160).optional(),
  development_type: propertyDevelopmentTypeSchema.default('vertical'),
  status: propertyDevelopmentStatusSchema.default('planning'),
  commercial_status: propertyDevelopmentCommercialStatusSchema.default('draft'),
  construction_progress: z.number().finite().min(0).max(100).default(0),
  registration_number: nullableString(120).optional(),
  address: nullableString(240).optional(),
  address_number: nullableString(40).optional(),
  complement: nullableString(120).optional(),
  neighborhood: nullableString(120).optional(),
  city: nullableString(120).optional(),
  state: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/).nullable().optional(),
  postal_code: nullableString(20).optional(),
  launch_date: nullableDateSchema.optional(),
  construction_started_at: nullableDateSchema.optional(),
  expected_delivery_date: nullableDateSchema.optional(),
  summary: nullableString(500).optional(),
  description: nullableString(10_000).optional(),
  main_image_url: nullableHTTPURL(2_000).optional(),
  published_on_site: z.boolean().optional(),
  responsible_user_id: uuidSchema.optional(),
  metadata: z.record(z.unknown()).default({}),
}).strict().superRefine((value, context) => {
	if (value.published_on_site) {
		context.addIssue({
			code: z.ZodIssueCode.custom,
			path: ['published_on_site'],
			message: 'A publicacao exige concluir o checklist do empreendimento',
		})
	}
  if (value.launch_date && value.expected_delivery_date && value.expected_delivery_date < value.launch_date) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['expected_delivery_date'],
      message: 'A previsao de entrega nao pode ser anterior ao lancamento',
    })
  }
})

export const propertyDevelopmentPhaseCreateInputSchema = z.object({
  code: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1).max(160),
  status: propertyDevelopmentPhaseStatusSchema.default('planned'),
  sort_order: z.number().int().min(0).default(0),
  launch_date: nullableDateSchema.optional(),
  construction_started_at: nullableDateSchema.optional(),
  expected_delivery_date: nullableDateSchema.optional(),
  metadata: z.record(z.unknown()).default({}),
}).strict().superRefine((value, context) => {
  if (value.launch_date && value.expected_delivery_date && value.expected_delivery_date < value.launch_date) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['expected_delivery_date'],
      message: 'A previsao de entrega nao pode ser anterior ao lancamento da fase',
    })
  }
})

export const propertyDevelopmentBuildingCreateInputSchema = z.object({
  phase_id: uuidSchema,
  code: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1).max(160),
  building_type: propertyDevelopmentBuildingTypeSchema.default('tower'),
  floor_count: nullableCount.optional(),
  sort_order: z.number().int().min(0).default(0),
  status: propertyDevelopmentBuildingStatusSchema.default('planned'),
  metadata: z.record(z.unknown()).default({}),
}).strict()

export const propertyDevelopmentFloorPlanCreateInputSchema = z.object({
  code: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1).max(160),
  status: propertyDevelopmentFloorPlanStatusSchema.default('draft'),
  property_type: nullableString(120).optional(),
  bedrooms: nullableCount.optional(),
  suites: nullableCount.optional(),
  bathrooms: nullableCount.optional(),
  parking_spaces: nullableCount.optional(),
  private_area: nullableArea.optional(),
  total_area: nullableArea.optional(),
  balcony_area: nullableArea.optional(),
  garden_area: nullableArea.optional(),
  description: nullableString(5_000).optional(),
  image_url: nullableHTTPURL(2_000).optional(),
  metadata: z.record(z.unknown()).default({}),
}).strict().superRefine((value, context) => {
  if (value.bedrooms != null && value.suites != null && value.suites > value.bedrooms) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['suites'],
      message: 'O numero de suites nao pode superar o numero de quartos',
    })
  }
  if (value.private_area != null && value.total_area != null && value.total_area < value.private_area) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['total_area'],
      message: 'A area total nao pode ser menor que a area privativa',
    })
  }
})

export const propertyDevelopmentBulkUnitsInputSchema = z.object({
  building_id: uuidSchema,
  floor_plan_id: nullableUUIDSchema.optional(),
  prefix: z.string().trim().max(24),
  start_number: z.number().int().min(0).max(1_000_000_000),
  count: z.number().int().min(1).max(500),
  start_floor: z.number().int().min(-1_000).max(10_000),
  units_per_floor: z.number().int().min(1).max(100),
  number_padding: z.number().int().min(0).max(8),
  initial_list_price: z.number().finite().positive().max(1_000_000_000_000),
  price_table_name: nullableString(160).optional(),
  metadata: z.record(z.unknown()).default({}),
}).strict()

export const propertyDevelopmentUnitPatchInputSchema = z.object({
  status: propertyDevelopmentMutableUnitStatusSchema.optional(),
  published: z.boolean().optional(),
  expected_updated_at: inputTimestampSchema,
}).strict().refine((value) => value.status !== undefined || value.published !== undefined, {
  message: 'Informe ao menos uma alteracao para a unidade',
})

export const propertyDevelopmentPriceTableActivateInputSchema = z.object({
  expected_updated_at: inputTimestampSchema.optional(),
}).strict()

export const propertyDevelopmentReservationCreateInputSchema = z.object({
  lead_id: nullableUUIDSchema.optional(),
  expires_at: inputTimestampSchema,
  notes: nullableString(2_000).optional(),
  expected_unit_updated_at: inputTimestampSchema,
}).strict()

export const propertyDevelopmentReservationCancelInputSchema = z.object({
  expected_updated_at: inputTimestampSchema,
  cancellation_reason: z.string().trim().min(1).max(500),
}).strict()

export const propertyDevelopmentReservationConvertInputSchema = z.object({
  expected_updated_at: inputTimestampSchema,
}).strict()

export const propertyDevelopmentReservationExtendInputSchema = z.object({
  expected_updated_at: inputTimestampSchema,
  expires_at: inputTimestampSchema,
}).strict()

export const propertyDevelopmentUnitPriceInputSchema = z.object({
  list_price: z.number().finite().positive().max(1_000_000_000_000),
  minimum_price: z.number().finite().positive().max(1_000_000_000_000).nullable().optional(),
  payment_terms: z.record(z.unknown()).nullable().optional(),
  expected_price_table_id: nullableUUIDSchema.optional(),
  expected_price_table_updated_at: nullableInputTimestampSchema.optional(),
}).strict().superRefine((value, context) => {
  if (value.minimum_price != null && value.minimum_price > value.list_price) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['minimum_price'],
      message: 'O preco minimo nao pode superar o preco de lista',
    })
  }
  const hasExpectedTableId = value.expected_price_table_id != null
  const hasExpectedTableTimestamp = value.expected_price_table_updated_at != null
  if (hasExpectedTableId !== hasExpectedTableTimestamp) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: hasExpectedTableId ? ['expected_price_table_updated_at'] : ['expected_price_table_id'],
      message: 'Informe a tabela esperada e sua versao em conjunto',
    })
  }
})

export const apiPropertyDevelopmentListResponseSchema = z.object({
  data: z.array(propertyDevelopmentListItemSchema),
  meta: z.object({
    total: z.number().int().min(0),
    limit: z.number().int().min(1),
    offset: z.number().int().min(0),
    inventory_total: z.number().int().min(0),
    inventory_available: z.number().int().min(0),
    commercial_active: z.number().int().min(0),
    under_construction: z.number().int().min(0),
    can_manage: z.boolean(),
  }).passthrough(),
}).passthrough()

export const apiPropertyDevelopmentWorkspaceResponseSchema = z.object({
  data: propertyDevelopmentWorkspaceSchema,
  meta: z.object({ can_manage: z.boolean() }).passthrough(),
}).passthrough()

export const apiPropertyDevelopmentUnitListResponseSchema = z.object({
	data: z.array(propertyDevelopmentUnitSchema),
	meta: z.object({
		total: z.number().int().min(0),
		limit: z.number().int().min(1).max(200),
		offset: z.number().int().min(0),
	}).passthrough(),
}).passthrough()

export const apiPropertyDevelopmentReservationListResponseSchema = z.object({
  data: z.array(propertyDevelopmentReservationSchema),
  meta: z.object({
    total: z.number().int().min(0),
    limit: z.number().int().min(1).max(200),
    offset: z.number().int().min(0),
    active: z.number().int().min(0),
    expiring_soon: z.number().int().min(0),
    expired: z.number().int().min(0),
  }).strict(),
}).strict()

export const apiPropertyDevelopmentPhaseResponseSchema = z.object({
  data: propertyDevelopmentPhaseSchema,
}).passthrough()

export const apiPropertyDevelopmentBuildingResponseSchema = z.object({
  data: propertyDevelopmentBuildingSchema,
}).passthrough()

export const apiPropertyDevelopmentFloorPlanResponseSchema = z.object({
  data: propertyDevelopmentFloorPlanSchema,
}).passthrough()

export const apiPropertyDevelopmentBulkUnitsResponseSchema = z.object({
  data: z.object({
    units: z.array(propertyDevelopmentUnitSchema),
    price_table: propertyDevelopmentPriceTableSchema.nullable().optional(),
  }).passthrough(),
}).passthrough()

export const apiPropertyDevelopmentUnitResponseSchema = z.object({
  data: propertyDevelopmentUnitSchema,
}).passthrough()

export const apiPropertyDevelopmentPriceTableResponseSchema = z.object({
  data: propertyDevelopmentPriceTableSchema,
}).passthrough()

export const apiPropertyDevelopmentReservationResponseSchema = z.object({
  data: propertyDevelopmentReservationSchema,
}).strict()

export const apiPropertyDevelopmentUnitPriceResponseSchema = z.object({
  data: z.object({
    unit: propertyDevelopmentUnitSchema,
    price_table: propertyDevelopmentPriceTableSchema,
  }).passthrough(),
}).passthrough()

export type PropertyDevelopmentType = z.infer<typeof propertyDevelopmentTypeSchema>
export type PropertyDevelopmentStatus = z.infer<typeof propertyDevelopmentStatusSchema>
export type PropertyDevelopmentCommercialStatus = z.infer<typeof propertyDevelopmentCommercialStatusSchema>
export type PropertyDevelopmentUnitStatus = z.infer<typeof propertyDevelopmentUnitStatusSchema>
export type PropertyDevelopmentReservationStatus = z.infer<typeof propertyDevelopmentReservationStatusSchema>
export type PropertyDevelopment = z.infer<typeof propertyDevelopmentSchema>
export type PropertyDevelopmentListItem = z.infer<typeof propertyDevelopmentListItemSchema>
export type PropertyDevelopmentPhase = z.infer<typeof propertyDevelopmentPhaseSchema>
export type PropertyDevelopmentBuilding = z.infer<typeof propertyDevelopmentBuildingSchema>
export type PropertyDevelopmentFloorPlan = z.infer<typeof propertyDevelopmentFloorPlanSchema>
export type PropertyDevelopmentUnit = z.infer<typeof propertyDevelopmentUnitSchema>
export type PropertyDevelopmentReservation = z.infer<typeof propertyDevelopmentReservationSchema>
export type PropertyDevelopmentPriceTable = z.infer<typeof propertyDevelopmentPriceTableSchema>
export type PropertyDevelopmentUnitEvent = z.infer<typeof propertyDevelopmentUnitEventSchema>
export type PropertyDevelopmentSummary = z.infer<typeof propertyDevelopmentSummarySchema>
export type PropertyDevelopmentWorkspace = z.infer<typeof propertyDevelopmentWorkspaceSchema>
export type PropertyDevelopmentListFilters = z.input<typeof propertyDevelopmentListFiltersSchema>
export type PropertyDevelopmentUnitListFilters = z.input<typeof propertyDevelopmentUnitListFiltersSchema>
export type PropertyDevelopmentReservationListFilters = z.input<typeof propertyDevelopmentReservationListFiltersSchema>
export type PropertyDevelopmentCreateInput = z.input<typeof propertyDevelopmentCreateInputSchema>
export type PropertyDevelopmentPhaseCreateInput = z.input<typeof propertyDevelopmentPhaseCreateInputSchema>
export type PropertyDevelopmentBuildingCreateInput = z.input<typeof propertyDevelopmentBuildingCreateInputSchema>
export type PropertyDevelopmentFloorPlanCreateInput = z.input<typeof propertyDevelopmentFloorPlanCreateInputSchema>
export type PropertyDevelopmentBulkUnitsInput = z.input<typeof propertyDevelopmentBulkUnitsInputSchema>
export type PropertyDevelopmentUnitPatchInput = z.input<typeof propertyDevelopmentUnitPatchInputSchema>
export type PropertyDevelopmentPriceTableActivateInput = z.input<typeof propertyDevelopmentPriceTableActivateInputSchema>
export type PropertyDevelopmentReservationCreateInput = z.input<typeof propertyDevelopmentReservationCreateInputSchema>
export type PropertyDevelopmentReservationCancelInput = z.input<typeof propertyDevelopmentReservationCancelInputSchema>
export type PropertyDevelopmentReservationConvertInput = z.input<typeof propertyDevelopmentReservationConvertInputSchema>
export type PropertyDevelopmentReservationExtendInput = z.input<typeof propertyDevelopmentReservationExtendInputSchema>
export type PropertyDevelopmentUnitPriceInput = z.input<typeof propertyDevelopmentUnitPriceInputSchema>
export type PropertyDevelopmentListMeta = z.infer<typeof apiPropertyDevelopmentListResponseSchema>['meta']
export type PropertyDevelopmentWorkspaceMeta = z.infer<typeof apiPropertyDevelopmentWorkspaceResponseSchema>['meta']
export type PropertyDevelopmentUnitListMeta = z.infer<typeof apiPropertyDevelopmentUnitListResponseSchema>['meta']
export type PropertyDevelopmentReservationListMeta = z.infer<typeof apiPropertyDevelopmentReservationListResponseSchema>['meta']
