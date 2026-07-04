export const runtime = 'nodejs'

type PublicPlan = {
  id?: string
  slug?: string
  name?: string
  price?: number
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
      cache: 'no-store',
    })
    const payload = (await response.json().catch(() => null)) as PlansEnvelope | PublicPlan[] | null
    const plans = Array.isArray(payload) ? payload : payload?.data

    if (!response.ok || !Array.isArray(plans)) {
      return Response.json({ data: [] }, { status: 200 })
    }

    return Response.json({ data: plans }, { status: 200 })
  } catch {
    return Response.json({ data: [] }, { status: 200 })
  }
}
