import { Suspense } from 'react'

import CRMManagementScreen from '@/components/features/crm-management/CRMManagementScreen'

export default function CRMManagementPage() {
  return (
    <Suspense fallback={null}>
      <CRMManagementScreen />
    </Suspense>
  )
}
