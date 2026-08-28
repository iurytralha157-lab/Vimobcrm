import Image from 'next/image'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { ArrowRight, type LucideIcon } from 'lucide-react'

import { BRAND_HEADER_LAYOUT } from '@/config/constants'
import { cn } from '@/lib/utils'

const publicNavigation = [
  { href: '/help', label: 'Ajuda' },
  { href: '/politica-de-privacidade', label: 'Privacidade' },
  { href: '/termos-de-uso', label: 'Termos' },
  { href: '/exclusao-de-dados', label: 'Excluir dados' },
] as const

export function VimobPublicLogo({
  className,
  preload = false,
  width = BRAND_HEADER_LAYOUT.logoWidth,
}: Readonly<{
  className?: string
  preload?: boolean
  width?: number
}>) {
  return (
    <span className={cn('inline-flex items-center', className)} style={{ width }}>
      <Image
        src="/images/logo-black.png"
        alt="Vimob"
        width={1228}
        height={429}
        sizes={`${width}px`}
        preload={preload}
        className="h-auto w-full"
      />
    </span>
  )
}

export function PublicPageShell({
  children,
}: Readonly<{
  children: ReactNode
}>) {
  return (
    <div className="public-light min-h-dvh font-sans">
      <header className="sticky top-0 z-30 bg-[var(--public-background)]">
        <div
          className="mx-auto flex h-[72px] w-full items-center justify-between gap-4 px-4 sm:px-6 lg:px-8"
          style={{ maxWidth: BRAND_HEADER_LAYOUT.maxWidth }}
        >
          <Link
            href="/help"
            aria-label="Vimob"
            className="inline-flex min-h-11 shrink-0 items-center"
          >
            <VimobPublicLogo preload />
          </Link>

          <div className="flex items-center gap-2">
            <nav
              aria-label="Navegação institucional"
              className="hidden items-center gap-1 rounded-[8px] bg-[var(--public-surface)] p-1 sm:flex"
            >
              {publicNavigation.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="inline-flex h-9 items-center rounded-[6px] px-3 text-xs font-light text-[var(--public-muted)] transition-colors hover:bg-[var(--public-soft)] hover:text-[var(--public-foreground)]"
                >
                  {item.label}
                </Link>
              ))}
            </nav>

            <Link
              href="/login"
              className="inline-flex h-10 items-center gap-2 rounded-[6px] bg-[var(--public-accent)] px-4 text-[12px] font-light text-primary-foreground transition-opacity hover:opacity-90"
            >
              Entrar
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </header>

      <main className="min-h-[calc(100dvh-72px)]">{children}</main>

      <footer className="bg-[var(--public-background)] px-4 pb-4 pt-8 sm:px-6 sm:pb-6 lg:px-8">
        <div
          className="mx-auto flex w-full flex-col gap-5 rounded-[8px] bg-[var(--public-surface)] px-5 py-6 text-[12px] font-light text-[var(--public-muted)] sm:px-6 sm:text-[13px] md:flex-row md:items-center md:justify-between"
          style={{ maxWidth: BRAND_HEADER_LAYOUT.maxWidth }}
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <Link
              href="/help"
              aria-label="Vimob"
              className="inline-flex min-h-11 items-center"
            >
              <VimobPublicLogo width={80} />
            </Link>
            <p>© 2026 Vimob. Todos os direitos reservados.</p>
          </div>
          <nav
            aria-label="Links institucionais do rodapé"
            className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[12px] font-light"
          >
            {publicNavigation.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="inline-flex min-h-11 items-center transition-colors hover:text-[var(--public-accent)]"
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      </footer>
    </div>
  )
}

export function PublicHero({
  children,
  compact = false,
  description,
  eyebrow,
  headingLevel = 'h1',
  icon: Icon,
  meta,
  title,
}: Readonly<{
  children?: ReactNode
  compact?: boolean
  description?: string
  eyebrow: string
  headingLevel?: 'h1' | 'h2' | 'p'
  icon?: LucideIcon
  meta?: string
  title: string
}>) {
  const Heading = headingLevel

  return (
    <section className="overflow-hidden">
      <div
        className={cn(
          'mx-auto flex w-full max-w-4xl flex-col items-center px-5 text-center sm:px-8',
          compact ? 'py-10 sm:py-12' : 'py-14 sm:py-16',
        )}
      >
        {Icon ? (
          <span className="mb-4 flex h-11 w-11 items-center justify-center rounded-[8px] bg-[var(--public-surface)] text-[var(--public-tertiary)]">
            <Icon className="h-5 w-5" strokeWidth={1.45} />
          </span>
        ) : null}
        <p className="text-[12px] font-light text-[var(--public-accent)]">
          {eyebrow}
        </p>
        <Heading
          className={cn(
            'max-w-3xl text-balance font-medium text-[var(--public-foreground)]',
            compact
              ? 'mt-3 text-[24px] leading-[1.22] sm:text-[30px]'
              : 'mt-4 text-[28px] leading-[1.18] sm:text-[34px]',
          )}
        >
          {title}
        </Heading>
        {description ? (
          <p className="mt-3 max-w-2xl text-[13px] leading-5 text-[var(--public-muted)] sm:text-sm sm:leading-6">
            {description}
          </p>
        ) : null}
        {meta ? (
          <p
            className={cn(
              'text-[12px] font-light text-[var(--public-tertiary)]',
              compact ? 'mt-3' : 'mt-4',
            )}
          >
            {meta}
          </p>
        ) : null}
        {children ? <div className="mt-6 w-full max-w-3xl">{children}</div> : null}
      </div>
    </section>
  )
}
