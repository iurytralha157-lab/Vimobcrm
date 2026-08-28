'use client'

import { useQuery } from '@tanstack/react-query'

import { adminAPI } from '@/lib/api/admin'

export type HomeAudienceOption = {
  id: string
  name: string
  detail?: string | null
}

function asText(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

export function useHomePublicationOrganizations(enabled: boolean) {
  return useQuery({
    queryKey: ['home', 'admin-publication-organizations'],
    enabled,
    queryFn: async (): Promise<HomeAudienceOption[]> => {
      const rows = await adminAPI.listOrganizations({})
      return rows
        .map((row) => ({
          id: asText(row.id),
          name: asText(row.name) || asText(row.nome_fantasia) || 'Organização sem nome',
          detail: asText(row.email) || asText(row.cnpj) || null,
        }))
        .filter((item) => item.id)
        .sort((left, right) => left.name.localeCompare(right.name, 'pt-BR'))
    },
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
  })
}

export function useHomePublicationUsers(enabled: boolean) {
  return useQuery({
    queryKey: ['home', 'admin-publication-users'],
    enabled,
    queryFn: async (): Promise<HomeAudienceOption[]> => {
      const rows = await adminAPI.listUsers()
      return rows
        .map((row) => ({
          id: asText(row.id),
          name: asText(row.name) || asText(row.full_name) || asText(row.email) || 'Usuário sem nome',
          detail: asText(row.email) || null,
        }))
        .filter((item) => item.id)
        .sort((left, right) => left.name.localeCompare(right.name, 'pt-BR'))
    },
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
  })
}
