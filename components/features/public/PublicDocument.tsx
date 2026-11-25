import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

export function PublicDocument({
  children,
  className,
}: Readonly<{
  children: ReactNode
  className?: string
}>) {
  return (
    <section className="mx-auto w-full max-w-[1040px] px-4 pb-10 sm:px-6 sm:pb-14 lg:px-8">
      <div
        className={cn(
          'rounded-[8px] bg-white px-5 py-6 sm:px-8 sm:py-9 lg:px-10',
          className,
        )}
      >
        <div className="mx-auto max-w-[72ch] text-[14px] leading-6 text-[var(--public-muted)] sm:text-base sm:leading-7">
          {children}
        </div>
      </div>
    </section>
  )
}

export function PublicDocumentSection({
  children,
  title,
}: Readonly<{
  children: ReactNode
  title: string
}>) {
  return (
    <section className="scroll-mt-24 space-y-3">
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="h-6 w-1 shrink-0 rounded-full bg-[var(--public-accent)]"
        />
        <h2 className="text-[17px] font-medium leading-6 text-[var(--public-foreground)] sm:text-lg">
          {title}
        </h2>
      </div>
      <div className="space-y-3">
        {children}
      </div>
    </section>
  )
}
