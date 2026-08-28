import { z } from 'zod'

import {
  apiPropertyDevelopmentBuildingResponseSchema,
  apiPropertyDevelopmentBulkUnitsResponseSchema,
  apiPropertyDevelopmentFloorPlanResponseSchema,
  apiPropertyDevelopmentListResponseSchema,
  apiPropertyDevelopmentPhaseResponseSchema,
  apiPropertyDevelopmentPriceTableResponseSchema,
	apiPropertyDevelopmentReservationListResponseSchema,
	apiPropertyDevelopmentReservationResponseSchema,
	apiPropertyDevelopmentUnitListResponseSchema,
	apiPropertyDevelopmentUnitPriceResponseSchema,
  apiPropertyDevelopmentUnitResponseSchema,
  apiPropertyDevelopmentWorkspaceResponseSchema,
  organizationIdSchema,
  parseDomainInput,
  propertyDevelopmentBuildingCreateInputSchema,
  propertyDevelopmentBulkUnitsInputSchema,
  propertyDevelopmentCreateInputSchema,
  propertyDevelopmentFloorPlanCreateInputSchema,
  propertyDevelopmentListFiltersSchema,
  propertyDevelopmentPhaseCreateInputSchema,
  propertyDevelopmentPriceTableActivateInputSchema,
	propertyDevelopmentReservationCancelInputSchema,
	propertyDevelopmentReservationConvertInputSchema,
	propertyDevelopmentReservationCreateInputSchema,
	propertyDevelopmentReservationExtendInputSchema,
	propertyDevelopmentReservationListFiltersSchema,
	propertyDevelopmentUnitListFiltersSchema,
  propertyDevelopmentUnitPatchInputSchema,
	propertyDevelopmentUnitPriceInputSchema,
  uuidSchema,
  validateDomainResponse,
  type PropertyDevelopmentBuilding,
  type PropertyDevelopmentBuildingCreateInput,
  type PropertyDevelopmentBulkUnitsInput,
  type PropertyDevelopmentCreateInput,
  type PropertyDevelopmentFloorPlan,
  type PropertyDevelopmentFloorPlanCreateInput,
  type PropertyDevelopmentListFilters,
  type PropertyDevelopmentListItem,
  type PropertyDevelopmentListMeta,
  type PropertyDevelopmentPhase,
  type PropertyDevelopmentPhaseCreateInput,
  type PropertyDevelopmentPriceTable,
  type PropertyDevelopmentPriceTableActivateInput,
	type PropertyDevelopmentReservation,
	type PropertyDevelopmentReservationCancelInput,
	type PropertyDevelopmentReservationConvertInput,
	type PropertyDevelopmentReservationCreateInput,
	type PropertyDevelopmentReservationExtendInput,
	type PropertyDevelopmentReservationListFilters,
	type PropertyDevelopmentReservationListMeta,
  type PropertyDevelopmentUnit,
	type PropertyDevelopmentUnitListFilters,
	type PropertyDevelopmentUnitListMeta,
  type PropertyDevelopmentUnitPatchInput,
	type PropertyDevelopmentUnitPriceInput,
  type PropertyDevelopmentWorkspace,
  type PropertyDevelopmentWorkspaceMeta,
} from '@/lib/validation'

import { vimobAPIRequest } from './vimob-client'

export type PropertyDevelopmentListResponse = {
  data: PropertyDevelopmentListItem[]
  meta: PropertyDevelopmentListMeta
}

export type PropertyDevelopmentWorkspaceResponse = {
  data: PropertyDevelopmentWorkspace
  meta: PropertyDevelopmentWorkspaceMeta
}

export type PropertyDevelopmentUnitListResponse = {
	data: PropertyDevelopmentUnit[]
	meta: PropertyDevelopmentUnitListMeta
}

export type PropertyDevelopmentReservationListResponse = {
	data: PropertyDevelopmentReservation[]
	meta: PropertyDevelopmentReservationListMeta
}

export type PropertyDevelopmentUnitPriceResult = {
	unit: PropertyDevelopmentUnit
	price_table: PropertyDevelopmentPriceTable
}

export type PropertyDevelopmentBulkUnitsResult = {
  units: PropertyDevelopmentUnit[]
  price_table?: PropertyDevelopmentPriceTable | null
  created_count: number
}

function parseOrganizationId(organizationId: string, context: string) {
  return parseDomainInput(organizationIdSchema, organizationId, `${context}.organization`)
}

function parseEntityId(id: string, context: string) {
  return parseDomainInput(uuidSchema, id, `${context}.id`)
}

