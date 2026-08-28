'use client'

import { AppLayout } from '@/components/shared/layout/AppLayout'
import { useHelpCatalog, useHelpSearch } from '@/hooks/help'

import { HelpCatalogContent } from './HelpCatalogContent'

export default function HelpScreen() {
  const catalog = useHelpCatalog()
  const search = useHelpSearch()

  return (
    <AppLayout title="Central de Ajuda">
      <div className="mx-auto w-full max-w-[980px] px-0 py-3 sm:py-6">
        <HelpCatalogContent
          articles={catalog.data ?? []}
          basePath="/suporte"
          isLoading={catalog.isLoading}
          errorMessage={catalog.error instanceof Error ? catalog.error.message : null}
          onRetry={() => {
            void catalog.refetch()
          }}
          onSearch={(query) => search.mutateAsync({ query, limit: 10 })}
        />
      </div>
    </AppLayout>
  )
}
