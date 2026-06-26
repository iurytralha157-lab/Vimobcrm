import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { adminAPI } from '@/lib/api/admin'
import { adminSubscriptionPlanSchema, type AdminSubscriptionPlanInput } from '@/lib/validation'

export interface SubscriptionPlan extends AdminSubscriptionPlanInput {
  id: string
  created_at: string | null
  updated_at: string | null
}

type PlanMutationPayload = AdminSubscriptionPlanInput
type PlanUpdatePayload = Partial<AdminSubscriptionPlanInput> & { id: string }

function normalizePlanInput(input: AdminSubscriptionPlanInput) {
  const parsed = adminSubscriptionPlanSchema.parse(input)

  return {
    ...parsed,
    description: parsed.description?.trim() || null,
    billing_cycle: parsed.billing_cycle?.trim() || null,
    trial_days: parsed.trial_enabled ? parsed.trial_days || 0 : null,
    max_users: parsed.max_users,
    max_leads: parsed.max_leads,
    max_whatsapp_sessions: parsed.max_whatsapp_sessions,
    modules: parsed.modules.map((module) => module.trim()).filter(Boolean),
  }
}

function asSubscriptionPlan(value: unknown) {
  return value as SubscriptionPlan
}

function getMutationMessage(error: unknown) {
  if (error instanceof Error) return error.message
  return 'Erro inesperado'
}

export function useAdminPlans() {
  const queryClient = useQueryClient()

  const invalidatePlans = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['admin-subscription-plans'] }),
      queryClient.invalidateQueries({ queryKey: ['admin-rows', 'admin_subscription_plans'] }),
    ])
  }

  const { data: plans = [], isLoading, error } = useQuery({
    queryKey: ['admin-subscription-plans'],
    queryFn: async () => {
      const rows = await adminAPI.listTableRows('admin_subscription_plans', 200)
      return (rows || []).map(asSubscriptionPlan).sort((a, b) => Number(a.price || 0) - Number(b.price || 0))
    },
    staleTime: 60_000,
  })

  const createPlan = useMutation({
    mutationFn: async (plan: PlanMutationPayload) => {
      const payload = normalizePlanInput(plan)
      return adminAPI.createTableRow<SubscriptionPlan>('admin_subscription_plans', payload)
    },
    onSuccess: async () => {
      toast.success('Plano criado com sucesso.')
      await invalidatePlans()
    },
    onError: (mutationError) => {
      toast.error(`Erro ao criar plano: ${getMutationMessage(mutationError)}`)
    },
  })

  const updatePlan = useMutation({
    mutationFn: async ({ id, ...updates }: PlanUpdatePayload) => {
      const current = plans.find((plan) => plan.id === id)
      const payload = normalizePlanInput({
        slug: updates.slug ?? current?.slug ?? '',
        name: updates.name ?? current?.name ?? '',
        description: updates.description ?? current?.description ?? null,
        price: updates.price ?? current?.price ?? 0,
        billing_cycle: updates.billing_cycle ?? current?.billing_cycle ?? 'monthly',
        trial_enabled: updates.trial_enabled ?? current?.trial_enabled ?? false,
        trial_days: updates.trial_days ?? current?.trial_days ?? null,
        max_users: updates.max_users ?? current?.max_users ?? null,
        max_leads: updates.max_leads ?? current?.max_leads ?? null,
        max_whatsapp_sessions: updates.max_whatsapp_sessions ?? current?.max_whatsapp_sessions ?? null,
        modules: updates.modules ?? current?.modules ?? ['crm'],
        is_active: updates.is_active ?? current?.is_active ?? true,
        is_public: updates.is_public ?? current?.is_public ?? true,
      })

      return adminAPI.updateTableRow<SubscriptionPlan>('admin_subscription_plans', id, payload)
    },
    onSuccess: async () => {
      toast.success('Plano atualizado.')
      await invalidatePlans()
    },
    onError: (mutationError) => {
      toast.error(`Erro ao atualizar plano: ${getMutationMessage(mutationError)}`)
    },
  })

  const deletePlan = useMutation({
    mutationFn: async (id: string) => {
      await adminAPI.deleteTableRow('admin_subscription_plans', id)
    },
    onSuccess: async () => {
      toast.success('Plano excluído.')
      await invalidatePlans()
    },
    onError: (mutationError) => {
      toast.error(`Erro ao excluir plano: ${getMutationMessage(mutationError)}`)
    },
  })

  return {
    plans,
    isLoading,
    error,
    createPlan,
    updatePlan,
    deletePlan,
  }
}
