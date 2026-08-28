'use client'

import { useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { useAuth } from '@/contexts/AuthContext'
import { createTenantQueryAccessSignature } from '@/lib/access/tenant-query-cache'
import {
  propertyDevelopmentsAPI,
} from '@/lib/api/property-developments'
import type {
  PropertyDevelopmentBuildingCreateInput,
  PropertyDevelopmentBulkUnitsInput,
  PropertyDevelopmentCreateInput,
  PropertyDevelopmentFloorPlanCreateInput,
  PropertyDevelopmentListFilters,
  PropertyDevelopmentPhaseCreateInput,
  PropertyDevelopmentPriceTableActivateInput,
	PropertyDevelopmentReservationCancelInput,
	PropertyDevelopmentReservationConvertInput,
	PropertyDevelopmentReservationCreateInput,
	PropertyDevelopmentReservationExtendInput,
	PropertyDevelopmentReservationListFilters,
  PropertyDevelopmentUnitPatchInput,
	PropertyDevelopmentUnitListFilters,
	PropertyDevelopmentUnitPriceInput,
} from '@/lib/validation'

export const propertyDevelopmentKeys = {
  root: (organizationId?: string, accessSignature?: string) => [
    'property-developments',
    organizationId,
    accessSignature,
  ] as const,
  lists: (organizationId?: string, accessSignature?: string) => [
    ...propertyDevelopmentKeys.root(organizationId, accessSignature),
    'list',
  ] as const,
  list: (
    organizationId: string | undefined,
    accessSignature: string,
    filters: PropertyDevelopmentListFilters,
  ) => [
    ...propertyDevelopmentKeys.lists(organizationId, accessSignature),
    filters,
  ] as const,
  workspaces: (organizationId?: string, accessSignature?: string) => [
    ...propertyDevelopmentKeys.root(organizationId, accessSignature),
    'workspace',
  ] as const,
  workspace: (
    organizationId?: string,
    accessSignature?: string,
    developmentId?: string | null,
  ) => [
    ...propertyDevelopmentKeys.workspaces(organizationId, accessSignature),
    developmentId,
  ] as const,
	unitLists: (
		organizationId?: string,
		accessSignature?: string,
		developmentId?: string | null,
	) => [
		...propertyDevelopmentKeys.root(organizationId, accessSignature),
		'units',
		developmentId,
	] as const,
	units: (
		organizationId: string | undefined,
		accessSignature: string,
		developmentId: string | null,
		filters: PropertyDevelopmentUnitListFilters,
	) => [
		...propertyDevelopmentKeys.unitLists(organizationId, accessSignature, developmentId),
		filters,
	] as const,
	reservationLists: (
		organizationId?: string,
		accessSignature?: string,
		developmentId?: string | null,
	) => [
		...propertyDevelopmentKeys.root(organizationId, accessSignature),
		'reservations',
		developmentId,
	] as const,
	reservations: (
		organizationId: string | undefined,
		accessSignature: string,
		developmentId: string | null,
		filters: PropertyDevelopmentReservationListFilters,
	) => [
		...propertyDevelopmentKeys.reservationLists(organizationId, accessSignature, developmentId),
		filters,
	] as const,
}

function useDevelopmentQueryScope() {
  const {
    user,
    profile,
    organization,
    organizationsLoaded,
    isInitializingOrg,
    tenantContext,
    isSuperAdmin,
    impersonating,
  } = useAuth()
  const organizationId = organization?.id
    ?? ((!organizationsLoaded || isInitializingOrg) ? undefined : profile?.organization_id || undefined)

  return {
    organizationId,
    accessSignature: createTenantQueryAccessSignature({
      userId: user?.id ?? profile?.id,
      organizationId,
      memberRole: tenantContext?.memberRole,
      permissions: tenantContext?.permissions,
      enabledModules: tenantContext?.enabledModules,
      isTeamLeader: tenantContext?.isTeamLeader,
      ledTeamIds: tenantContext?.ledTeamIds,
      ledUserIds: tenantContext?.ledUserIds,
      ledPipelineIds: tenantContext?.ledPipelineIds,
      isSuperAdmin: tenantContext?.isSuperAdmin ?? isSuperAdmin,
      impersonatedOrganizationId: impersonating?.orgId,
    }),
  }
}

function useDevelopmentOrganizationId() {
  return useDevelopmentQueryScope().organizationId
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function createUUIDv4() {
	const webCrypto = globalThis.crypto
	if (typeof webCrypto?.randomUUID === 'function') return webCrypto.randomUUID()
	if (typeof webCrypto?.getRandomValues !== 'function') {
		throw new Error('O navegador não oferece geração segura para a chave da reserva')
	}

	const bytes = webCrypto.getRandomValues(new Uint8Array(16))
	bytes[6] = (bytes[6] & 0x0f) | 0x40
	bytes[8] = (bytes[8] & 0x3f) | 0x80
	const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function reservationAttemptFingerprint(variables: {
	unitId: string
	input: PropertyDevelopmentReservationCreateInput
}) {
	return JSON.stringify([
		variables.unitId,
		variables.input.lead_id ?? null,
		variables.input.expires_at,
		variables.input.notes ?? null,
		variables.input.expected_unit_updated_at,
	])
}

function useInvalidatePropertyDevelopments() {
  const queryClient = useQueryClient()
  const { organizationId, accessSignature } = useDevelopmentQueryScope()

  return async (developmentId?: string | null) => {
    const invalidations = [
      queryClient.invalidateQueries({
        queryKey: propertyDevelopmentKeys.lists(organizationId, accessSignature),
      }),
    ]

    if (developmentId) {
      invalidations.push(queryClient.invalidateQueries({
        queryKey: propertyDevelopmentKeys.workspace(organizationId, accessSignature, developmentId),
      }))
		invalidations.push(queryClient.invalidateQueries({
			queryKey: propertyDevelopmentKeys.unitLists(organizationId, accessSignature, developmentId),
		}))
		invalidations.push(queryClient.invalidateQueries({
			queryKey: propertyDevelopmentKeys.reservationLists(organizationId, accessSignature, developmentId),
		}))
    }

    await Promise.all(invalidations)
  }
}

export function usePropertyDevelopments(filters: PropertyDevelopmentListFilters = {}) {
  const { user } = useAuth()
  const { organizationId, accessSignature } = useDevelopmentQueryScope()

  return useQuery({
    queryKey: propertyDevelopmentKeys.list(organizationId, accessSignature, filters),
    queryFn: async () => {
      if (!organizationId) return null
      return propertyDevelopmentsAPI.list(organizationId, filters)
    },
    enabled: Boolean(user?.id && organizationId),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  })
}

export function usePropertyDevelopmentWorkspace(developmentId: string | null) {
  const { user } = useAuth()
  const { organizationId, accessSignature } = useDevelopmentQueryScope()

  return useQuery({
    queryKey: propertyDevelopmentKeys.workspace(organizationId, accessSignature, developmentId),
    queryFn: async () => {
      if (!organizationId || !developmentId) return null
      return propertyDevelopmentsAPI.getWorkspace(organizationId, developmentId)
    },
    enabled: Boolean(user?.id && organizationId && developmentId),
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  })
}

export function usePropertyDevelopmentUnits(
	developmentId: string | null,
	filters: PropertyDevelopmentUnitListFilters = {},
	options: { enabled?: boolean } = {},
) {
	const { user } = useAuth()
	const { organizationId, accessSignature } = useDevelopmentQueryScope()

	return useQuery({
		queryKey: propertyDevelopmentKeys.units(organizationId, accessSignature, developmentId, filters),
		queryFn: async () => {
			if (!organizationId || !developmentId) return null
			return propertyDevelopmentsAPI.listUnits(organizationId, developmentId, filters)
		},
		enabled: Boolean(
			user?.id && organizationId && developmentId && options.enabled !== false,
		),
		staleTime: 30_000,
		refetchInterval: options.enabled === false ? false : 30_000,
		refetchOnWindowFocus: true,
	})
}

export function usePropertyDevelopmentReservations(
	developmentId: string | null,
	filters: PropertyDevelopmentReservationListFilters = {},
) {
	const { user } = useAuth()
	const { organizationId, accessSignature } = useDevelopmentQueryScope()

	return useQuery({
		queryKey: propertyDevelopmentKeys.reservations(
			organizationId,
			accessSignature,
			developmentId,
			filters,
		),
		queryFn: async () => {
			if (!organizationId || !developmentId) return null
			return propertyDevelopmentsAPI.listReservations(organizationId, developmentId, filters)
		},
		enabled: Boolean(user?.id && organizationId && developmentId),
		staleTime: 15_000,
		refetchInterval: 15_000,
		refetchOnWindowFocus: true,
	})
}

export function useCreatePropertyDevelopment() {
  const queryClient = useQueryClient()
  const { organizationId, accessSignature } = useDevelopmentQueryScope()
  const invalidate = useInvalidatePropertyDevelopments()

  return useMutation({
    mutationFn: async (input: PropertyDevelopmentCreateInput) => {
      if (!organizationId) throw new Error('Organizacao nao identificada')
      const response = await propertyDevelopmentsAPI.create(organizationId, input)
      queryClient.setQueryData(
        propertyDevelopmentKeys.workspace(
          organizationId,
          accessSignature,
          response.data.development.id,
        ),
        response,
      )
      return response.data.development
    },
    onSuccess: async () => {
      await invalidate()
      toast.success('Empreendimento criado com sucesso')
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  })
}

export function useCreatePropertyDevelopmentPhase(developmentId: string | null) {
  const organizationId = useDevelopmentOrganizationId()
  const invalidate = useInvalidatePropertyDevelopments()

  return useMutation({
    mutationFn: async (input: PropertyDevelopmentPhaseCreateInput) => {
      if (!organizationId || !developmentId) throw new Error('Organizacao ou empreendimento nao identificado')
      return propertyDevelopmentsAPI.createPhase(organizationId, developmentId, input)
    },
    onSuccess: async () => {
      await invalidate(developmentId)
      toast.success('Fase criada com sucesso')
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  })
}

export function useCreatePropertyDevelopmentBuilding(developmentId: string | null) {
  const organizationId = useDevelopmentOrganizationId()
  const invalidate = useInvalidatePropertyDevelopments()

  return useMutation({
    mutationFn: async (input: PropertyDevelopmentBuildingCreateInput) => {
      if (!organizationId || !developmentId) throw new Error('Organizacao ou empreendimento nao identificado')
      return propertyDevelopmentsAPI.createBuilding(organizationId, developmentId, input)
    },
    onSuccess: async () => {
      await invalidate(developmentId)
      toast.success('Bloco ou torre criado com sucesso')
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  })
}

export function useCreatePropertyDevelopmentFloorPlan(developmentId: string | null) {
  const organizationId = useDevelopmentOrganizationId()
  const invalidate = useInvalidatePropertyDevelopments()

  return useMutation({
    mutationFn: async (input: PropertyDevelopmentFloorPlanCreateInput) => {
      if (!organizationId || !developmentId) throw new Error('Organizacao ou empreendimento nao identificado')
      return propertyDevelopmentsAPI.createFloorPlan(organizationId, developmentId, input)
    },
    onSuccess: async () => {
      await invalidate(developmentId)
      toast.success('Planta criada com sucesso')
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  })
}

export function useBulkCreatePropertyDevelopmentUnits(developmentId: string | null) {
  const organizationId = useDevelopmentOrganizationId()
  const invalidate = useInvalidatePropertyDevelopments()

  return useMutation({
    mutationFn: async (input: PropertyDevelopmentBulkUnitsInput) => {
      if (!organizationId || !developmentId) throw new Error('Organizacao ou empreendimento nao identificado')
      return propertyDevelopmentsAPI.bulkCreateUnits(organizationId, developmentId, input)
    },
    onSuccess: async () => {
      await invalidate(developmentId)
      toast.success('Unidades geradas com sucesso')
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  })
}

export function useUpdatePropertyDevelopmentUnit(developmentId: string | null) {
  const organizationId = useDevelopmentOrganizationId()
  const invalidate = useInvalidatePropertyDevelopments()

  return useMutation({
    mutationFn: async ({
      unitId,
      input,
    }: {
      unitId: string
      input: PropertyDevelopmentUnitPatchInput
    }) => {
      if (!organizationId || !developmentId) throw new Error('Organizacao ou empreendimento nao identificado')
      return propertyDevelopmentsAPI.updateUnit(organizationId, developmentId, unitId, input)
    },
    onSuccess: async () => {
      await invalidate(developmentId)
      toast.success('Unidade atualizada com sucesso')
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  })
}

export function useActivatePropertyDevelopmentPriceTable(developmentId: string | null) {
  const organizationId = useDevelopmentOrganizationId()
  const invalidate = useInvalidatePropertyDevelopments()

  return useMutation({
    mutationFn: async ({
      priceTableId,
      ...input
    }: {
      priceTableId: string
    } & PropertyDevelopmentPriceTableActivateInput) => {
      if (!organizationId || !developmentId) throw new Error('Organizacao ou empreendimento nao identificado')
      return propertyDevelopmentsAPI.activatePriceTable(
        organizationId,
        developmentId,
        priceTableId,
        input,
      )
    },
    onSuccess: async () => {
      await invalidate(developmentId)
      toast.success('Tabela de precos ativada com sucesso')
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  })
}

export function useCreatePropertyDevelopmentReservation(developmentId: string | null) {
	const organizationId = useDevelopmentOrganizationId()
	const invalidate = useInvalidatePropertyDevelopments()
	const idempotencyKeys = useRef(new Map<string, string>())

	return useMutation({
		mutationFn: async (variables: {
			unitId: string
			input: PropertyDevelopmentReservationCreateInput
			idempotencyKey?: string
		}) => {
			if (!organizationId || !developmentId) throw new Error('Organizacao ou empreendimento nao identificado')
			const fingerprint = reservationAttemptFingerprint(variables)
			let idempotencyKey = variables.idempotencyKey || idempotencyKeys.current.get(fingerprint)
			if (!idempotencyKey) {
				idempotencyKey = createUUIDv4()
				if (idempotencyKeys.current.size >= 20) {
					const oldestFingerprint = idempotencyKeys.current.keys().next().value
					if (oldestFingerprint) idempotencyKeys.current.delete(oldestFingerprint)
				}
				idempotencyKeys.current.set(fingerprint, idempotencyKey)
			}
			return propertyDevelopmentsAPI.createReservation(
				organizationId,
				developmentId,
				variables.unitId,
				variables.input,
				idempotencyKey,
			)
		},
		onSuccess: async (_reservation, variables) => {
			idempotencyKeys.current.delete(reservationAttemptFingerprint(variables))
			await invalidate(developmentId)
			toast.success('Reserva criada com sucesso')
		},
		onError: async (error) => {
			await invalidate(developmentId)
			toast.error(getErrorMessage(error))
		},
	})
}

export function useCancelPropertyDevelopmentReservation(developmentId: string | null) {
	const organizationId = useDevelopmentOrganizationId()
	const invalidate = useInvalidatePropertyDevelopments()

	return useMutation({
		mutationFn: async ({
			reservationId,
			input,
		}: {
			reservationId: string
			input: PropertyDevelopmentReservationCancelInput
		}) => {
			if (!organizationId || !developmentId) throw new Error('Organizacao ou empreendimento nao identificado')
			return propertyDevelopmentsAPI.cancelReservation(organizationId, developmentId, reservationId, input)
		},
		onSuccess: async () => {
			await invalidate(developmentId)
			toast.success('Reserva cancelada')
		},
		onError: async (error) => {
			await invalidate(developmentId)
			toast.error(getErrorMessage(error))
		},
	})
}

export function useConvertPropertyDevelopmentReservation(developmentId: string | null) {
	const organizationId = useDevelopmentOrganizationId()
	const invalidate = useInvalidatePropertyDevelopments()

	return useMutation({
		mutationFn: async ({
			reservationId,
			input,
		}: {
			reservationId: string
			input: PropertyDevelopmentReservationConvertInput
		}) => {
			if (!organizationId || !developmentId) throw new Error('Organizacao ou empreendimento nao identificado')
			return propertyDevelopmentsAPI.convertReservation(organizationId, developmentId, reservationId, input)
		},
		onSuccess: async () => {
			await invalidate(developmentId)
			toast.success('Reserva convertida em venda')
		},
		onError: async (error) => {
			await invalidate(developmentId)
			toast.error(getErrorMessage(error))
		},
	})
}

export function useExtendPropertyDevelopmentReservation(developmentId: string | null) {
	const organizationId = useDevelopmentOrganizationId()
	const invalidate = useInvalidatePropertyDevelopments()

	return useMutation({
		mutationFn: async ({
			reservationId,
			input,
		}: {
			reservationId: string
			input: PropertyDevelopmentReservationExtendInput
		}) => {
			if (!organizationId || !developmentId) throw new Error('Organizacao ou empreendimento nao identificado')
			return propertyDevelopmentsAPI.extendReservation(organizationId, developmentId, reservationId, input)
		},
		onSuccess: async () => {
			await invalidate(developmentId)
			toast.success('Prazo da reserva atualizado')
		},
		onError: async (error) => {
			await invalidate(developmentId)
			toast.error(getErrorMessage(error))
		},
	})
}

export function useUpdatePropertyDevelopmentUnitPrice(developmentId: string | null) {
	const organizationId = useDevelopmentOrganizationId()
	const invalidate = useInvalidatePropertyDevelopments()

	return useMutation({
		mutationFn: async ({
			unitId,
			input,
		}: {
			unitId: string
			input: PropertyDevelopmentUnitPriceInput
		}) => {
			if (!organizationId || !developmentId) throw new Error('Organizacao ou empreendimento nao identificado')
			return propertyDevelopmentsAPI.updateUnitPrice(organizationId, developmentId, unitId, input)
		},
		onSuccess: async () => {
			await invalidate(developmentId)
			toast.success('Preço da unidade salvo em rascunho')
		},
		onError: async (error) => {
			await invalidate(developmentId)
			toast.error(getErrorMessage(error))
		},
	})
}
