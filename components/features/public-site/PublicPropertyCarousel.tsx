"use client";

/* eslint-disable @next/next/no-img-element */

import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Images, X } from "lucide-react";

import { DEFAULT_HERO_IMAGE, normalizePublicImageUrl } from "./public-site-utils";

type PublicPropertyCarouselProps = Readonly<{
  backgroundColor: string;
  images: string[];
  title: string;
}>;

export function PublicPropertyCarousel({ backgroundColor, images, title }: PublicPropertyCarouselProps) {
  const gallery = useMemo(() => {
    const uniqueImages = Array.from(new Set(images.map((image) => normalizePublicImageUrl(image)).filter(Boolean)));
    return uniqueImages.length > 0 ? uniqueImages : [DEFAULT_HERO_IMAGE];
  }, [images]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [isGalleryOpen, setIsGalleryOpen] = useState(false);
  const galleryTitleId = useId();
  const galleryDialogRef = useRef<HTMLDivElement>(null);
  const galleryTriggerRef = useRef<HTMLButtonElement>(null);
  const hasMultipleImages = gallery.length > 1;
  const normalizedActiveIndex = activeIndex % gallery.length;
  const visibleGallery = useMemo(() => {
    return gallery.map((_, offset) => gallery[(normalizedActiveIndex + offset) % gallery.length] || DEFAULT_HERO_IMAGE);
  }, [gallery, normalizedActiveIndex]);

  useEffect(() => {
    if (!isGalleryOpen) return;

    const previousOverflow = document.body.style.overflow;
    const trigger = galleryTriggerRef.current;
    document.body.style.overflow = "hidden";
    requestAnimationFrame(() => galleryDialogRef.current?.focus());

    return () => {
      document.body.style.overflow = previousOverflow;
      trigger?.focus();
    };
  }, [isGalleryOpen]);

  function goToPrevious() {
    setActiveIndex((current) => {
      const normalized = current % gallery.length;
      return normalized === 0 ? gallery.length - 1 : normalized - 1;
    });
  }

  function goToNext() {
    setActiveIndex((current) => (current + 1) % gallery.length);
  }

  function selectImage(index: number) {
    if (index === normalizedActiveIndex) return;
    setActiveIndex(index);
  }

  function closeGallery() {
    setIsGalleryOpen(false);
  }

  function handleGalleryKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeGallery();
      return;
    }
    if (event.key !== "Tab") return;

    const focusable = galleryDialogRef.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
    );
    if (!focusable?.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const activeElement = document.activeElement;
    if (activeElement === galleryDialogRef.current || !galleryDialogRef.current?.contains(activeElement)) {
      event.preventDefault();
      (event.shiftKey ? last : first)?.focus();
    } else if (event.shiftKey && activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  }

  return (
    <section className="relative overflow-hidden text-[var(--site-on-dark)]" style={{ backgroundColor }} aria-label={`Galeria de fotos de ${title}`}>
      <div className="relative h-[430px] w-full overflow-hidden sm:h-[520px] lg:h-[560px]">
        <div className="flex h-full gap-1">
          {visibleGallery.map((image, offset) => {
            const realIndex = (normalizedActiveIndex + offset) % gallery.length;
            return (
              <button
                key={`${image}-${realIndex}-${offset}`}
                type="button"
                onClick={() => selectImage(realIndex)}
                className={`h-full shrink-0 cursor-pointer overflow-hidden ${
                  gallery.length === 1
                    ? "basis-full"
                    : gallery.length === 2
                      ? "basis-[calc(50%_-_2px)]"
                      : "basis-[clamp(270px,27vw,430px)]"
                }`}
                style={{ backgroundColor }}
                aria-label={`Abrir foto ${realIndex + 1}`}
              >
                <img
                  src={image}
                  alt={offset === 0 ? `Foto ${realIndex + 1} de ${title}` : ""}
                  className="h-full w-full object-cover opacity-95 hover:opacity-100"
                  decoding="async"
                  fetchPriority={offset === 0 ? "high" : "auto"}
                  loading={offset <= 2 ? "eager" : "lazy"}
                />
              </button>
            );
          })}
        </div>
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[var(--site-overlay-soft)] via-transparent to-[var(--site-overlay-soft)]" />

        {hasMultipleImages ? (
          <>
            <button
              type="button"
              onClick={goToPrevious}
              className="absolute left-3 top-1/2 inline-flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-[var(--site-inverse)] text-[var(--site-inverse-fg)] outline-none hover:bg-[var(--site-inverse-hover)] focus-visible:ring-2 focus-visible:ring-[var(--site-on-dark)] sm:left-5 sm:h-12 sm:w-12"
              aria-label="Foto anterior"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={goToNext}
              className="absolute right-3 top-1/2 inline-flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-[var(--site-inverse)] text-[var(--site-inverse-fg)] outline-none hover:bg-[var(--site-inverse-hover)] focus-visible:ring-2 focus-visible:ring-[var(--site-on-dark)] sm:right-5 sm:h-12 sm:w-12"
              aria-label="Próxima foto"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          </>
        ) : null}

        <div className="absolute bottom-3 left-3 inline-flex h-9 items-center gap-2 rounded-full bg-[var(--site-overlay)] px-4 text-[12px] font-light sm:bottom-5 sm:left-1/2 sm:-translate-x-1/2">
          <Images className="h-4 w-4" />
          {normalizedActiveIndex + 1} / {gallery.length}
        </div>

        {hasMultipleImages ? (
          <button
            ref={galleryTriggerRef}
            type="button"
            onClick={() => setIsGalleryOpen(true)}
            className="absolute bottom-3 right-3 inline-flex h-10 items-center gap-2 rounded-[6px] bg-[var(--site-inverse)] px-3 text-[12px] font-light text-[var(--site-inverse-fg)] outline-none hover:bg-[var(--site-inverse-hover)] focus-visible:ring-2 focus-visible:ring-[var(--site-on-dark)] sm:bottom-5 sm:right-5 sm:px-4"
            aria-expanded={isGalleryOpen}
            aria-haspopup="dialog"
          >
            <Images className="h-4 w-4" />
            Ver todas
          </button>
        ) : null}
      </div>

      {isGalleryOpen ? (
        <div
          ref={galleryDialogRef}
          aria-labelledby={galleryTitleId}
          aria-modal="true"
          className="fixed inset-0 z-[80] overflow-y-auto bg-[var(--site-overlay-strong)] px-4 py-5 text-[var(--site-on-dark)] outline-none"
          onKeyDown={handleGalleryKeyDown}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeGallery();
          }}
          role="dialog"
          tabIndex={-1}
        >
          <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-4">
            <div>
              <p className="text-[12px] font-light text-[var(--site-on-dark-muted)]">Galeria</p>
              <h2 className="text-[14px] font-normal" id={galleryTitleId}>{title}</h2>
            </div>
            <button
              type="button"
              onClick={closeGallery}
              className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-[var(--site-on-dark-soft)] text-[var(--site-on-dark)] outline-none hover:bg-[var(--site-on-dark-soft-hover)] focus-visible:ring-2 focus-visible:ring-[var(--site-on-dark)]"
              aria-label="Fechar galeria"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="mx-auto mt-5 grid w-full max-w-7xl gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {gallery.map((image, index) => (
              <button
                key={`${image}-gallery-${index}`}
                type="button"
                onClick={() => {
                  selectImage(index);
                  closeGallery();
                }}
                className="relative h-72 overflow-hidden rounded-[8px] bg-[var(--site-overlay-strong)] text-left outline-none focus-visible:ring-2 focus-visible:ring-[var(--site-on-dark)] sm:h-80"
              >
                <img src={image} alt={`Foto ${index + 1} de ${title}`} className="h-full w-full object-cover" loading="lazy" />
                <span className="absolute bottom-3 left-3 rounded-full bg-[var(--site-overlay)] px-3 py-1 text-[12px] font-light">
                  {index + 1} / {gallery.length}
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
