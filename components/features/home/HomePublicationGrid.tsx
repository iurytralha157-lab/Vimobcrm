import Link from 'next/link'
import Image from 'next/image'
import {
  ArrowRight,
  CalendarCheck2,
  CheckCircle2,
  Clock3,
  KanbanSquare,
  MessageCircleMore,
  Sparkles,
  UserRoundPlus,
} from 'lucide-react'

import { Skeleton } from '@/components/ui/skeleton'
import type { HomePublicationCard } from '@/lib/api/home'
import { cn } from '@/lib/utils'

type HomePublicationGridProps = {
  publications: HomePublicationCard[]
  isLoading: boolean
}

function PublicationIcon({ accent }: { accent: HomePublicationCard['accent'] }) {
  if (accent === 'blue') return <CalendarCheck2 className="h-5 w-5" />
  if (accent === 'emerald') return <MessageCircleMore className="h-5 w-5" />
  return <Sparkles className="h-5 w-5" />
}

function PublicationArtwork({ compact }: { compact: boolean }) {

  if (compact) {
    return (
      <div className="pointer-events-none absolute bottom-3 right-3 flex items-end gap-1.5 opacity-75">
        <div className="flex h-11 w-11 items-center justify-center rounded-[6px] bg-primary/50 text-primary-foreground">
          <Sparkles className="h-5 w-5" />
        </div>
        <div className="flex h-8 w-8 items-center justify-center rounded-[6px] bg-[var(--app-surface-soft)] text-[var(--app-text-tertiary)]">
          <CheckCircle2 className="h-4 w-4" />
        </div>
      </div>
    )
  }

  return (
    <div className="pointer-events-none absolute bottom-4 right-4 hidden w-[43%] min-w-[250px] max-w-[390px] sm:block">
      <div className="relative h-[145px]">
        <div className="absolute bottom-3 right-1 w-[72%] rounded-[8px] bg-[var(--app-surface-solid)] p-3">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-[10px] font-light text-[var(--app-text-tertiary)]">Pipeline</span>
            <KanbanSquare className="h-4 w-4 text-[var(--app-text-tertiary)]" />
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {[
              { label: 'Novo', value: '08', icon: UserRoundPlus },
              { label: 'Contato', value: '12', icon: MessageCircleMore },
              { label: 'Agenda', value: '05', icon: CalendarCheck2 },
            ].map((item) => {
              const Icon = item.icon
              return (
                <div key={item.label} className="rounded-[6px] bg-[var(--app-surface-soft)] px-2 py-2">
                  <Icon className="mb-2 h-3.5 w-3.5 text-[var(--app-text-tertiary)]" />
                  <p className="text-[12px] font-normal text-[var(--app-text-primary)]">{item.value}</p>
                  <p className="text-[9px] font-light text-[var(--app-text-tertiary)]">{item.label}</p>
                </div>
              )
            })}
          </div>
        </div>
        <div className="absolute bottom-2 left-2 flex h-14 w-14 items-center justify-center rounded-[6px] bg-primary/50 text-primary-foreground">
          <Clock3 className="h-6 w-6" />
        </div>
      </div>
    </div>
  )
}

function PublicationCard({ publication }: { publication: HomePublicationCard }) {
  const wide = publication.cardSize === 'wide'
  const compact = publication.cardSize === 'compact'
  const hasImage = Boolean(publication.imageUrl)

  return (
    <article
      className={cn(
        'group relative isolate overflow-hidden rounded-[8px] bg-[var(--app-surface-solid)] shadow-none transition-colors hover:bg-[var(--app-surface-hover)]',
        wide && 'col-span-12 min-h-[260px]',
        publication.cardSize === 'half' && 'col-span-12 min-h-[245px] lg:col-span-6',
        compact && 'col-span-12 min-h-[210px] md:col-span-6 lg:col-span-4',
      )}
    >
      {hasImage ? (
        <div className={cn(
          'absolute inset-y-0 right-0 overflow-hidden',
          wide ? 'w-full sm:w-[48%]' : 'w-[58%]',
        )}>
          <Image
            src={publication.imageUrl || ''}
            alt=""
            fill
            sizes={wide ? '(max-width: 640px) 100vw, 520px' : '(max-width: 1024px) 100vw, 420px'}
            className="object-cover"
            unoptimized
          />
          <div className="absolute inset-0 bg-gradient-to-r from-[var(--app-surface-solid)] via-[var(--app-surface-solid)]/65 to-transparent sm:via-[var(--app-surface-solid)]/20" />
          <div className="absolute inset-0 bg-gradient-to-t from-[var(--app-surface-solid)]/65 via-transparent to-transparent" />
        </div>
      ) : (
        <PublicationArtwork compact={compact} />
      )}

      <div className={cn(
        'relative z-10 flex h-full min-h-[inherit] flex-col p-5 sm:p-6',
        wide && 'sm:max-w-[58%]',
        !wide && hasImage && 'max-w-[76%]',
      )}>
        <div className="flex h-10 w-10 items-center justify-center rounded-[6px] bg-primary/50 text-primary-foreground transition-colors group-hover:bg-primary">
          <PublicationIcon accent={publication.accent} />
        </div>
        <h3 className={cn(
          'mt-5 text-balance text-[14px] font-normal leading-5 text-[var(--app-text-primary)]',
        )}>
          {publication.title}
        </h3>
        <p className={cn(
          'mt-2 text-[12px] font-light leading-5 text-[var(--app-text-secondary)]',
          wide && 'max-w-xl',
          compact && 'line-clamp-3',
        )}>
          {publication.body}
        </p>
        {publication.ctaLabel && publication.ctaHref ? (
          <div className="mt-auto pt-5">
            <Link
              href={publication.ctaHref}
              className={cn(
                'inline-flex h-9 items-center gap-2 rounded-[6px] bg-primary/50 px-4 text-[12px] font-light text-primary-foreground shadow-none transition-colors hover:bg-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40',
              )}
            >
              {publication.ctaLabel}
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        ) : null}
      </div>
    </article>
  )
}

function PublicationSkeleton({ wide = false }: { wide?: boolean }) {
  return (
    <div className={cn(
      'col-span-12 min-h-[245px] rounded-[8px] bg-[var(--app-surface-solid)] p-6',
      !wide && 'lg:col-span-6',
    )}>
      <Skeleton className="h-10 w-10 rounded-[6px]" />
      <Skeleton className="mt-5 h-6 w-1/2" />
      <Skeleton className="mt-3 h-4 w-4/5" />
      <Skeleton className="mt-2 h-4 w-2/3" />
      <Skeleton className="mt-8 h-9 w-32 rounded-[6px]" />
    </div>
  )
}

export function HomePublicationGrid({ publications, isLoading }: HomePublicationGridProps) {
  return (
    <section aria-labelledby="home-publications-title">
      <div className="mb-4 flex items-end justify-between gap-4">
        <div>
          <h2 id="home-publications-title" className="text-[14px] font-normal text-[var(--app-text-primary)]">
            Para aproveitar melhor o Vimob
          </h2>
          <p className="mt-1 text-[12px] font-light text-[var(--app-text-secondary)]">
            Acessos rápidos, novidades e orientações para o seu dia.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-3 sm:gap-4">
        {isLoading ? (
          <>
            <PublicationSkeleton wide />
            <PublicationSkeleton />
            <PublicationSkeleton />
          </>
        ) : (
          publications.map((publication) => (
            <PublicationCard key={publication.id} publication={publication} />
          ))
        )}
      </div>
    </section>
  )
}
