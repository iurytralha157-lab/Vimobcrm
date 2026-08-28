'use client'

import {
  AlertCircle,
  BookOpenText,
  Loader2,
  RefreshCw,
  TriangleAlert,
} from 'lucide-react'
import Link from 'next/link'

import { PublicPageShell } from '@/components/features/public'
import { usePublicHelpArticle, usePublicHelpCatalog } from '@/hooks/help'
import { VimobAPIError } from '@/lib/api/vimob-client'

import { HelpArticleView } from './HelpArticleView'
import { HelpPublicQueryProvider } from './HelpPublicQueryProvider'

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

type PublicHelpRefreshNoticeProps = {
  message: string
  isRetrying?: boolean
  onRetry?: () => void
}

function PublicHelpRefreshNotice({
  message,
  isRetrying = false,
  onRetry,
}: PublicHelpRefreshNoticeProps) {
  return (
    <div
      role="status"
      className="flex w-full flex-col gap-3 rounded-[8px] bg-[var(--public-soft)] p-3 shadow-none sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex min-w-0 items-start gap-2">
        <TriangleAlert aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
        <p className="text-[12px] font-light leading-[18px] text-[var(--public-muted)]">
          {message}
        </p>
      </div>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          disabled={isRetrying}
          className="inline-flex min-h-9 shrink-0 items-center justify-center gap-2 rounded-[6px] px-3 text-[12px] font-light text-[var(--public-accent)] transition-colors hover:bg-[var(--public-accent)] hover:text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35 disabled:cursor-wait disabled:opacity-60"
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

function PublicArticleUnavailable() {
  return (
    <div className="mx-auto flex min-h-[45dvh] max-w-xl flex-col items-center justify-center rounded-[8px] bg-[var(--public-surface)] px-6 text-center shadow-none">
      <BookOpenText aria-hidden className="h-6 w-6 text-[var(--public-tertiary)]" />
      <h1 className="mt-4 text-[14px] font-normal text-[var(--public-foreground)]">
        Este artigo não está disponível
      </h1>
      <p className="mt-2 text-[12px] font-light leading-[18px] text-[var(--public-muted)]">
        Volte ao catálogo para encontrar outro guia sobre este assunto.
      </p>
      <Link
        href="/help"
        className="mt-5 inline-flex min-h-10 items-center rounded-[6px] bg-[var(--public-accent)] px-4 text-[12px] font-light text-primary-foreground shadow-none transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35"
      >
        Voltar para a Central
      </Link>
    </div>
  )
}

function PublicHelpArticleContent({ slug }: { slug: string }) {
  const articleQuery = usePublicHelpArticle(slug)
  const catalogQuery = usePublicHelpCatalog()
  const articleNotFound = articleQuery.error instanceof VimobAPIError
    && articleQuery.error.code === 'help_article_not_found'
  const canUseCachedArticle = articleQuery.isRefetchError
    && canUseCachedHelpData(articleQuery.error)
  const relatedSlugs = new Set(articleQuery.data?.relatedSlugs ?? [])
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
    <PublicPageShell>
      <section className="mx-auto w-full max-w-[980px] px-4 py-8 sm:px-6 sm:py-10 lg:px-8 lg:py-12">
        {articleQuery.isLoading && !articleQuery.data ? (
          <div role="status" className="flex min-h-[45dvh] items-center justify-center gap-2 text-[12px] font-light text-[var(--public-muted)]">
            <Loader2 aria-hidden className="h-5 w-5 animate-spin text-[var(--public-accent)]" />
            <span>Carregando artigo...</span>
          </div>
        ) : articleNotFound ? (
          <PublicArticleUnavailable />
        ) : articleQuery.isError && !canUseCachedArticle ? (
          <div role="alert" className="mx-auto flex min-h-[45dvh] max-w-xl flex-col items-center justify-center rounded-[8px] bg-[var(--public-surface)] px-6 text-center shadow-none">
            <span className="grid h-10 w-10 place-items-center rounded-[8px] bg-destructive/10 text-destructive">
              <AlertCircle aria-hidden className="h-5 w-5" />
            </span>
            <h1 className="mt-4 text-[14px] font-normal text-[var(--public-foreground)]">
              Não foi possível carregar este artigo
            </h1>
            <p className="mt-2 text-[12px] font-light leading-[18px] text-[var(--public-muted)]">
              Tente novamente. Se preferir, volte ao catálogo para consultar os outros guias.
            </p>
            <button
              type="button"
              onClick={() => void articleQuery.refetch()}
              disabled={articleQuery.isFetching}
              className="mt-5 inline-flex min-h-10 items-center gap-2 rounded-[6px] bg-[var(--public-accent)] px-4 text-[12px] font-light text-primary-foreground shadow-none transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35 disabled:cursor-wait disabled:opacity-60"
            >
              {articleQuery.isFetching ? (
                <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw aria-hidden className="h-4 w-4" />
              )}
              Tentar novamente
            </button>
          </div>
        ) : articleQuery.data ? (
          <div className="space-y-3">
            {canUseCachedArticle ? (
              <PublicHelpRefreshNotice
                message="Este artigo continua disponível, mas não foi possível confirmar a versão mais recente."
                isRetrying={articleQuery.isFetching}
                onRetry={() => void articleQuery.refetch()}
              />
            ) : null}
            {relatedCatalogIsLoading ? (
              <div role="status" className="flex w-full items-center gap-2 rounded-[8px] bg-[var(--public-soft)] p-3 text-[12px] font-light text-[var(--public-muted)] shadow-none">
                <Loader2 aria-hidden className="h-4 w-4 animate-spin text-[var(--public-accent)]" />
                <span>Carregando artigos relacionados...</span>
              </div>
            ) : relatedCatalogFailed ? (
              <PublicHelpRefreshNotice
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
              basePath="/help"
              publicStyle
            />
          </div>
        ) : (
          <PublicArticleUnavailable />
        )}
      </section>
    </PublicPageShell>
  )
}

export function PublicHelpArticleScreen({ slug }: { slug: string }) {
  return (
    <HelpPublicQueryProvider>
      <PublicHelpArticleContent slug={slug} />
    </HelpPublicQueryProvider>
  )
}
