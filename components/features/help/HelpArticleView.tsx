import {
  ArrowLeft,
  ArrowRight,
  BookOpenText,
  CalendarCheck2,
  Clock3,
} from 'lucide-react'
import Link from 'next/link'

import { cn } from '@/lib/utils'
import type { HelpArticle, HelpArticleSummary } from '@/lib/validation'

import { AnnotatedScreenshot } from './AnnotatedScreenshot'
import { getHelpModule } from './help-modules'

type HelpArticleViewProps = {
  article: HelpArticle
  basePath: '/help' | '/suporte'
  relatedArticles?: HelpArticleSummary[]
  publicStyle?: boolean
  titleHeadingLevel?: 'h1' | 'h2'
}

function formatReviewedAt(value?: string | null) {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return new Intl.DateTimeFormat('pt-BR', {
    month: 'long',
    year: 'numeric',
  }).format(date)
}

function getSafeInternalHref(value?: string | null) {
  if (!value) return null
  const href = value.trim()
  if (
    !href.startsWith('/')
    || href.startsWith('//')
    || href.includes('\\')
    || /[\u0000-\u001f\u007f]/.test(href)
  ) {
    return null
  }
  return href
}

export function HelpArticleView({
  article,
  basePath,
  relatedArticles = [],
  publicStyle = false,
  titleHeadingLevel = 'h1',
}: HelpArticleViewProps) {
  const moduleMeta = getHelpModule(article.moduleKey)
  const ModuleIcon = moduleMeta.icon
  const TitleHeading = titleHeadingLevel
  const reviewedAt = formatReviewedAt(article.lastReviewedAt)
  const articleActionHref = getSafeInternalHref(article.routeHref)
  const surfaceClass = publicStyle
    ? 'bg-[var(--public-surface)] text-[var(--public-foreground)] shadow-none'
    : 'bg-[var(--app-surface-solid)] text-[var(--app-text-primary)] shadow-none'
  const mutedClass = publicStyle
    ? 'text-[var(--public-muted)]'
    : 'text-[var(--app-text-secondary)]'
  const tertiaryClass = publicStyle
    ? 'text-[var(--public-tertiary)]'
    : 'text-[var(--app-text-tertiary)]'
  const accentTextClass = publicStyle
    ? 'text-[var(--public-accent)]'
    : 'text-primary'
  const accentBackgroundClass = publicStyle
    ? 'bg-[var(--public-accent)]'
    : 'bg-primary'

  return (
    <article className="mx-auto w-full max-w-6xl">
      <Link
        href={basePath}
        className={cn(
          'inline-flex min-h-10 items-center gap-2 rounded-[6px] px-2 text-[12px] font-light transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35',
          publicStyle
            ? 'hover:bg-[var(--public-soft)] hover:text-[var(--public-accent)]'
            : 'hover:bg-[var(--app-surface-hover)] hover:text-primary',
          mutedClass,
        )}
      >
        <ArrowLeft className="h-4 w-4" />
        Voltar para a Central de Ajuda
      </Link>

      <header className="mt-7 max-w-4xl">
        <div className={cn('flex items-center gap-2 text-[11px] font-light', accentTextClass)}>
          <ModuleIcon
            className={cn(
              'h-4 w-4',
              publicStyle && 'text-[var(--public-tertiary)]',
            )}
          />
          {article.category}
        </div>
        <TitleHeading className={cn(
          'mt-3 break-words text-balance text-[20px] font-normal leading-[1.3]',
          publicStyle ? 'text-[var(--public-foreground)]' : 'text-[var(--app-text-primary)]',
        )}>
          {article.title}
        </TitleHeading>
        <p className={cn('mt-2 max-w-3xl break-words text-[12px] font-light leading-[18px]', mutedClass)}>
          {article.summary}
        </p>
        <div className={cn('mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-[12px] font-light', mutedClass)}>
          <span className="inline-flex items-center gap-1.5">
            <Clock3 className="h-4 w-4" />
            {article.estimatedMinutes} min de leitura
          </span>
          {reviewedAt ? (
            <span className="inline-flex items-center gap-1.5">
              <CalendarCheck2 className="h-4 w-4" />
              Revisado em {reviewedAt}
            </span>
          ) : null}
        </div>
        {articleActionHref && article.actionLabel ? (
          <Link
            href={articleActionHref}
            className={cn(
              'mt-5 inline-flex min-h-10 items-center gap-2 rounded-[6px] px-4 text-[12px] font-light text-primary-foreground shadow-none transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35',
              accentBackgroundClass,
            )}
          >
            {article.actionLabel}
            <ArrowRight aria-hidden className="h-4 w-4" />
          </Link>
        ) : null}
      </header>

      <div className={cn(
        'mt-8 grid gap-6 lg:items-start',
        article.steps.length > 0 && 'lg:grid-cols-[minmax(0,1fr)_250px]',
      )}>
        <div className="min-w-0 space-y-6">
          {article.steps.length > 0 ? (
            <details className={cn('rounded-[8px] p-4 lg:hidden', surfaceClass)}>
              <summary className="flex min-h-10 cursor-pointer items-center rounded-[6px] text-[14px] font-normal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35">
                Ver etapas deste artigo
              </summary>
              <nav aria-label="Passos deste artigo no celular" className="mt-3">
                <ol className="space-y-1">
                  {article.steps.map((step, index) => (
                    <li key={`mobile-toc-${step.id}`}>
                      <a
                        href={`#passo-${index + 1}`}
                        className={cn(
                          'flex min-h-10 items-center rounded-[6px] px-3 py-2 text-[12px] font-light leading-[18px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35',
                          publicStyle
                            ? 'hover:bg-[var(--public-accent)] hover:text-primary-foreground'
                            : 'hover:bg-primary hover:text-primary-foreground',
                          mutedClass,
                        )}
                      >
                        {index + 1}. {step.title}
                      </a>
                    </li>
                  ))}
                </ol>
              </nav>
            </details>
          ) : null}

          <section className={cn('rounded-[8px] p-5 sm:p-6', surfaceClass)}>
            <div className="flex items-start gap-3">
              <span
                aria-hidden
                className={cn('mt-0.5 h-6 w-1 shrink-0 rounded-full', accentBackgroundClass)}
              />
              <h2 className="text-[14px] font-normal">Antes de começar</h2>
            </div>
            <p className={cn('mt-3 break-words whitespace-pre-line text-[12px] font-light leading-[18px]', mutedClass)}>
              {article.content}
            </p>
          </section>

          {article.steps.length > 0 ? (
            <section aria-labelledby="article-steps-title">
              <h2
                id="article-steps-title"
                className={cn(
                  'text-[14px] font-normal',
                  publicStyle ? 'text-[var(--public-foreground)]' : 'text-[var(--app-text-primary)]',
                )}
              >
                Passo a passo
              </h2>
              <ol className="mt-4 space-y-3">
                {article.steps.map((step, index) => {
                  const stepActionHref = getSafeInternalHref(step.actionHref)
                  return (
                    <li
                      key={step.id}
                      id={`passo-${index + 1}`}
                      className={cn('scroll-mt-24 rounded-[8px] p-5 sm:p-6', surfaceClass)}
                    >
                      <div className="flex items-start gap-3 sm:gap-4">
                        <span className={cn(
                          'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[12px] font-normal text-primary-foreground',
                          accentBackgroundClass,
                        )}>
                          {index + 1}
                        </span>
                        <div className="min-w-0 flex-1">
                          <h3 className="break-words text-[14px] font-normal">{step.title}</h3>
                          <p className={cn('mt-2 break-words whitespace-pre-line text-[12px] font-light leading-[18px]', mutedClass)}>
                            {step.body}
                          </p>
                          {stepActionHref && step.actionLabel ? (
                            <Link
                              href={stepActionHref}
                              className={cn(
                                'mt-3 inline-flex min-h-10 items-center gap-2 rounded-[6px] px-2 text-[12px] font-light transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35',
                                publicStyle
                                  ? 'text-[var(--public-accent)] hover:bg-[var(--public-soft)]'
                                  : 'text-primary hover:bg-[var(--app-surface-hover)]',
                              )}
                            >
                              {step.actionLabel}
                              <ArrowRight className="h-4 w-4" />
                            </Link>
                          ) : null}
                          <AnnotatedScreenshot
                            imageUrl={step.imageUrl}
                            imageAlt={step.imageAlt}
                            imageCaption={step.imageCaption}
                            annotations={step.annotations}
                            publicStyle={publicStyle}
                          />
                        </div>
                      </div>
                    </li>
                  )
                })}
              </ol>
            </section>
          ) : null}

          {relatedArticles.length > 0 ? (
            <section aria-labelledby="related-articles-title">
              <h2
                id="related-articles-title"
                className={cn(
                  'text-[14px] font-normal',
                  publicStyle ? 'text-[var(--public-foreground)]' : 'text-[var(--app-text-primary)]',
                )}
              >
                Continue por aqui
              </h2>
              <div className={cn('mt-4 divide-y overflow-hidden rounded-[8px]', surfaceClass)}>
                {relatedArticles.map((related) => (
                  <Link
                    key={related.id}
                    href={`${basePath}/${encodeURIComponent(related.slug)}`}
                    className={cn(
                      'group flex items-center justify-between gap-4 p-4 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/35',
                      publicStyle
                        ? 'hover:bg-[var(--public-accent)] hover:text-primary-foreground focus-visible:bg-[var(--public-accent)] focus-visible:text-primary-foreground'
                        : 'hover:bg-primary hover:text-primary-foreground focus-visible:bg-primary focus-visible:text-primary-foreground',
                    )}
                  >
                    <span className="min-w-0">
                      <span className={cn(
                        'block truncate text-[11px] font-light',
                        mutedClass,
                        'group-hover:text-primary-foreground/75 group-focus-visible:text-primary-foreground/75',
                      )}>
                        {related.category}
                      </span>
                      <span className="mt-1 block break-words text-[12px] font-normal leading-[18px]">{related.title}</span>
                    </span>
                    <ArrowRight className="h-4 w-4 shrink-0" />
                  </Link>
                ))}
              </div>
            </section>
          ) : null}
        </div>

        {article.steps.length > 0 ? (
          <aside className={cn('hidden rounded-[8px] p-5 lg:sticky lg:top-24 lg:block', surfaceClass)}>
            <div className="flex items-center gap-2 text-[14px] font-normal">
              <BookOpenText
                className={cn(
                  'h-4 w-4',
                  publicStyle ? tertiaryClass : accentTextClass,
                )}
              />
              Neste artigo
            </div>
            <nav aria-label="Passos deste artigo" className="mt-4">
              <ol className="space-y-1">
                {article.steps.map((step, index) => (
                  <li key={`toc-${step.id}`}>
                    <a
                      href={`#passo-${index + 1}`}
                      className={cn(
                        'block rounded-[6px] px-3 py-2 text-[12px] font-light leading-[18px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35',
                        publicStyle
                          ? 'hover:bg-[var(--public-accent)] hover:text-primary-foreground'
                          : 'hover:bg-primary hover:text-primary-foreground',
                        mutedClass,
                      )}
                    >
                      {index + 1}. {step.title}
                    </a>
                  </li>
                ))}
              </ol>
            </nav>
          </aside>
        ) : null}
      </div>
    </article>
  )
}
