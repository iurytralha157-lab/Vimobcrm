'use client'

import {
  ArrowRight,
  BookOpenText,
  Loader2,
  RefreshCw,
  Search,
  TriangleAlert,
  X,
} from 'lucide-react'
import Link from 'next/link'
import { useMemo, useRef, useState, type FormEvent } from 'react'

import { cn } from '@/lib/utils'
import type { HelpArticleSummary } from '@/lib/validation'

import { getHelpModule, HELP_MODULES } from './help-modules'

type HelpCatalogContentProps = {
  articles: HelpArticleSummary[]
  basePath: '/help' | '/suporte'
  isLoading?: boolean
  errorMessage?: string | null
  publicStyle?: boolean
  showIntro?: boolean
  onRetry?: () => void
  onSearch?: (query: string) => Promise<HelpArticleSummary[]>
}

function normalizeSearchText(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
}

function filterLocally(articles: HelpArticleSummary[], query: string) {
  const normalizedQuery = normalizeSearchText(query.trim())
  if (!normalizedQuery) return articles
  const terms = normalizedQuery.split(/\s+/).filter(Boolean)
  return articles.filter((article) => {
    const searchable = normalizeSearchText(
      `${article.title} ${article.summary} ${article.category} ${article.moduleKey}`,
    )
    return terms.every((term) => searchable.includes(term))
  })
}

