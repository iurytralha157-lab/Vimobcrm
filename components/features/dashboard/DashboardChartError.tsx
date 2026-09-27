import { RefreshCw } from 'lucide-react'

import { Button } from '@/components/ui/button'

type DashboardChartErrorProps = {
  message: string
  onRetry: () => void
}

export function DashboardChartError({ message, onRetry }: DashboardChartErrorProps) {
  return (
    <div role="alert" className="flex h-full min-h-[180px] flex-col items-center justify-center gap-2 rounded-[8px] bg-[var(--app-surface-soft)] px-4 py-6 text-center">
      <p className="text-[12px] font-light text-[var(--app-text-secondary)]">{message}</p>
      <Button type="button" variant="ghost" size="sm" onClick={onRetry} className="gap-1.5 text-primary">
        <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
        Tentar novamente
      </Button>
    </div>
  )
}
