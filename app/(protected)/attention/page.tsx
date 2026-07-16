import { notFound } from 'next/navigation'
import AttentionCenterScreen from '@/components/features/attention'
import { FEATURES } from '@/config/constants'
import { PermissionBoundary } from '@/components/shared/access/PermissionBoundary'

export default function AttentionPage() {
  if (!FEATURES.ENABLE_ATTENTION_CENTER) notFound()

  return (
    <PermissionBoundary title="Central de Atencao" permission="attention_view">
      <AttentionCenterScreen />
    </PermissionBoundary>
  )
}
