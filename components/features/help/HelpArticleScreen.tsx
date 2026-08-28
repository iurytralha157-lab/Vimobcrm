'use client'

import {
  AlertCircle,
  BookOpenText,
  Loader2,
  RefreshCw,
  TriangleAlert,
} from 'lucide-react'
import Link from 'next/link'

import { AppLayout } from '@/components/shared/layout/AppLayout'
import { useHelpArticle, useHelpCatalog } from '@/hooks/help'
import { VimobAPIError } from '@/lib/api/vimob-client'

import { HelpArticleView } from './HelpArticleView'

function canUseCachedHelpData(error: unknown) {
  return error instanceof TypeError || (
    error instanceof VimobAPIError
    && (
      error.status === 0
      || error.status === 408
      || error.status === 429
      || error.status >= 500
    )
  )
}

type HelpRefreshNoticeProps = {
  message: string
  isRetrying?: boolean
  onRetry?: () => void
}

function HelpRefreshNotice({
  message,
  isRetrying = false,
  onRetry,
}: HelpRefreshNoticeProps) {
  return (
    <div
      role="status"
      className="mx-auto flex w-full max-w-6xl flex-col gap-3 rounded-[8px] bg-[var(--app-surface-soft)] p-3 shadow-none sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex min-w-0 items-start gap-2">
        <TriangleAlert aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
        <p className="text-[12px] font-light leading-[18px] text-[var(--app-text-secondary)]">
          {message}
        </p>
      </div>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          disabled={isRetrying}
          className="inline-flex min-h-9 shrink-0 items-center justify-center gap-2 rounded-[6px] px-3 text-[12px] font-light text-primary transition-colors hover:bg-primary hover:text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35 disabled:cursor-wait disabled:opacity-60"
        >
          {isRetrying ? (
            <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw aria-hidden className="h-4 w-4" />
          )}
          Atualizar
        </button>
      ) : null}
    </div>
  )
}

export function HelpArticleScreen({ slug }: { slug: string }) {
  const articleQuery = useHelpArticle(slug)
  const catalogQuery = useHelpCatalog()
  const articleNotFound = articleQuery.error instanceof VimobAPIError
    && articleQuery.error.code === 'help_article_not_found'
  const canUseCachedArticle = articleQuery.isRefetchError
    && canUseCachedHelpData(articleQuery.error)

  if (articleQuery.isLoading && !articleQuery.data) {
    return (
      <AppLayout title="Central de Ajuda">
        <div role="status" className="flex min-h-[55dvh] items-center justify-center gap-2 text-[12px] font-light text-[var(--app-text-tertiary)]">
          <Loader2 aria-hidden className="h-5 w-5 animate-spin text-primary" />
          <span>Carregando artigo...</span>
        </div>
      </AppLayout>
    )
  }

  if (articleQuery.isError && !articleNotFound && !canUseCachedArticle) {
    return (
      <AppLayout title="Central de Ajuda">
        <div role="alert" className="mx-auto flex min-h-[55dvh] max-w-xl flex-col items-center justify-center px-4 text-center">
          <span className="grid h-10 w-10 place-items-center rounded-[8px] bg-destructive/10 text-destructive">
            <AlertCircle aria-hidden className="h-5 w-5" />
          </span>
          <h2 className="mt-4 text-[14px] font-normal text-[var(--app-text-primary)]">
            Não foi possível carregar este artigo
          </h2>
          <p className="mt-2 text-[12px] font-light leading-[18px] text-[var(--app-text-tertiary)]">
            A Central de Ajuda continua disponível. Tente abrir este conteúdo novamente.
          </p>
          <button
            type="button"
            onClick={() => void articleQuery.refetch()}
            disabled={articleQuery.isFetching}
            className="mt-5 inline-flex h-10 items-center gap-2 rounded-[6px] bg-primary/50 px-4 text-[12px] font-light text-primary-foreground shadow-none transition-colors hover:bg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35 disabled:cursor-wait disabled:opacity-60"
          >
            {articleQuery.isFetching ? (
              <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw aria-hidden className="h-4 w-4" />
            )}
            Tentar novamente
          </button>
        </div>
      </AppLayout>
    )
  }

  if (articleNotFound || !articleQuery.data) {
    return (
      <AppLayout title="Central de Ajuda">
        <div className="mx-auto flex min-h-[55dvh] max-w-xl flex-col items-center justify-center text-center">
          <span className="grid h-10 w-10 place-items-center rounded-[8px] bg-[var(--app-surface-soft)] text-primary">
            <BookOpenText aria-hidden className="h-5 w-5" />
          </span>
          <h2 className="mt-4 text-[14px] font-normal text-[var(--app-text-primary)]">Este artigo não está disponível</h2>
          <p className="mt-2 text-[12px] font-light leading-[18px] text-[var(--app-text-tertiary)]">
            Ele pode ter sido atualizado, despublicado ou não estar visível para o seu acesso.
          </p>
          <Link
            href="/suporte"
            className="mt-5 inline-flex h-10 items-center rounded-[6px] bg-primary/50 px-4 text-[12px] font-light text-primary-foreground shadow-none transition-colors hover:bg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35"
          >
            Voltar para a Central
          </Link>
        </div>
      </AppLayout>
    )
  }

  const relatedSlugs = new Set(articleQuery.data.relatedSlugs)
  const canUseCachedCatalog = !catalogQuery.isError || (
    catalogQuery.isRefetchError && canUseCachedHelpData(catalogQuery.error)
  )
  const relatedArticles = canUseCachedCatalog
    ? (catalogQuery.data ?? []).filter((article) => relatedSlugs.has(article.slug))
    : []
  const hasRelatedReferences = relatedSlugs.size > 0
  const relatedCatalogIsLoading = hasRelatedReferences
    && catalogQuery.isLoading
    && !catalogQuery.data
  const relatedCatalogFailed = hasRelatedReferences && catalogQuery.isError

  return (
    <AppLayout title="Central de Ajuda">
      <div className="space-y-3 py-3 sm:py-6">
        {canUseCachedArticle ? (
          <HelpRefreshNotice
            message="Este artigo continua disponível, mas não foi possível confirmar a versão mais recente."
            isRetrying={articleQuery.isFetching}
            onRetry={() => void articleQuery.refetch()}
          />
        ) : null}
        {relatedCatalogIsLoading ? (
          <div role="status" className="mx-auto flex w-full max-w-6xl items-center gap-2 rounded-[8px] bg-[var(--app-surface-soft)] p-3 text-[12px] font-light text-[var(--app-text-secondary)] shadow-none">
            <Loader2 aria-hidden className="h-4 w-4 animate-spin text-primary" />
            <span>Carregando artigos relacionados...</span>
          </div>
        ) : relatedCatalogFailed ? (
          <HelpRefreshNotice
            message={(catalogQuery.data?.length ?? 0) > 0 && canUseCachedCatalog
              ? 'Os artigos relacionados exibidos podem estar desatualizados.'
              : 'Não foi possível carregar os artigos relacionados.'}
            isRetrying={catalogQuery.isFetching}
            onRetry={() => void catalogQuery.refetch()}
          />
        ) : null}
        <HelpArticleView
          article={articleQuery.data}
          relatedArticles={relatedArticles}
          basePath="/suporte"
          titleHeadingLevel="h2"
        />
      </div>
    </AppLayout>
  )
}
