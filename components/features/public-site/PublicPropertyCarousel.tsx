"use client";

/* eslint-disable @next/next/no-img-element */

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Images, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { DEFAULT_HERO_IMAGE } from "./public-site-utils";

type PublicPropertyCarouselProps = Readonly<{
  backgroundColor: string;
  images: string[];
  title: string;
}>;

type GalleryDirection = "next" | "previous";

export function PublicPropertyCarousel({ backgroundColor, images, title }: PublicPropertyCarouselProps) {
  const gallery = useMemo(() => {
    const uniqueImages = Array.from(new Set(images.filter(Boolean)));
    return uniqueImages.length > 0 ? uniqueImages : [DEFAULT_HERO_IMAGE];
  }, [images]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [slideDirection, setSlideDirection] = useState<GalleryDirection>("next");
  const [isGalleryOpen, setIsGalleryOpen] = useState(false);
  const hasMultipleImages = gallery.length > 1;
  const visibleGallery = useMemo(() => {
    return gallery.map((_, offset) => gallery[(activeIndex + offset) % gallery.length] || DEFAULT_HERO_IMAGE);
  }, [activeIndex, gallery]);

  function goToPrevious() {
    setSlideDirection("previous");
    setActiveIndex((current) => (current === 0 ? gallery.length - 1 : current - 1));
  }

  function goToNext() {
    setSlideDirection("next");
    setActiveIndex((current) => (current + 1) % gallery.length);
  }

  function selectImage(index: number) {
    if (index === activeIndex) return;
    setSlideDirection(index > activeIndex ? "next" : "previous");
    setActiveIndex(index);
  }

  return (
    <section className="relative overflow-hidden text-white" style={{ backgroundColor }}>
      <div className="relative h-[430px] w-full overflow-hidden sm:h-[520px] lg:h-[560px]">
        <div
          key={activeIndex}
          className={cn(
            "public-site-gallery-strip flex h-full gap-1 will-change-transform",
            slideDirection === "previous" && "public-site-gallery-strip--previous",
          )}
        >
          {visibleGallery.map((image, offset) => {
            const realIndex = (activeIndex + offset) % gallery.length;
            return (
              <button
                key={`${image}-${realIndex}-${offset}`}
                type="button"
                onClick={() => selectImage(realIndex)}
                className="h-full shrink-0 basis-[clamp(270px,27vw,430px)] cursor-pointer overflow-hidden"
                style={{ backgroundColor }}
                aria-label={`Abrir foto ${realIndex + 1}`}
              >
                <img
                  src={image}
                  alt={offset === 0 ? title : ""}
                  className="public-site-carousel-img h-full w-full object-cover opacity-95 transition-[opacity,transform] duration-500 ease-out hover:scale-[1.015] hover:opacity-100"
                  decoding="async"
                  fetchPriority={offset === 0 ? "high" : "auto"}
                  loading={offset <= 2 ? "eager" : "lazy"}
                />
              </button>
            );
          })}
        </div>
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/16 via-transparent to-black/10" />

        {hasMultipleImages ? (
          <>
            <button
              type="button"
              onClick={goToPrevious}
              className="absolute left-5 top-1/2 inline-flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-white/92 text-zinc-900 transition hover:bg-white"
              aria-label="Foto anterior"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={goToNext}
              className="absolute right-5 top-1/2 inline-flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-white/92 text-zinc-900 transition hover:bg-white"
              aria-label="Proxima foto"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          </>
        ) : null}

        <div className="absolute bottom-5 left-1/2 inline-flex h-9 -translate-x-1/2 items-center gap-2 rounded-full bg-black/62 px-4 text-sm font-semibold backdrop-blur">
          <Images className="h-4 w-4" />
          {activeIndex + 1} / {gallery.length}
        </div>

        {hasMultipleImages ? (
          <button
            type="button"
            onClick={() => setIsGalleryOpen(true)}
            className="absolute bottom-5 right-5 inline-flex h-10 items-center gap-2 rounded-full bg-white/94 px-4 text-sm font-semibold text-zinc-900 transition hover:bg-white"
          >
            <Images className="h-4 w-4" />
            Ver todas
          </button>
        ) : null}
      </div>

      {isGalleryOpen ? (
        <div className="fixed inset-0 z-[80] overflow-y-auto bg-black/94 px-4 py-5 text-white backdrop-blur">
          <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-white/62">Galeria</p>
              <h2 className="text-xl font-semibold">{title}</h2>
            </div>
            <button
              type="button"
              onClick={() => setIsGalleryOpen(false)}
              className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/16"
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
                  setIsGalleryOpen(false);
                }}
                className="group relative h-72 overflow-hidden rounded-[14px] bg-zinc-900 text-left sm:h-80"
              >
                <img src={image} alt="" className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]" loading="lazy" />
                <span className="absolute bottom-3 left-3 rounded-full bg-black/62 px-3 py-1 text-xs font-semibold">
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