function listPath(filters: PropertyDevelopmentListFilters) {
  const parsed = parseDomainInput(
    propertyDevelopmentListFiltersSchema,
    filters,
    'property-developments.list.filters',
  )
  const query = new URLSearchParams({
    limit: String(parsed.limit),
    offset: String(parsed.offset),
  })

  if (parsed.search) query.set('search', parsed.search)
  if (parsed.status) query.set('status', parsed.status)
  if (parsed.commercial_status) query.set('commercial_status', parsed.commercial_status)
  if (parsed.development_type) query.set('development_type', parsed.development_type)

  return `/v1/property-developments?${query.toString()}`
}

function unitListPath(developmentId: string, filters: PropertyDevelopmentUnitListFilters) {
	const parsed = parseDomainInput(
		propertyDevelopmentUnitListFiltersSchema,
		filters,
		'property-developments.units.list.filters',
	)
	const query = new URLSearchParams({
		limit: String(parsed.limit),
		offset: String(parsed.offset),
	})

	if (parsed.building_id) query.set('building_id', parsed.building_id)
	if (parsed.floor_plan_id) query.set('floor_plan_id', parsed.floor_plan_id)
	if (parsed.status) query.set('status', parsed.status)
	if (parsed.search) query.set('search', parsed.search)

	return `/v1/property-developments/${developmentId}/units?${query.toString()}`
}

function reservationListPath(
	developmentId: string,
	filters: PropertyDevelopmentReservationListFilters,
) {
	const parsed = parseDomainInput(
		propertyDevelopmentReservationListFiltersSchema,
		filters,
		'property-developments.reservations.list.filters',
	)
	const query = new URLSearchParams({
		limit: String(parsed.limit),
		offset: String(parsed.offset),
	})

	if (parsed.status) query.set('status', parsed.status)
	if (parsed.unit_id) query.set('unit_id', parsed.unit_id)
	if (parsed.lead_id) query.set('lead_id', parsed.lead_id)

	return `/v1/property-developments/${developmentId}/reservations?${query.toString()}`
}

