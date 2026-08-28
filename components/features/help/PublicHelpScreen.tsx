'use client'

import { PublicPageShell } from '@/components/features/public'
import { usePublicHelpCatalog } from '@/hooks/help'

import { HelpCatalogContent } from './HelpCatalogContent'
import { HelpPublicQueryProvider } from './HelpPublicQueryProvider'

function PublicHelpContent() {
  const catalog = usePublicHelpCatalog()

  return (
    <PublicPageShell>
      <section className="mx-auto flex w-full max-w-4xl flex-col items-center px-5 pb-5 pt-8 text-center sm:px-8 sm:pb-6 sm:pt-10">
        <h1 className="max-w-3xl text-balance text-[24px] font-normal leading-[1.22] tracking-tight text-[var(--public-foreground)] sm:text-[30px]">
          Central de ajuda
        </h1>
      </section>

      <section className="mx-auto w-full max-w-[980px] px-4 pb-10 sm:px-6 sm:pb-14 lg:px-8">
        <HelpCatalogContent
          articles={catalog.data ?? []}
          basePath="/help"
          isLoading={catalog.isLoading}
          errorMessage={catalog.error instanceof Error ? catalog.error.message : null}
          onRetry={() => {
            void catalog.refetch()
          }}
          publicStyle
          showIntro={false}
        />
      </section>
    </PublicPageShell>
  )
}

export default function PublicHelpScreen() {
  return (
    <HelpPublicQueryProvider>
      <PublicHelpContent />
    </HelpPublicQueryProvider>
  )
}
