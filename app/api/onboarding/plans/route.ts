export const runtime = 'nodejs'

const PLANS_BACKEND_TIMEOUT_MS = 10_000

type PublicPlan = {
  id?: string
  slug?: string
  name?: string
  price?: number
  reference_price?: number | null
  discount_percentage?: number | null
  display_features?: string[] | null
  display_order?: number | null
  billing_periods?: number[] | null
  billing_cycle?: string | null
  description?: string | null
  trial_enabled?: boolean | null
  trial_days?: number | null
  max_users?: number | null
  max_whatsapp_sessions?: number | null
  modules?: string[] | null
}

type PlansEnvelope = {
  data?: PublicPlan[]
  error?: string
}

const legacyPublicPlanSlugs = new Set(['trial', 'plan-05ec0d1c'])
const legacyPublicPlanNames = new Set(['trial', 'básico', 'basico'])

function isLegacyPublicPlan(plan: PublicPlan) {
  const slug = plan.slug?.trim().toLowerCase() || ''
  const name = plan.name?.trim().toLowerCase() || ''

  return legacyPublicPlanSlugs.has(slug) || legacyPublicPlanNames.has(name)
}

function getAPIBaseURL() {
  return (process.env.VIMOB_API_URL || process.env.NEXT_PUBLIC_VIMOB_API_URL || 'http://localhost:8081').replace(/\/+$/, '')
}

export async function GET() {
  try {
    const response = await fetch(`${getAPIBaseURL()}/v1/public/onboarding/plans`, {
      headers: {
        Accept: 'application/json',
      },
      next: {
        revalidate: 300,
      },
      signal: AbortSignal.timeout(PLANS_BACKEND_TIMEOUT_MS),
    })
    const payload = (await response.json().catch(() => null)) as PlansEnvelope | PublicPlan[] | null
    const plans = Array.isArray(payload) ? payload : payload?.data

    if (!response.ok || !Array.isArray(plans)) {
      return Response.json(
        { data: [], error: 'Não foi possível carregar os planos agora.' },
        { status: 502 },
      )
    }

    return Response.json(
      { data: plans.filter((plan) => !isLegacyPublicPlan(plan)) },
      { status: 200 },
    )
  } catch {
    return Response.json(
      { data: [], error: 'Não foi possível carregar os planos agora.' },
      { status: 503 },
    )
  }
}