export function HelpCatalogContent({
  articles,
  basePath,
  isLoading = false,
  errorMessage = null,
  publicStyle = false,
  showIntro = true,
  onRetry,
  onSearch,
}: HelpCatalogContentProps) {
  const [query, setQuery] = useState('')
  const [selectedModule, setSelectedModule] = useState<string | null>(null)
  const [serverResults, setServerResults] = useState<HelpArticleSummary[] | null>(null)
  const [isSearching, setIsSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const searchRequestId = useRef(0)

  const moduleCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const article of articles) {
      counts.set(article.moduleKey, (counts.get(article.moduleKey) ?? 0) + 1)
    }
    return counts
  }, [articles])

  const visibleModules = useMemo(() => {
    const known = HELP_MODULES.filter((module) => moduleCounts.has(module.key))
    const knownKeys = new Set(known.map((module) => module.key))
    const unknown = [...moduleCounts.keys()]
      .filter((key) => !knownKeys.has(key))
      .map(getHelpModule)
    return [...known, ...unknown]
  }, [moduleCounts])

  const effectiveSelectedModule = selectedModule
    && visibleModules.some((module) => module.key === selectedModule)
    ? selectedModule
    : null

  const visibleArticles = useMemo(() => {
    const source = serverResults ?? filterLocally(articles, query)
    if (!effectiveSelectedModule) return source
    return source.filter((article) => article.moduleKey === effectiveSelectedModule)
  }, [articles, effectiveSelectedModule, query, serverResults])

  const hasUsableContent = articles.length > 0 || serverResults !== null
  const showInitialLoading = isLoading && !hasUsableContent
  const showBlockingError = Boolean(errorMessage) && !hasUsableContent
  const showStaleWarning = Boolean(errorMessage) && hasUsableContent

  const submitSearch = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const trimmedQuery = query.trim()
    setSearchError(null)

    if (!trimmedQuery) {
      setServerResults(null)
      return
    }
    if (!onSearch || trimmedQuery.length < 2) {
      setServerResults(null)
      return
    }

    const requestId = ++searchRequestId.current
    setIsSearching(true)
    try {
      const results = await onSearch(trimmedQuery)
      if (requestId === searchRequestId.current) setServerResults(results)
    } catch {
      if (requestId === searchRequestId.current) {
        setServerResults(null)
        setSearchError('Não foi possível consultar a busca agora. Os artigos carregados continuam disponíveis.')
      }
    } finally {
      if (requestId === searchRequestId.current) setIsSearching(false)
    }
  }

  const clearSearch = () => {
    searchRequestId.current += 1
    setQuery('')
    setServerResults(null)
    setSearchError(null)
    setIsSearching(false)
  }

  const clearFilters = () => {
    clearSearch()
    setSelectedModule(null)
  }

  const surfaceClass = publicStyle
    ? 'bg-[var(--public-surface)] text-[var(--public-foreground)]'
    : 'bg-[var(--app-surface-solid)] text-[var(--app-text-primary)]'
  const softClass = publicStyle
    ? 'bg-[var(--public-background)]'
    : 'bg-[var(--app-surface-soft)]'
  const mutedClass = publicStyle
    ? 'text-[var(--public-muted)]'
    : 'text-[var(--app-text-secondary)]'
  const tertiaryClass = publicStyle
    ? 'text-[var(--public-tertiary)]'
    : 'text-[var(--app-text-tertiary)]'

  return (
    <div className="space-y-7 sm:space-y-8">
      <section className="mx-auto max-w-3xl text-center">
        {showIntro ? (
          <>
            <p className="text-[11px] font-light text-primary">
              Central de Ajuda
            </p>
            <h2 className={cn(
              'mt-2 text-balance text-[20px] font-normal leading-[1.3]',
              publicStyle ? 'text-[var(--public-foreground)]' : 'text-[var(--app-text-primary)]',
            )}>
              Encontre a resposta e siga o caminho certo.
            </h2>
            <p className={cn('mx-auto mt-2 max-w-2xl text-[12px] font-light leading-[18px]', mutedClass)}>
              Pesquise sua dúvida e veja, passo a passo, como realizar cada ação no Vimob.
            </p>
          </>
        ) : null}

        <form
          role="search"
          onSubmit={submitSearch}
          className={cn(
            'flex min-h-12 items-center gap-2 rounded-[8px] p-1.5 shadow-none transition-colors focus-within:ring-1 focus-within:ring-primary/40',
            showIntro && 'mt-6',
            surfaceClass,
          )}
          aria-busy={isSearching}
        >
          <Search aria-hidden className={cn('ml-2 h-4 w-4 shrink-0', tertiaryClass)} />
          <label htmlFor={`help-search-${basePath.slice(1)}`} className="sr-only">
            Buscar na Central de Ajuda
          </label>
          <input
            id={`help-search-${basePath.slice(1)}`}
            value={query}
            onChange={(event) => {
              searchRequestId.current += 1
              setQuery(event.target.value)
              setServerResults(null)
              setSearchError(null)
              setIsSearching(false)
            }}
            maxLength={500}
            autoComplete="off"
            placeholder="Ex.: automação, WhatsApp ou usuário"
            className={cn(
              'min-w-0 flex-1 bg-transparent px-1 py-3 text-base font-light outline-none placeholder:opacity-100 sm:text-[12px]',
              publicStyle
                ? 'placeholder:text-[var(--public-tertiary)]'
                : 'placeholder:text-[var(--app-text-tertiary)]',
            )}
          />
          {query ? (
            <button
              type="button"
              onClick={clearSearch}
              aria-label="Limpar busca"
              className={cn(
                'flex h-10 w-10 shrink-0 items-center justify-center rounded-[6px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35 sm:h-9 sm:w-9',
                publicStyle
                  ? 'bg-[var(--public-soft)] hover:bg-[var(--public-background)]'
                  : cn(softClass, 'hover:bg-[var(--app-surface-hover)]'),
              )}
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}
          <button
            type="submit"
            aria-label={isSearching ? 'Buscando na Central de Ajuda' : 'Buscar na Central de Ajuda'}
            disabled={!query.trim() || isSearching}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[6px] bg-primary text-primary-foreground shadow-none transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35 disabled:cursor-not-allowed disabled:opacity-40 sm:h-9 sm:w-9"
          >
            {isSearching ? (
              <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
            ) : (
              <ArrowRight aria-hidden className="h-4 w-4" />
            )}
          </button>
        </form>
        {searchError ? (
          <p role="status" className="mt-2 text-left text-[12px] font-light leading-[18px] text-amber-600">
            {searchError}
          </p>
        ) : null}
      </section>

      {showInitialLoading ? (
        <div role="status" className={cn('flex min-h-48 items-center justify-center gap-2 text-[12px] font-light', tertiaryClass)}>
          <Loader2 aria-hidden className="h-5 w-5 animate-spin text-primary" />
          <span>Carregando guias...</span>
        </div>
      ) : showBlockingError ? (
        <section role="alert" className={cn('rounded-[8px] p-6 text-center shadow-none', surfaceClass)}>
          <BookOpenText className={cn('mx-auto h-6 w-6', publicStyle ? tertiaryClass : 'text-primary')} />
          <h2 className="mt-3 text-[14px] font-normal">A Central não carregou agora</h2>
          <p className={cn('mt-2 text-[12px] font-light leading-[18px]', mutedClass)}>
            Tente novamente em instantes. Nenhuma alteração foi feita no seu acesso.
          </p>
          {onRetry ? (
            <button
              type="button"
              onClick={onRetry}
              className="mx-auto mt-5 inline-flex min-h-10 items-center gap-2 rounded-[6px] bg-primary px-4 text-[12px] font-light text-primary-foreground shadow-none transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35"
            >
              <RefreshCw className="h-4 w-4" />
              Tentar novamente
            </button>
          ) : null}
        </section>
      ) : (
        <>
          {showStaleWarning ? (
            <div
              role="status"
              className={cn(
                'flex flex-col gap-3 rounded-[8px] p-3 shadow-none sm:flex-row sm:items-center sm:justify-between',
                publicStyle ? 'bg-[var(--public-soft)]' : 'bg-[var(--app-surface-soft)]',
              )}
            >
              <div className="flex min-w-0 items-start gap-2">
                <TriangleAlert aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                <p className={cn('text-[12px] font-light leading-[18px]', mutedClass)}>
                  Os guias exibidos continuam disponíveis, mas não foi possível confirmar a versão mais recente.
                </p>
              </div>
              {onRetry ? (
                <button
                  type="button"
                  onClick={onRetry}
                  className="inline-flex min-h-9 shrink-0 items-center justify-center gap-2 rounded-[6px] px-3 text-[12px] font-light text-primary transition-colors hover:bg-primary hover:text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35"
                >
                  <RefreshCw aria-hidden className="h-4 w-4" />
                  Atualizar
                </button>
              ) : null}
            </div>
          ) : null}

          {visibleModules.length > 0 ? (
            <section aria-labelledby="help-modules-title">
              <div className="flex items-end justify-between gap-4">
                <div>
                  <h2
                    id="help-modules-title"
                    className={cn(
                      'text-[14px] font-normal',
                      publicStyle ? 'text-[var(--public-foreground)]' : 'text-[var(--app-text-primary)]',
                    )}
                  >
                    Escolha um assunto
                  </h2>
                </div>
                {effectiveSelectedModule ? (
                  <button
                    type="button"
                    onClick={() => setSelectedModule(null)}
                    className="inline-flex min-h-10 items-center rounded-[6px] px-2 text-[12px] font-light text-primary transition-colors hover:bg-primary hover:text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35"
                  >
                    Ver todos
                  </button>
                ) : null}
              </div>

              <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {visibleModules.map((module) => {
                  const Icon = module.icon
                  const active = effectiveSelectedModule === module.key
                  return (
                    <button
                      key={module.key}
                      type="button"
                      aria-pressed={active}
                      aria-controls="help-article-results"
                      onClick={() => setSelectedModule(active ? null : module.key)}
                      className={cn(
                        'group flex min-h-[76px] w-full cursor-pointer items-center gap-3 rounded-[8px] p-3 text-left shadow-none transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30',
                        active
                          ? 'bg-primary text-primary-foreground'
                          : cn(surfaceClass, 'hover:bg-primary hover:text-primary-foreground'),
                      )}>
                      <span className={cn(
                        'flex h-9 w-9 shrink-0 items-center justify-center rounded-[6px] transition-colors',
                        active
                          ? 'bg-primary-foreground/15 text-primary-foreground'
                          : 'bg-primary/50 text-primary-foreground group-hover:bg-primary-foreground/15 group-active:bg-primary-foreground/15 group-focus-visible:bg-primary-foreground/15',
                      )}>
                        <Icon className="h-4 w-4" />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-[12px] font-normal leading-[18px]">{module.label}</span>
                        <span className={cn(
                          'mt-0.5 block text-[11px] leading-4',
                          active
                            ? 'text-primary-foreground/80'
                            : cn(mutedClass, 'group-hover:text-primary-foreground/80'),
                        )}>
                          {moduleCounts.get(module.key) ?? 0}{' '}
                          {(moduleCounts.get(module.key) ?? 0) === 1 ? 'guia' : 'guias'}
                        </span>
                      </span>
                    </button>
                  )
                })}
              </div>
            </section>
          ) : null}

          <section id="help-article-results" aria-labelledby="help-results-title">
            <div className="flex items-end justify-between gap-4">
              <div>
                <h2
                  id="help-results-title"
                  aria-live="polite"
                  className={cn(
                    'text-[14px] font-normal',
                    publicStyle ? 'text-[var(--public-foreground)]' : 'text-[var(--app-text-primary)]',
                  )}
                >
                  {query
                    ? `${visibleArticles.length} ${visibleArticles.length === 1 ? 'resposta encontrada' : 'respostas encontradas'}`
                    : effectiveSelectedModule
                      ? getHelpModule(effectiveSelectedModule).label
                      : 'Todos os artigos'}
                </h2>
              </div>
            </div>

            {visibleArticles.length > 0 ? (
              <div className={cn('mt-4 overflow-hidden rounded-[8px] shadow-none', surfaceClass)}>
                <div className={cn(
                  'divide-y',
                  publicStyle ? 'divide-[var(--public-border)]' : 'divide-[var(--app-border)]',
                )}>
                  {visibleArticles.map((article) => {
                    const moduleMeta = getHelpModule(article.moduleKey)
                    const Icon = moduleMeta.icon
                    return (
                      <Link
                        key={article.id}
                        href={`${basePath}/${encodeURIComponent(article.slug)}`}
                        className="group grid grid-cols-[36px_minmax(0,1fr)_32px] items-center gap-3 px-3 py-3 transition-colors hover:bg-primary hover:text-primary-foreground focus-visible:bg-primary focus-visible:text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/30 sm:grid-cols-[40px_minmax(0,1fr)_36px] sm:px-4 sm:py-3.5"
                      >
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[6px] bg-primary/50 text-primary-foreground transition-colors group-hover:bg-primary-foreground/15 group-active:bg-primary-foreground/15 group-focus-visible:bg-primary-foreground/15 sm:h-10 sm:w-10">
                          <Icon className="h-4 w-4" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className={cn(
                            'text-[11px] font-light leading-4',
                            mutedClass,
                            'group-hover:text-primary-foreground/75',
                            'group-focus-visible:text-primary-foreground/75',
                          )}>
                            {article.category} · {article.estimatedMinutes} min
                          </span>
                          <span className="mt-0.5 block break-words text-[12px] font-normal leading-[18px]">
                            {article.title}
                          </span>
                          <span className={cn(
                            'mt-0.5 line-clamp-2 block text-[12px] font-light leading-[18px]',
                            mutedClass,
                            'group-hover:text-primary-foreground/80',
                            'group-focus-visible:text-primary-foreground/80',
                          )}>
                            {article.summary}
                          </span>
                        </span>
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] bg-primary/50 text-primary-foreground transition-colors group-hover:bg-primary-foreground/15 group-active:bg-primary-foreground/15 group-focus-visible:bg-primary-foreground/15 sm:h-9 sm:w-9">
                          <ArrowRight className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                        </span>
                      </Link>
                    )
                  })}
                </div>
              </div>
            ) : (
              <div className={cn('mt-5 rounded-[8px] p-8 text-center shadow-none', surfaceClass)}>
                <Search className={cn('mx-auto h-5 w-5', tertiaryClass)} />
                <h3 className="mt-3 text-[14px] font-normal">Nenhum guia encontrado</h3>
                <p className={cn('mt-1 text-[12px] font-light leading-[18px]', mutedClass)}>
                  Tente uma palavra mais direta, como lead, WhatsApp, agenda ou automação.
                </p>
                {query || effectiveSelectedModule ? (
                  <button
                    type="button"
                    onClick={clearFilters}
                    className="mx-auto mt-4 inline-flex min-h-9 items-center rounded-[6px] px-3 text-[12px] font-light text-primary transition-colors hover:bg-primary hover:text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35"
                  >
                    Limpar busca e filtros
                  </button>
                ) : null}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  )
}
