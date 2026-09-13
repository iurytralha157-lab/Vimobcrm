import assert from 'node:assert/strict'
import test from 'node:test'

import {
  apiPropertyDevelopmentListResponseSchema,
	apiPropertyDevelopmentUnitPropertyLinkResponseSchema,
	apiPropertyDevelopmentReservationListResponseSchema,
	apiPropertyDevelopmentUnitListResponseSchema,
  propertyDevelopmentBulkUnitsInputSchema,
  propertyDevelopmentCreateInputSchema,
  propertyDevelopmentFloorPlanCreateInputSchema,
	propertyDevelopmentReservationCancelInputSchema,
	propertyDevelopmentReservationCreateInputSchema,
	propertyDevelopmentReservationExtendInputSchema,
	propertyDevelopmentReservationListFiltersSchema,
	propertyDevelopmentUnitEventTypeSchema,
	propertyDevelopmentUnitListFiltersSchema,
  propertyDevelopmentUnitPatchInputSchema,
	propertyDevelopmentUnitLinkInputSchema,
	propertyDevelopmentUnitPromoteInputSchema,
	propertyDevelopmentUnitUnlinkInputSchema,
	propertyDevelopmentUnitPriceInputSchema,
} from './property-developments'

const organizationId = 'd3f6282c-7a7f-4a0a-b7cc-0562a6af1121'
const developmentId = '70d124f6-f613-4b4a-b5af-879aa7654661'

test('development create normalizes defaults and rejects unknown fields', () => {
  const parsed = propertyDevelopmentCreateInputSchema.parse({
    code: 'RESERVA-01',
    name: 'Reserva das Palmeiras',
    state: 'sp',
  })

  assert.equal(parsed.development_type, 'vertical')
  assert.equal(parsed.status, 'planning')
  assert.equal(parsed.commercial_status, 'draft')
  assert.equal(parsed.construction_progress, 0)
  assert.equal(parsed.state, 'SP')
  assert.equal(propertyDevelopmentCreateInputSchema.safeParse({
    code: 'RESERVA-01',
    name: 'Reserva das Palmeiras',
    unsafe: true,
  }).success, false)
})

test('development and floor plan reject inconsistent values', () => {
  assert.equal(propertyDevelopmentCreateInputSchema.safeParse({
    code: 'RESERVA-01',
    name: 'Reserva das Palmeiras',
    launch_date: '2027-05-01',
    expected_delivery_date: '2027-04-30',
  }).success, false)

  assert.equal(propertyDevelopmentFloorPlanCreateInputSchema.safeParse({
    code: 'PL-03',
    name: 'Tres suites',
    bedrooms: 2,
    suites: 3,
  }).success, false)

  assert.equal(propertyDevelopmentFloorPlanCreateInputSchema.safeParse({
    code: 'PL-02',
    name: 'Dois quartos',
    private_area: 92,
    total_area: 80,
  }).success, false)

  assert.equal(propertyDevelopmentCreateInputSchema.safeParse({
    code: 'RESERVA-01',
    name: 'Reserva das Palmeiras',
    main_image_url: 'javascript:alert(1)',
  }).success, false)
  assert.equal(propertyDevelopmentFloorPlanCreateInputSchema.safeParse({
    code: 'PL-02',
    name: 'Dois quartos',
    image_url: 'ftp://example.com/planta.png',
  }).success, false)
})

test('bulk generation is bounded and unit patch is concurrency aware', () => {
  const validBulk = propertyDevelopmentBulkUnitsInputSchema.safeParse({
    building_id: developmentId,
    prefix: 'T1-',
    start_number: 101,
    count: 80,
    start_floor: 1,
    units_per_floor: 8,
    number_padding: 3,
    initial_list_price: 780000,
  })
  assert.equal(validBulk.success, true)
  assert.equal(propertyDevelopmentBulkUnitsInputSchema.safeParse({
    building_id: developmentId,
    prefix: '',
    start_number: 1,
    count: 1001,
    start_floor: 1,
    units_per_floor: 4,
    number_padding: 3,
  }).success, false)
	assert.equal(propertyDevelopmentBulkUnitsInputSchema.safeParse({
		building_id: developmentId,
		prefix: '',
		start_number: 1,
		count: 1,
		start_floor: 1,
		units_per_floor: 1,
		number_padding: 1,
		initial_list_price: 1e100,
	}).success, false)

  assert.equal(propertyDevelopmentUnitPatchInputSchema.safeParse({
    expected_updated_at: '2026-07-31T12:00:00Z',
  }).success, false)
  assert.equal(propertyDevelopmentUnitPatchInputSchema.safeParse({
    status: 'sold',
  }).success, false)
  assert.equal(propertyDevelopmentUnitPatchInputSchema.safeParse({
    status: 'sold',
    expected_updated_at: '2026-07-31T12:00:00Z',
  }).success, true)
  assert.equal(propertyDevelopmentUnitPatchInputSchema.safeParse({
    status: 'reserved',
    expected_updated_at: '2026-07-31T12:00:00Z',
  }).success, false)
})

