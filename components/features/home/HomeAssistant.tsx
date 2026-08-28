'use client'

import {
  ArrowUp,
  BookOpenText,
  ContactRound,
  Loader2,
  Search,
  TriangleAlert,
  X,
} from 'lucide-react'
import Link from 'next/link'
import { useRef, useState, type FormEvent } from 'react'

import { Button } from '@/components/ui/button'
import {
  useHomeSearch,
  type HomeSearchResult,
} from '@/hooks/home'

import type { HomeQuickAction } from './home-catalog'

type HomeAssistantProps = {
  firstName: string
  quickActions: HomeQuickAction[]
}

function normalizeSearchText(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
}

export function HomeAssistant({ firstName, quickActions }: HomeAssistantProps) {
  const [question, setQuestion] = useState('')
  const [displayResults, setDisplayResults] = useState<HomeSearchResult | null>(null)
  const [searchFailed, setSearchFailed] = useState(false)
  const searchRequestId = useRef(0)
  const search = useHomeSearch()
  const normalizedQuestion = normalizeSearchText(question.trim())
  const searchTerms = normalizedQuestion.split(/\s+/).filter((term) => term.length >= 3)
  const visibleQuickActions = normalizedQuestion
    ? quickActions.filter((action) => {
        const actionText = normalizeSearchText(`${action.label} ${action.description}`)
        return actionText.includes(normalizedQuestion)
          || searchTerms.some((term) => actionText.includes(term))
      })
    : quickActions

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const query = question.trim()
    if (query.length < 2 || search.isPending) return

    const requestId = ++searchRequestId.current
    try {
      const results = await search.mutateAsync(query)
      if (requestId === searchRequestId.current) {
        setDisplayResults(results)
        setSearchFailed(false)
      }
    } catch {
      if (requestId === searchRequestId.current) {
        setDisplayResults(null)
        setSearchFailed(true)
      }
    }
  }

  const clearAnswer = () => {
    searchRequestId.current += 1
    setDisplayResults(null)
    setSearchFailed(false)
    search.reset()
  }

  const hasResults = Boolean(
    displayResults
    && (displayResults.articles.length > 0 || displayResults.leads.length > 0),
  )

  return (
    <section className="flex min-h-[clamp(390px,58dvh,500px)] items-center px-0 py-6 sm:py-8 lg:min-h-[clamp(460px,54dvh,560px)]">
      <div className="mx-auto w-full max-w-3xl text-center">
        <h1 className="px-2 text-balance !text-[20px] font-normal leading-[1.25] text-[var(--app-text-primary)] sm:px-0">
          Olá, {firstName}. O que você quer fazer hoje?
        </h1>
        <p className="mx-auto mt-2 max-w-2xl px-3 text-[12px] leading-[18px] text-[var(--app-text-tertiary)] sm:px-0">
          Encontre respostas, guias e informações para o seu dia a dia.
        </p>

        <form
          onSubmit={handleSubmit}
          className="relative mt-5 rounded-[8px] border-0 bg-[var(--app-surface-solid)] p-1.5 text-left shadow-none transition-colors focus-within:ring-1 focus-within:ring-primary/40 sm:mt-6 sm:p-2"
        >
          <label htmlFor="home-assistant-question" className="sr-only">
            Pesquise no Vimob
          </label>
          <div className="flex items-start gap-2 px-2 pt-2">
            <Search
              className="mt-1 h-5 w-5 shrink-0 text-[var(--app-text-tertiary)]"
              strokeWidth={1.7}
            />
            <textarea
              id="home-assistant-question"
              value={question}
              onChange={(event) => {
                searchRequestId.current += 1
                setQuestion(event.target.value)
                setDisplayResults(null)
                setSearchFailed(false)
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  event.currentTarget.form?.requestSubmit()
                }
              }}
              rows={3}
              maxLength={500}
              placeholder="Ex.: criar automação, conectar WhatsApp ou buscar Maria"
              className="min-h-[68px] min-w-0 flex-1 resize-none bg-transparent py-0.5 text-[12px] leading-5 text-[var(--app-text-primary)] outline-none placeholder:text-[var(--app-text-tertiary)] sm:min-h-[76px]"
            />
            <Button
              type="submit"
              size="icon"
              aria-label="Pesquisar"
              disabled={question.trim().length < 2 || search.isPending}
              className="mt-auto h-9 w-9 shrink-0 rounded-[6px] border-0 bg-primary text-primary-foreground shadow-none hover:bg-primary/90 sm:h-10 sm:w-10"
            >
              {search.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ArrowUp className="h-4 w-4" strokeWidth={2} />
              )}
            </Button>
          </div>
          <div className="flex items-center justify-end px-3 pb-1 pt-2 text-[11px] text-[var(--app-text-tertiary)]">
            <span>{question.length}/500</span>
          </div>
        </form>

        {displayResults || searchFailed ? (
          <div
            aria-live="polite"
            className="relative mt-3 rounded-[8px] border-0 bg-[var(--app-surface-solid)] p-4 text-left shadow-none"
          >
            <button
              type="button"
              onClick={clearAnswer}
              className="absolute right-3 top-3 rounded-[6px] p-1.5 text-[var(--app-text-tertiary)] transition-colors hover:bg-[var(--app-surface-hover)] hover:text-[var(--app-text-primary)]"
              aria-label="Fechar resultados"
            >
              <X className="h-4 w-4" />
            </button>

            {searchFailed ? (
              <div className="flex items-start gap-3 pr-8">
                <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] bg-[var(--app-surface-soft)] text-amber-600">
                  <TriangleAlert className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-[14px] font-normal text-[var(--app-text-primary)]">
                    A pesquisa não respondeu agora
                  </p>
                  <p className="mt-1 text-[12px] font-light leading-5 text-[var(--app-text-secondary)]">
                    Tente novamente em instantes ou abra a Central de Ajuda.
                  </p>
                  <Link
                    href="/suporte"
                    className="mt-3 inline-flex text-[12px] font-light text-primary transition-colors hover:text-primary/80"
                  >
                    Abrir Central de Ajuda
                  </Link>
                </div>
              </div>
            ) : hasResults && displayResults ? (
              <div className="space-y-4 pr-8">
                {displayResults.articles.length > 0 ? (
                  <section aria-labelledby="home-help-results">
                    <div className="flex items-center gap-2">
                      <BookOpenText className="h-4 w-4 text-primary" />
                      <p
                        id="home-help-results"
                        className="text-[12px] font-light text-[var(--app-text-tertiary)]"
                      >
                        Guias da Central
                      </p>
                    </div>
                    <div className="mt-2 space-y-1">
                      {displayResults.articles.slice(0, 3).map((article, index) => (
                        <Link
                          key={article.id}
                          href={`/suporte/${article.slug}`}
                          className="group block rounded-[6px] bg-[var(--app-surface-soft)] px-3 py-2.5 transition-colors hover:bg-primary hover:text-primary-foreground"
                        >
                          <span className="block text-[12px] font-normal leading-5">
                            {article.title}
                          </span>
                          {index === 0 ? (
                            <span className="mt-1 line-clamp-2 block text-xs leading-5 text-[var(--app-text-secondary)] group-hover:text-primary-foreground/80">
                              {article.summary}
                            </span>
                          ) : null}
                        </Link>
                      ))}
                    </div>
                  </section>
                ) : null}

                {displayResults.leads.length > 0 ? (
                  <section aria-labelledby="home-lead-results">
                    <div className="flex items-center gap-2">
                      <ContactRound className="h-4 w-4 text-primary" />
                      <p
                        id="home-lead-results"
                        className="text-[12px] font-light text-[var(--app-text-tertiary)]"
                      >
                        Leads que você pode visualizar
                      </p>
                    </div>
                    <div className="mt-2 grid gap-1 sm:grid-cols-2">
                      {displayResults.leads.slice(0, 4).map((lead) => {
                        const context = [
                          lead.stageName,
                          lead.assigneeName ? `Resp. ${lead.assigneeName}` : null,
                        ].filter(Boolean).join(' · ')
                        const contact = lead.phone || lead.email

                        return (
                          <Link
                            key={lead.id}
                            href={lead.href}
                            className="rounded-[6px] bg-[var(--app-surface-soft)] px-3 py-2.5 transition-colors hover:bg-primary hover:text-primary-foreground"
                          >
                            <span className="block truncate text-[12px] font-normal">
                              {lead.name}
                            </span>
                            {context || contact ? (
                              <span className="mt-1 block truncate text-xs opacity-70">
                                {context || contact}
                              </span>
                            ) : null}
                          </Link>
                        )
                      })}
                    </div>
                  </section>
                ) : null}

                {displayResults.partial ? (
                  <p className="text-[11px] leading-5 text-amber-600">
                    Uma das fontes não respondeu; os resultados disponíveis continuam válidos.
                  </p>
                ) : null}
              </div>
            ) : (
              <div className="flex items-start gap-3 pr-8">
                <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] bg-[var(--app-surface-soft)] text-[var(--app-text-secondary)]">
                  <Search className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-[14px] font-normal text-[var(--app-text-primary)]">
                    Nenhum resultado exato
                  </p>
                  <p className="mt-1 text-[12px] font-light leading-5 text-[var(--app-text-secondary)]">
                    Tente nome, telefone ou e-mail do lead, ou uma ação como “criar automação”.
                  </p>
                  <Link
                    href="/suporte"
                    className="mt-3 inline-flex text-[12px] font-light text-primary transition-colors hover:text-primary/80"
                  >
                    Explorar todos os guias
                  </Link>
                </div>
              </div>
            )}
          </div>
        ) : null}

        <div className="mt-3 flex flex-wrap justify-center gap-1.5 sm:mt-4 sm:gap-2">
          {visibleQuickActions.map((action) => {
            const Icon = action.icon
            return (
              <Link
                key={action.href}
                href={action.href}
                title={action.description}
                className="inline-flex h-8 items-center gap-1.5 rounded-[6px] border-0 bg-[var(--app-surface-solid)] px-3 text-[11px] font-light text-[var(--app-text-secondary)] shadow-none transition-colors hover:bg-primary hover:text-primary-foreground focus-visible:bg-primary focus-visible:text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35 sm:h-9 sm:gap-2 sm:px-3.5 sm:text-xs"
              >
                <Icon className="h-3.5 w-3.5" strokeWidth={1.8} />
                {action.label}
              </Link>
            )
          })}
        </div>
      </div>
    </section>
  )
}
