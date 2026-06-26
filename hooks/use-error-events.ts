'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { telemetryAPI, type ErrorEventFilters } from '@/lib/api/telemetry'

export function useErrorEvents(filters: ErrorEventFilters) {
  return useQuery({
    queryKey: ['admin-error-events', filters],
    queryFn: () => telemetryAPI.getErrorEvents(filters),
    staleTime: 30_000,
    gcTime: 1000 * 60 * 5,
  })
}

export function useResolveErrorEvent() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, note }: { id: string; note?: string }) => telemetryAPI.resolveErrorEvent(id, note),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-error-events'] })
    },
  })
}