test('list response keeps additive server fields while validating tenant-safe core', () => {
  const response = apiPropertyDevelopmentListResponseSchema.parse({
    data: [{
      id: developmentId,
      organization_id: organizationId,
      code: 'RESERVA-01',
      name: 'Reserva das Palmeiras',
      development_type: 'vertical',
      status: 'launched',
      commercial_status: 'active',
      construction_progress: 42.5,
      public_address_visibility: 'approximate',
      image_urls: [],
      amenities: [],
      published_on_site: false,
      metadata: {},
      created_at: '2026-07-31T10:00:00Z',
      updated_at: '2026-07-31T12:00:00Z',
      inventory: {
        total: 80,
        available: 62,
        negotiation: 4,
        reserved: 5,
        sold: 9,
        blocked: 0,
        unavailable: 0,
        withdrawn: 0,
      },
      price_range: { minimum: 780000, maximum: 1200000, currency: 'BRL' },
      floor_plan_count: 3,
      future_server_field: 'preserved',
    }],
    meta: {
      total: 1,
      limit: 50,
      offset: 0,
      inventory_total: 80,
      inventory_available: 62,
      commercial_active: 1,
      under_construction: 0,
      can_manage: true,
      next_cursor: null,
    },
  })

  assert.equal(response.data[0].future_server_field, 'preserved')
  assert.equal(response.meta.next_cursor, null)
})

test('unit inventory filters and paginated response stay bounded', () => {
	const filters = propertyDevelopmentUnitListFiltersSchema.parse({
		building_id: developmentId,
		status: 'available',
		search: '  101  ',
	})
	assert.equal(filters.search, '101')
	assert.equal(filters.limit, 50)
	assert.equal(filters.offset, 0)
	assert.equal(propertyDevelopmentUnitListFiltersSchema.safeParse({ limit: 201 }).success, false)

	const response = apiPropertyDevelopmentUnitListResponseSchema.parse({
		data: [{
			id: developmentId,
			organization_id: organizationId,
			development_id: developmentId,
			building_id: developmentId,
			building_name: 'Torre A',
			code: 'A101',
			unit_number: '101',
			status: 'available',
			published: true,
			created_at: '2026-07-31T10:00:00Z',
			updated_at: '2026-07-31T12:00:00Z',
		}],
		meta: { total: 81, limit: 50, offset: 0 },
	})
	assert.equal(response.data[0].building_name, 'Torre A')
	assert.equal(response.meta.total, 81)
})

test('reservation inputs require optimistic concurrency and bounded filters', () => {
	assert.equal(propertyDevelopmentReservationCreateInputSchema.safeParse({
		expires_at: '2026-08-01T18:00:00Z',
		expected_unit_updated_at: '2026-07-31T12:00:00Z',
	}).success, true)
	assert.equal(propertyDevelopmentReservationCreateInputSchema.safeParse({
		expires_at: '2026-08-01T18:00:00Z',
	}).success, false)
	assert.equal(propertyDevelopmentReservationCreateInputSchema.safeParse({
		expires_at: 'amanha',
		expected_unit_updated_at: '2026-07-31T12:00:00Z',
	}).success, false)
	assert.equal(propertyDevelopmentReservationCancelInputSchema.safeParse({
		expected_updated_at: '2026-07-31T12:00:00Z',
		cancellation_reason: '  x  ',
	}).success, true)
	assert.equal(propertyDevelopmentReservationExtendInputSchema.safeParse({
		expires_at: '2026-08-02T18:00:00Z',
	}).success, false)

	const filters = propertyDevelopmentReservationListFiltersSchema.parse({
		status: 'active',
		unit_id: developmentId,
	})
	assert.equal(filters.limit, 50)
	assert.equal(filters.offset, 0)
	assert.equal(propertyDevelopmentReservationListFiltersSchema.safeParse({ limit: 201 }).success, false)
})