export const propertyDevelopmentsAPI = {
  async list(organizationId: string, filters: PropertyDevelopmentListFilters = {}) {
    const orgId = parseOrganizationId(organizationId, 'property-developments.list')
    const response = await vimobAPIRequest<PropertyDevelopmentListResponse>(listPath(filters), {
      organizationId: orgId,
    })
    validateDomainResponse(apiPropertyDevelopmentListResponseSchema, response, 'property-developments.list')
    return response
  },

  async getWorkspace(organizationId: string, developmentId: string) {
    const orgId = parseOrganizationId(organizationId, 'property-developments.workspace')
    const id = parseEntityId(developmentId, 'property-developments.workspace')
    const response = await vimobAPIRequest<PropertyDevelopmentWorkspaceResponse>(
      `/v1/property-developments/${id}/workspace`,
      { organizationId: orgId },
    )
    validateDomainResponse(
      apiPropertyDevelopmentWorkspaceResponseSchema,
      response,
      'property-developments.workspace',
    )
    return response
  },

	async listUnits(
		organizationId: string,
		developmentId: string,
		filters: PropertyDevelopmentUnitListFilters = {},
	) {
		const orgId = parseOrganizationId(organizationId, 'property-developments.units.list')
		const id = parseEntityId(developmentId, 'property-developments.units.list')
		const response = await vimobAPIRequest<PropertyDevelopmentUnitListResponse>(
			unitListPath(id, filters),
			{ organizationId: orgId },
		)
		validateDomainResponse(
			apiPropertyDevelopmentUnitListResponseSchema,
			response,
			'property-developments.units.list',
		)
		return response
	},

	async listReservations(
		organizationId: string,
		developmentId: string,
		filters: PropertyDevelopmentReservationListFilters = {},
	) {
		const orgId = parseOrganizationId(organizationId, 'property-developments.reservations.list')
		const id = parseEntityId(developmentId, 'property-developments.reservations.list')
		const response = await vimobAPIRequest<PropertyDevelopmentReservationListResponse>(
			reservationListPath(id, filters),
			{ organizationId: orgId },
		)
		return validateDomainResponse(
			apiPropertyDevelopmentReservationListResponseSchema,
			response,
			'property-developments.reservations.list',
		)
	},

  async create(organizationId: string, input: PropertyDevelopmentCreateInput) {
    const orgId = parseOrganizationId(organizationId, 'property-developments.create')
    const body = parseDomainInput(
      propertyDevelopmentCreateInputSchema,
      input,
      'property-developments.create',
    )
    const response = await vimobAPIRequest<PropertyDevelopmentWorkspaceResponse>(
      '/v1/property-developments',
      { method: 'POST', organizationId: orgId, body },
    )
    validateDomainResponse(
      apiPropertyDevelopmentWorkspaceResponseSchema,
      response,
      'property-developments.create',
    )
    return response
  },

  async createPhase(
    organizationId: string,
    developmentId: string,
    input: PropertyDevelopmentPhaseCreateInput,
  ) {
    const orgId = parseOrganizationId(organizationId, 'property-developments.phase.create')
    const id = parseEntityId(developmentId, 'property-developments.phase.create')
    const body = parseDomainInput(
      propertyDevelopmentPhaseCreateInputSchema,
      input,
      'property-developments.phase.create',
    )
    const response = await vimobAPIRequest<{ data: PropertyDevelopmentPhase }>(
      `/v1/property-developments/${id}/phases`,
      { method: 'POST', organizationId: orgId, body },
    )
    validateDomainResponse(
      apiPropertyDevelopmentPhaseResponseSchema,
      response,
      'property-developments.phase.create',
    )
    return response.data
  },

  async createBuilding(
    organizationId: string,
    developmentId: string,
    input: PropertyDevelopmentBuildingCreateInput,
  ) {
    const orgId = parseOrganizationId(organizationId, 'property-developments.building.create')
    const id = parseEntityId(developmentId, 'property-developments.building.create')
    const body = parseDomainInput(
      propertyDevelopmentBuildingCreateInputSchema,
      input,
      'property-developments.building.create',
    )
    const response = await vimobAPIRequest<{ data: PropertyDevelopmentBuilding }>(
      `/v1/property-developments/${id}/buildings`,
      { method: 'POST', organizationId: orgId, body },
    )
    validateDomainResponse(
      apiPropertyDevelopmentBuildingResponseSchema,
      response,
      'property-developments.building.create',
    )
    return response.data
  },

  async createFloorPlan(
    organizationId: string,
    developmentId: string,
    input: PropertyDevelopmentFloorPlanCreateInput,
  ) {
    const orgId = parseOrganizationId(organizationId, 'property-developments.floor-plan.create')
    const id = parseEntityId(developmentId, 'property-developments.floor-plan.create')
    const body = parseDomainInput(
      propertyDevelopmentFloorPlanCreateInputSchema,
      input,
      'property-developments.floor-plan.create',
    )
    const response = await vimobAPIRequest<{ data: PropertyDevelopmentFloorPlan }>(
      `/v1/property-developments/${id}/floor-plans`,
      { method: 'POST', organizationId: orgId, body },
    )
    validateDomainResponse(
      apiPropertyDevelopmentFloorPlanResponseSchema,
      response,
      'property-developments.floor-plan.create',
    )
    return response.data
  },

  async bulkCreateUnits(
    organizationId: string,
    developmentId: string,
    input: PropertyDevelopmentBulkUnitsInput,
  ) {
    const orgId = parseOrganizationId(organizationId, 'property-developments.units.bulk')
    const id = parseEntityId(developmentId, 'property-developments.units.bulk')
    const body = parseDomainInput(
      propertyDevelopmentBulkUnitsInputSchema,
      input,
      'property-developments.units.bulk',
    )
    const response = await vimobAPIRequest<{
      data: Omit<PropertyDevelopmentBulkUnitsResult, 'created_count'>
    }>(
      `/v1/property-developments/${id}/units/bulk`,
      { method: 'POST', organizationId: orgId, body },
    )
    validateDomainResponse(
      apiPropertyDevelopmentBulkUnitsResponseSchema,
      response,
      'property-developments.units.bulk',
    )
    return { ...response.data, created_count: response.data.units.length }
  },

  async updateUnit(
    organizationId: string,
    developmentId: string,
    unitId: string,
    input: PropertyDevelopmentUnitPatchInput,
  ) {
    const orgId = parseOrganizationId(organizationId, 'property-developments.unit.update')
    const id = parseEntityId(developmentId, 'property-developments.unit.update.development')
    const targetUnitId = parseEntityId(unitId, 'property-developments.unit.update.unit')
    const body = parseDomainInput(
      propertyDevelopmentUnitPatchInputSchema,
      input,
      'property-developments.unit.update',
    )
    const response = await vimobAPIRequest<{ data: PropertyDevelopmentUnit }>(
      `/v1/property-developments/${id}/units/${targetUnitId}`,
      { method: 'PATCH', organizationId: orgId, body },
    )
    validateDomainResponse(
      apiPropertyDevelopmentUnitResponseSchema,
      response,
      'property-developments.unit.update',
    )
    return response.data
  },

  async activatePriceTable(
    organizationId: string,
    developmentId: string,
    priceTableId: string,
    input: PropertyDevelopmentPriceTableActivateInput = {},
  ) {
    const orgId = parseOrganizationId(organizationId, 'property-developments.price-table.activate')
    const id = parseEntityId(developmentId, 'property-developments.price-table.activate.development')
    const targetPriceTableId = parseEntityId(
      priceTableId,
      'property-developments.price-table.activate.price-table',
    )
    const body = parseDomainInput(
      propertyDevelopmentPriceTableActivateInputSchema,
      input,
      'property-developments.price-table.activate',
    )
    const response = await vimobAPIRequest<{ data: PropertyDevelopmentPriceTable }>(
      `/v1/property-developments/${id}/price-tables/${targetPriceTableId}/activate`,
      { method: 'POST', organizationId: orgId, body },
    )
    validateDomainResponse(
      apiPropertyDevelopmentPriceTableResponseSchema,
      response,
      'property-developments.price-table.activate',
    )
    return response.data
  },

	async createReservation(
		organizationId: string,
		developmentId: string,
		unitId: string,
		input: PropertyDevelopmentReservationCreateInput,
		idempotencyKey: string,
	) {
		const orgId = parseOrganizationId(organizationId, 'property-developments.reservation.create')
		const id = parseEntityId(developmentId, 'property-developments.reservation.create.development')
		const targetUnitId = parseEntityId(unitId, 'property-developments.reservation.create.unit')
		const key = parseEntityId(idempotencyKey, 'property-developments.reservation.create.idempotency')
		const body = parseDomainInput(
			propertyDevelopmentReservationCreateInputSchema,
			input,
			'property-developments.reservation.create',
		)
		const response = await vimobAPIRequest<{ data: PropertyDevelopmentReservation }>(
			`/v1/property-developments/${id}/units/${targetUnitId}/reservations`,
			{
				method: 'POST',
				organizationId: orgId,
				body,
				headers: { 'Idempotency-Key': key },
			},
		)
		const validated = validateDomainResponse(
			apiPropertyDevelopmentReservationResponseSchema,
			response,
			'property-developments.reservation.create',
		)
		return validated.data
	},

	async cancelReservation(
		organizationId: string,
		developmentId: string,
		reservationId: string,
		input: PropertyDevelopmentReservationCancelInput,
	) {
		return transitionReservation(
			organizationId,
			developmentId,
			reservationId,
			'cancel',
			propertyDevelopmentReservationCancelInputSchema,
			input,
		)
	},

	async convertReservation(
		organizationId: string,
		developmentId: string,
		reservationId: string,
		input: PropertyDevelopmentReservationConvertInput,
	) {
		return transitionReservation(
			organizationId,
			developmentId,
			reservationId,
			'convert',
			propertyDevelopmentReservationConvertInputSchema,
			input,
		)
	},

	async extendReservation(
		organizationId: string,
		developmentId: string,
		reservationId: string,
		input: PropertyDevelopmentReservationExtendInput,
	) {
		return transitionReservation(
			organizationId,
			developmentId,
			reservationId,
			'extend',
			propertyDevelopmentReservationExtendInputSchema,
			input,
		)
	},

	async updateUnitPrice(
		organizationId: string,
		developmentId: string,
		unitId: string,
		input: PropertyDevelopmentUnitPriceInput,
	) {
		const orgId = parseOrganizationId(organizationId, 'property-developments.unit.price')
		const id = parseEntityId(developmentId, 'property-developments.unit.price.development')
		const targetUnitId = parseEntityId(unitId, 'property-developments.unit.price.unit')
		const body = parseDomainInput(
			propertyDevelopmentUnitPriceInputSchema,
			input,
			'property-developments.unit.price',
		)
		const response = await vimobAPIRequest<{ data: PropertyDevelopmentUnitPriceResult }>(
			`/v1/property-developments/${id}/units/${targetUnitId}/price`,
			{ method: 'PUT', organizationId: orgId, body },
		)
		validateDomainResponse(
			apiPropertyDevelopmentUnitPriceResponseSchema,
			response,
			'property-developments.unit.price',
		)
		return response.data
	},
}

async function transitionReservation<TInput>(
	organizationId: string,
	developmentId: string,
	reservationId: string,
	action: 'cancel' | 'convert' | 'extend',
	schema: z.ZodType<TInput>,
	input: TInput,
) {
	const orgId = parseOrganizationId(organizationId, `property-developments.reservation.${action}`)
	const id = parseEntityId(developmentId, `property-developments.reservation.${action}.development`)
	const targetReservationId = parseEntityId(
		reservationId,
		`property-developments.reservation.${action}.reservation`,
	)
	const body = parseDomainInput(
		schema,
		input,
		`property-developments.reservation.${action}`,
	)
	const response = await vimobAPIRequest<{ data: PropertyDevelopmentReservation }>(
		`/v1/property-developments/${id}/reservations/${targetReservationId}/${action}`,
		{ method: 'POST', organizationId: orgId, body },
	)
	const validated = validateDomainResponse(
		apiPropertyDevelopmentReservationResponseSchema,
		response,
		`property-developments.reservation.${action}`,
	)
	return validated.data
}
