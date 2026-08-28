'use client'

import { BellRing } from 'lucide-react'

import { AttentionPolicySettings } from '@/components/features/attention'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'

type PipelineAttentionSettingsProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  pipelineId: string
  pipelineName: string
}

export function PipelineAttentionSettings({
  open,
  onOpenChange,
  pipelineId,
  pipelineName,
}: PipelineAttentionSettingsProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-[96vw] flex-col gap-0 border-0 bg-[var(--app-surface)] p-0 shadow-none sm:max-w-[920px]"
      >
        <SheetHeader className="shrink-0 border-b border-border/30 bg-[var(--app-surface-solid)] px-5 py-4 pr-12 text-left sm:px-6">
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[6px] bg-primary/50 text-primary-foreground">
              <BellRing className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <SheetTitle className="text-[16px] font-normal text-[var(--app-text-primary)]">
                Prioridades e atenção
              </SheetTitle>
              <SheetDescription className="mt-1 text-[12px] font-light leading-5 text-[var(--app-text-tertiary)]">
                Configure como o pipeline {pipelineName} acompanha contato, atribuição e cadências.
              </SheetDescription>
            </div>
          </div>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 sm:px-5 sm:py-5">
          <AttentionPolicySettings pipelineId={pipelineId} pipelineName={pipelineName} />
        </div>
      </SheetContent>
    </Sheet>
  )
}
