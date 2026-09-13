'use client'

import { ChevronLeft, Users } from 'lucide-react'
import { forwardRef } from 'react'

import { cn } from '@/lib/utils'

export type OnlineUsersTriggerProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  controlsId: string
  className?: string
}

export const OnlineUsersTrigger = forwardRef<
  HTMLButtonElement,
  OnlineUsersTriggerProps
>(function OnlineUsersTrigger({
  open,
  onOpenChange,
  controlsId,
  className,
}, ref) {
  return (
    <button
      ref={ref}
      type="button"
      data-state={open ? 'open' : 'closed'}
      aria-controls={controlsId}
      aria-expanded={open}
      aria-label={open ? 'Fechar presença da equipe' : 'Ver presença da equipe'}
      onClick={() => onOpenChange(!open)}
      className={cn(
        'group relative z-10 flex h-11 w-11 shrink-0 items-center justify-center gap-0.5 rounded-l-[8px] border-0 bg-[var(--app-surface-solid)] text-[var(--app-text-secondary)] transition-[background-color,color,box-shadow,transform] duration-150 ease-out hover:bg-primary hover:text-primary-foreground active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--app-background)] motion-reduce:transition-none',
        open
          ? 'bg-primary text-primary-foreground shadow-none hover:bg-primary/90'
          : 'shadow-[0_8px_24px_rgba(0,0,0,0.08)]',
        className,
      )}
    >
      <Users aria-hidden="true" className="h-4 w-4" />
      <ChevronLeft
        aria-hidden="true"
        className={cn(
          'h-3 w-3 transition-transform duration-200 ease-out motion-reduce:transition-none',
          open && 'rotate-180',
        )}
      />
    </button>
  )
})

OnlineUsersTrigger.displayName = 'OnlineUsersTrigger'
