import Image from 'next/image'
import { Clock3, Wrench } from 'lucide-react'

import type { PublicSiteConfig } from '@/lib/api/public-site-server'

export function PublicSiteMaintenance({ site }: { site: PublicSiteConfig }) {
  const title = site.site_title || site.organization_name || 'Site imobiliário'
  const message =
    site.maintenance_message?.trim() ||
    'Estamos preparando novidades para você. Tente novamente em alguns minutos.'

  return (
    <main
      className="flex min-h-screen items-center justify-center px-5 py-12"
      style={{
        backgroundColor: site.background_color || '#f8fafc',
        color: site.text_color || '#111827',
      }}
    >
      <div className="w-full max-w-xl text-center">
        {site.logo_url ? (
          <Image
            src={site.logo_url}
            alt={title}
            width={240}
            height={96}
            className="mx-auto mb-10 h-auto max-h-24 w-auto max-w-[240px] object-contain"
            unoptimized
            priority
          />
        ) : (
          <p className="mb-10 text-lg font-semibold">{title}</p>
        )}

        <div
          className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl"
          style={{ backgroundColor: `${site.primary_color || '#f97316'}18` }}
        >
          <Wrench className="h-6 w-6" style={{ color: site.primary_color || '#f97316' }} />
        </div>

        <h1 className="mt-6 text-2xl font-semibold tracking-tight sm:text-3xl">
          Site em manutenção
        </h1>
        <p className="mx-auto mt-4 max-w-md text-base leading-7 opacity-70">{message}</p>

        <div className="mt-8 inline-flex items-center gap-2 rounded-full bg-black/5 px-4 py-2 text-sm opacity-70 dark:bg-white/5">
          <Clock3 className="h-4 w-4" />
          Volte em breve
        </div>
      </div>
    </main>
  )
}
