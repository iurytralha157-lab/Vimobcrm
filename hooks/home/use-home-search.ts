'use client'

import { useMutation } from '@tanstack/react-query'

import { useAuth } from '@/contexts/AuthContext'
import { helpAPI, leadsAPI } from '@/lib/api'
import type { HelpArticleSummary } from '@/lib/validation'

export type HomeLeadSearchResult = {
  id: string
  name: string
  phone: string | null
  email: string | null
  stageName: string | null
  assigneeName: string | null
  href: string
}

export type HomeSearchResult = {
  articles: HelpArticleSummary[]
  leads: HomeLeadSearchResult[]
  partial: boolean
}

function mapLeadResult(lead: Awaited<ReturnType<typeof leadsAPI.getLeads>>['data'][number]) {
  return {
    id: lead.id,
    name: lead.name,
    phone: lead.phone ?? null,
    email: lead.email ?? null,
    stageName: lead.stage?.name ?? null,
    assigneeName: lead.assignee?.name ?? null,
    href: `/crm/pipelines?lead=${encodeURIComponent(lead.id)}`,
  } satisfies HomeLeadSearchResult
}

export function useHomeSearch() {
  const { organization, profile } = useAuth()
  const organizationId = organization?.id ?? profile?.organization_id ?? undefined

  return useMutation({
    mutationFn: async (rawQuery: string): Promise<HomeSearchResult> => {
      if (!organizationId) {
        throw new Error('Selecione uma organização para pesquisar no Vimob.')
      }

      const query = rawQuery.trim()
      const helpPromise = helpAPI.search(query, organizationId, 6)
      const leadPromise = query.length <= 100
        ? leadsAPI.getLeads(organizationId, { search: query, limit: 6 })
        : Promise.resolve({ data: [], count: 0, error: null, limit: 6, offset: 0 })

      const [helpResult, leadResult] = await Promise.allSettled([
        helpPromise,
        leadPromise,
      ])

      if (helpResult.status === 'rejected' && leadResult.status === 'rejected') {
        throw helpResult.reason
      }

      return {
        articles: helpResult.status === 'fulfilled' ? helpResult.value : [],
        leads: leadResult.status === 'fulfilled'
          ? leadResult.value.data.map(mapLeadResult)
          : [],
        partial: helpResult.status === 'rejected' || leadResult.status === 'rejected',
      }
    },
  })
}

