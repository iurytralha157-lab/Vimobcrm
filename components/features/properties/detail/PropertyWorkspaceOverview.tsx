'use client'

import { useEffect, useRef, useState } from 'react'
import Image from 'next/image'
import { Building2, Camera, ChevronLeft, ChevronRight } from 'lucide-react'

import { cn } from '@/lib/utils'

/** Gallery of the property file: large photo, arrows and a scrollable thumbnail strip. */
export function PropertyGallery({
  images,
  title,
  onViewAll,
}: {
  images: string[]
  title: string
  onViewAll?: () => void
}) {
  const [activeIndex, setActiveIndex] = useState(0)
  const thumbnailButtons = useRef<Array<HTMLButtonElement | null>>([])
  const safeIndex = images.length === 0 ? 0 : Math.min(activeIndex, images.length - 1)
  const activeImage = images[safeIndex]

  useEffect(() => {
    thumbnailButtons.current[safeIndex]?.scrollIntoView({
      behavior: 'auto',
      block: 'nearest',
      inline: 'nearest',
    })
  }, [safeIndex])

  function showPreviousImage() {
    setActiveIndex((current) => {
      const boundedIndex = Math.min(Math.max(current, 0), images.length - 1)
      return (boundedIndex - 1 + images.length) % images.length
    })
  }

  function showNextImage() {
    setActiveIndex((current) => {
      const boundedIndex = Math.min(Math.max(current, 0), images.length - 1)
      return (boundedIndex + 1) % images.length
    })
  }

  return (
    <section aria-label="Galeria do imóvel" className="min-w-0 space-y-2 rounded-[12px] bg-[var(--app-surface-solid)] p-3 sm:p-4">
      <div className="relative aspect-[16/10] overflow-hidden rounded-[8px] bg-[var(--app-surface-soft)]">
        {activeImage ? (
          <Image
            src={activeImage}
            alt={`${title} — foto ${safeIndex + 1}`}
            fill
            loading="eager"
            sizes="(max-width: 1024px) 100vw, 60vw"
            className="object-cover"
            unoptimized
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-[var(--app-text-tertiary)]">
            <Building2 className="h-8 w-8 opacity-50" aria-hidden="true" />
            <span className="text-[12px] font-light">Imagem não cadastrada</span>
          </div>
        )}
        {onViewAll && (
          <button
            type="button"
            onClick={onViewAll}
            className="absolute bottom-3 left-3 inline-flex h-7 items-center gap-1.5 rounded-[6px] bg-[var(--app-surface-solid)] px-2 text-[12px] font-light text-[var(--app-text-primary)] hover:bg-[var(--app-surface-hover)]"
          >
            <Camera className="h-3.5 w-3.5" aria-hidden="true" />
            Ver todas
          </button>
        )}
        {images.length > 0 && (
          <span className="absolute bottom-3 right-3 rounded-[4px] bg-[var(--app-surface-solid)] px-2 py-1 text-[11px] font-light text-[var(--app-text-primary)]">
            {safeIndex + 1} / {images.length}
          </span>
        )}
        {images.length > 1 && (
          <>
            <button
              type="button"
              aria-label="Foto anterior"
              onClick={showPreviousImage}
              className="absolute left-3 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-[6px] border-0 bg-[var(--app-surface-solid)] text-[var(--app-text-primary)] shadow-none transition-colors hover:bg-[var(--app-surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <ChevronLeft aria-hidden="true" className="h-4 w-4" />
            </button>
            <button
              type="button"
              aria-label="Próxima foto"
              onClick={showNextImage}
              className="absolute right-3 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-[6px] border-0 bg-[var(--app-surface-solid)] text-[var(--app-text-primary)] shadow-none transition-colors hover:bg-[var(--app-surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <ChevronRight aria-hidden="true" className="h-4 w-4" />
            </button>
          </>
        )}
      </div>

      {images.length > 1 && (
        <div
          className="flex max-w-full gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          aria-label="Miniaturas do imóvel"
        >
          {images.map((image, index) => (
            <button
              key={`${image}-${index}`}
              ref={(node) => {
                thumbnailButtons.current[index] = node
              }}
              type="button"
              aria-label={`Ver foto ${index + 1} de ${images.length}`}
              aria-pressed={safeIndex === index}
              onClick={() => setActiveIndex(index)}
              className={cn(
                'relative aspect-[2/1] w-[88px] shrink-0 overflow-hidden rounded-[6px] border-2 bg-[var(--app-surface-soft)] transition-colors sm:w-[116px]',
                safeIndex === index ? 'border-primary' : 'border-transparent hover:border-primary/35',
              )}
            >
              <Image
                src={image}
                alt=""
                fill
                loading={safeIndex === index ? 'eager' : 'lazy'}
                sizes="116px"
                className="object-cover"
                unoptimized
              />
            </button>
          ))}
        </div>
      )}
    </section>
  )
}
