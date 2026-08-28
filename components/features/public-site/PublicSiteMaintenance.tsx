/* eslint-disable @next/next/no-img-element */

import type { CSSProperties } from 'react'
import { Clock3, Wrench } from 'lucide-react'

import type { PublicSiteConfig } from '@/lib/api/public-site-server'
import { getThemeTokens, normalizePublicImageUrl } from './public-site-utils'

export function PublicSiteMaintenance({ site }: { site: PublicSiteConfig }) {
  const title = site.site_title || site.organization_name || 'Site imobiliário'
  const message =
    site.maintenance_message?.trim() ||
    'Estamos preparando novidades para você. Tente novamente em alguns minutos.'
  const tokens = getThemeTokens(site)
  const logoUrl = normalizePublicImageUrl(site.logo_url)
  const style = {
    '--site-bg': tokens.background,
    '--site-fg': tokens.foreground,
    '--site-primary': tokens.primary,
    '--site-primary-soft': `color-mix(in srgb, ${tokens.primary} 10%, transparent)`,
    '--site-surface-soft': `color-mix(in srgb, ${tokens.foreground} 6%, transparent)`,
  } as CSSProperties

  return (
    <main
      className="flex min-h-screen items-center justify-center bg-[var(--site-bg)] px-5 py-12 text-[var(--site-fg)]"
      style={style}
    >
      <div className="w-full max-w-xl text-center">
        {logoUrl ? (
          <img
            src={logoUrl}
            alt={title}
            width={240}
            height={96}
            className="mx-auto mb-10 h-auto max-h-24 w-auto max-w-[240px] object-contain"
            decoding="async"
            fetchPriority="high"
          />
        ) : (
          <p className="mb-10 text-[14px] font-normal">{title}</p>
        )}

        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-[8px] bg-[var(--site-primary-soft)]">
          <Wrench className="h-6 w-6 text-[var(--site-primary)]" />
        </div>

        <h1 className="mt-6 text-[14px] font-normal">
          Site em manutenção
        </h1>
        <p className="mx-auto mt-4 max-w-md text-[12px] font-light leading-6 opacity-70">{message}</p>

        <div className="mt-8 inline-flex items-center gap-2 rounded-full bg-[var(--site-surface-soft)] px-4 py-2 text-[12px] font-light opacity-70">
          <Clock3 className="h-4 w-4" />
          Volte em breve
        </div>
      </div>
    </main>
  )
}