test('unit price validates commercial bounds and reservation list KPIs', () => {
	assert.equal(propertyDevelopmentUnitPriceInputSchema.safeParse({
		list_price: 900000,
		minimum_price: 850000,
		payment_terms: { down_payment: 90000 },
	}).success, true)
	assert.equal(propertyDevelopmentUnitPriceInputSchema.safeParse({
		list_price: 900000,
		payment_terms: null,
	}).success, true)
	assert.equal(propertyDevelopmentUnitPriceInputSchema.safeParse({
		list_price: 800000,
		minimum_price: 850000,
	}).success, false)
	assert.equal(propertyDevelopmentUnitPriceInputSchema.safeParse({
		list_price: 800000,
		expected_price_table_id: developmentId,
	}).success, false)
	assert.equal(propertyDevelopmentUnitEventTypeSchema.safeParse('reservation_released').success, true)
	assert.equal(propertyDevelopmentUnitEventTypeSchema.safeParse('reservation_extended').success, true)
	assert.equal(propertyDevelopmentUnitEventTypeSchema.safeParse('reservation_cancelled').success, true)
	assert.equal(propertyDevelopmentUnitEventTypeSchema.safeParse('reservation_converted').success, true)
	assert.equal(propertyDevelopmentUnitEventTypeSchema.safeParse('reservation_expired').success, true)

	const response = apiPropertyDevelopmentReservationListResponseSchema.parse({
		data: [{
			id: developmentId,
			organization_id: organizationId,
			development_id: developmentId,
			unit_id: developmentId,
			unit_number: '101',
			building_name: 'Torre A',
			lead_id: null,
			lead_name: null,
			status: 'active',
			reserved_by: organizationId,
			expires_at: '2026-08-01T18:00:00Z',
			list_price_snapshot: 900000,
			currency: 'BRL',
			can_operate: false,
			created_at: '2026-07-31T10:00:00Z',
			updated_at: '2026-07-31T12:00:00Z',
		}],
		meta: {
			total: 1,
			limit: 50,
			offset: 0,
			active: 1,
			expiring_soon: 1,
			expired: 0,
		},
	})
	assert.equal(response.data[0].unit_number, '101')
	assert.equal(response.data[0].can_operate, false)
	assert.equal(response.meta.expiring_soon, 1)
	assert.equal(apiPropertyDevelopmentReservationListResponseSchema.safeParse({
		...response,
		data: [{ ...response.data[0], payment_snapshot: { secret: true } }],
	}).success, false)
	assert.equal(apiPropertyDevelopmentReservationListResponseSchema.safeParse({
		...response,
		data: [{ ...response.data[0], updated_at: 'not-a-timestamp' }],
	}).success, false)
})

test('unit property link contracts are strict and concurrency aware', () => {
	const propertyId = 'abcdefab-cdef-4abc-8def-abcdefabcdef'
	const timestamp = '2026-08-31T12:00:00Z'

	assert.equal(propertyDevelopmentUnitLinkInputSchema.safeParse({
		property_id: propertyId,
		expected_unit_updated_at: timestamp,
		expected_property_updated_at: timestamp,
	}).success, true)
	assert.equal(propertyDevelopmentUnitLinkInputSchema.safeParse({
		property_id: propertyId,
		expected_unit_updated_at: timestamp,
	}).success, false)
	assert.equal(propertyDevelopmentUnitLinkInputSchema.safeParse({
		property_id: propertyId,
		expected_unit_updated_at: timestamp,
		expected_property_updated_at: timestamp,
		organization_id: organizationId,
	}).success, false)

	assert.equal(propertyDevelopmentUnitPromoteInputSchema.safeParse({
		expected_unit_updated_at: timestamp,
		property_type: 'Apartamento',
	}).success, true)
	assert.equal(propertyDevelopmentUnitPromoteInputSchema.safeParse({
		property_type: 'Apartamento',
	}).success, false)
	assert.equal(propertyDevelopmentUnitUnlinkInputSchema.safeParse({
		expected_unit_updated_at: timestamp,
	}).success, true)
	assert.equal(propertyDevelopmentUnitUnlinkInputSchema.safeParse({}).success, false)
})

test('unit property link response is explicit and rejects hidden payload drift', () => {
	const timestamp = '2026-08-31T12:00:00Z'
	const unit = {
		id: '11111111-1111-4111-8111-111111111111',
		organization_id: organizationId,
		development_id: developmentId,
		building_id: '22222222-2222-4222-8222-222222222222',
		property_id: 'abcdefab-cdef-4abc-8def-abcdefabcdef',
		code: 'T1-101',
		unit_number: '101',
		status: 'available',
		published: false,
		metadata: {},
		created_at: timestamp,
		updated_at: timestamp,
	}
	const payload = {
		data: {
			unit,
			property: {
				id: 'abcdefab-cdef-4abc-8def-abcdefabcdef',
				code: 'AP-000001',
				title: 'Residencial Horizonte - Unidade 101',
				status: 'active',
				updated_at: timestamp,
			},
			replayed: false,
		},
	}
	assert.equal(apiPropertyDevelopmentUnitPropertyLinkResponseSchema.safeParse(payload).success, true)
	assert.equal(apiPropertyDevelopmentUnitPropertyLinkResponseSchema.safeParse({
		...payload,
		data: { ...payload.data, internal: true },
	}).success, false)
})
