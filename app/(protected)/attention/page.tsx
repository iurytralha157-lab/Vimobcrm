import { notFound } from 'next/navigation'
import AttentionCenterScreen from '@/components/features/attention'
import { FEATURES } from '@/config/constants'

export default function AttentionPage() {
  if (!FEATURES.ENABLE_ATTENTION_CENTER) notFound()

  return <AttentionCenterScreen />
}
