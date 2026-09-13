'use client'

import { useAuth } from '@/contexts/AuthContext'

/** Canonical tenant identity for queries, mutations, realtime, and cache keys. */
export function useActiveOrganization() {
  return useAuth().activeOrganization
}

/** Canonical nullable tenant id for mutations that must fail closed. */
export function useActiveOrganizationId() {
  return useActiveOrganization().organizationId || null
}

/** Canonical optional tenant id for query `enabled` gates and API filters. */
export function useOptionalActiveOrganizationId() {
  return useActiveOrganization().organizationId || undefined
}
