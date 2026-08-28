'use client'

import { ImageOff, Loader2 } from 'lucide-react'
import { useCallback, useState } from 'react'

import type { HelpArticleStep } from '@/lib/validation'
import { cn } from '@/lib/utils'

type AnnotatedScreenshotProps = Pick<
  HelpArticleStep,
  'annotations' | 'imageAlt' | 'imageCaption' | 'imageUrl'
> & {
  publicStyle?: boolean
}

export function AnnotatedScreenshot({
  annotations = [],
  imageAlt,
  imageCaption,
  imageUrl,
  publicStyle = false,
}: AnnotatedScreenshotProps) {
  const [failedImageUrl, setFailedImageUrl] = useState<string | null>(null)
  const [loadedImageUrl, setLoadedImageUrl] = useState<string | null>(null)
  const safeImageUrl = imageUrl?.trim() ?? ''
  const handleImageRef = useCallback((image: HTMLImageElement | null) => {
    if (!image?.complete) return
    if (image.naturalWidth > 0) {
      setLoadedImageUrl(safeImageUrl)
    } else {
      setFailedImageUrl(safeImageUrl)
    }
  }, [safeImageUrl])

  if (!imageUrl || !imageAlt) return null

  const isSafeImageUrl = (
    (safeImageUrl.startsWith('/help/') || safeImageUrl.startsWith('/images/help/'))
    && !safeImageUrl.includes('\\')
    && !/[\u0000-\u001f\u007f]/.test(safeImageUrl)
  )
  const imageFailed = !isSafeImageUrl || failedImageUrl === safeImageUrl
  const imageLoaded = loadedImageUrl === safeImageUrl
  const accentBackgroundClass = publicStyle
    ? 'bg-[var(--public-accent)]'
    : 'bg-primary'
  const markerRingClass = publicStyle
    ? 'ring-[var(--public-surface)]'
    : 'ring-[var(--app-surface-solid)]'
  const mutedClass = publicStyle
    ? 'text-[var(--public-muted)]'
    : 'text-[var(--app-text-secondary)]'

  return (
    <figure className="mt-5">
      <div
        className={cn(
          'relative min-h-32 overflow-hidden rounded-[8px] shadow-none',
          publicStyle
            ? 'bg-[var(--public-soft)]'
            : 'bg-[var(--app-surface-soft)]',
        )}
      >
        {imageFailed ? (
          <div
            role="img"
            aria-label={`${imageAlt}. Captura indisponível.`}
            className={cn('flex min-h-32 flex-col items-center justify-center gap-2 p-5 text-center', mutedClass)}
          >
            <ImageOff aria-hidden className="h-5 w-5" />
            <span className="text-[12px] font-light leading-[18px]">
              Esta captura não está disponível agora.
            </span>
          </div>
        ) : (
          <>
            {!imageLoaded ? (
              <div
                role="status"
                className={cn('absolute inset-0 flex items-center justify-center gap-2 text-[12px] font-light', mutedClass)}
              >
                <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
                <span>Carregando captura...</span>
              </div>
            ) : null}
            {/* A captura fica local no produto; os marcadores usam coordenadas percentuais e escalam no mobile. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              ref={handleImageRef}
              src={safeImageUrl}
              alt={imageAlt}
              className={cn('block h-auto w-full', !imageLoaded && 'opacity-0')}
              loading="lazy"
              onLoad={() => setLoadedImageUrl(safeImageUrl)}
              onError={() => setFailedImageUrl(safeImageUrl)}
            />
            {imageLoaded ? annotations.map((annotation, index) => (
              <span
                key={`${annotation.label}-${annotation.x}-${annotation.y}-${index}`}
                className={cn(
                  'absolute flex h-7 w-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full text-[11px] font-normal text-primary-foreground ring-4',
                  accentBackgroundClass,
                  markerRingClass,
                )}
                style={{ left: `${annotation.x}%`, top: `${annotation.y}%` }}
                title={annotation.title}
                aria-label={annotation.title
                  ? `${annotation.label}: ${annotation.title}`
                  : `Marcador ${annotation.label}`}
              >
                {annotation.label}
              </span>
            )) : null}
          </>
        )}
      </div>
      {imageCaption ? (
        <figcaption
          className={cn(
            'mt-2 text-[12px] font-light leading-[18px]',
            mutedClass,
          )}
        >
          {imageCaption}
        </figcaption>
      ) : null}
      {annotations.some((annotation) => annotation.title) ? (
        <ol className="mt-3 grid gap-2 sm:grid-cols-2">
          {annotations.map((annotation) => (
            <li
              key={`legend-${annotation.label}-${annotation.x}-${annotation.y}`}
              className={cn(
                'flex items-start gap-2 text-[12px] font-light leading-[18px]',
                mutedClass,
              )}
            >
              <span className={cn(
                'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-normal text-primary-foreground',
                accentBackgroundClass,
              )}>
                {annotation.label}
              </span>
              <span>{annotation.title ?? `Marcador ${annotation.label}`}</span>
            </li>
          ))}
        </ol>
      ) : null}
    </figure>
  )
}
