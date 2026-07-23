import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight } from "lucide-react";

import { cn } from "@/lib/utils";

export function VimobPublicLogo({ className }: Readonly<{ className?: string }>) {
  return (
    <span className={cn("inline-flex items-center", className)}>
      <Image
        src="/images/logo-black.png"
        alt="Vimob"
        width={170}
        height={60}
        priority
        className="h-10 w-auto"
      />
    </span>
  );
}

export function PublicPageShell({
  children,
  legalDocument = false,
  plainBackground = false,
}: Readonly<{
  children: ReactNode;
  legalDocument?: boolean;
  plainBackground?: boolean;
}>) {
  return (
    <div
      className={cn(
        "public-light min-h-dvh font-sans",
        plainBackground && "public-light-plain"
      )}
    >
      <header className="sticky top-0 z-30 bg-white/86 backdrop-blur-xl">
        <div className="mx-auto flex h-20 w-full max-w-6xl items-center justify-between px-5 sm:px-8">
          <Link href="/help" aria-label="Vimob" className="shrink-0">
            <VimobPublicLogo />
          </Link>

          <Link
            href="/login"
            className={cn(
              "inline-flex h-10 items-center gap-2 bg-[var(--public-accent)] px-4 text-sm font-medium text-white transition hover:bg-[#e63b23]",
              legalDocument ? "rounded-[10px]" : "rounded-full"
            )}
          >
            Entrar
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </header>

      <main>{children}</main>

      <footer className="bg-white">
        <div
          className={cn(
            "mx-auto flex w-full max-w-6xl flex-col px-5 text-sm text-[var(--public-muted)] sm:px-8",
            legalDocument
              ? "items-center justify-center gap-3 py-7 text-center"
              : "gap-5 py-8 md:flex-row md:items-center md:justify-between"
          )}
        >
          <VimobPublicLogo className="[&_img]:h-8" />
          <p>© 2026 Vimob. Todos os direitos reservados.</p>
        </div>
      </footer>
    </div>
  );
}

export function PublicHero({
  backgroundImage,
  children,
  compact = false,
  description,
  eyebrow,
  meta,
  title,
}: Readonly<{
  backgroundImage?: string;
  children?: ReactNode;
  compact?: boolean;
  description?: string;
  eyebrow: string;
  meta?: string;
  title: string;
}>) {
  return (
    <section
      className={cn(
        "overflow-hidden",
        backgroundImage ? "bg-cover bg-center" : "border-b border-[var(--public-border)]"
      )}
      style={
        backgroundImage
          ? {
              backgroundImage: `linear-gradient(180deg, rgba(0,0,0,0.18) 0%, rgba(0,0,0,0.12) 48%, rgba(0,0,0,0.34) 100%), url(${backgroundImage})`,
            }
          : undefined
      }
    >
      <div
        className={cn(
          "mx-auto flex w-full max-w-6xl flex-col items-center px-5 text-center sm:px-8",
          compact ? "py-9 sm:py-10 lg:py-12" : "py-16 lg:py-20",
          backgroundImage && (
            compact
              ? "min-h-[190px] justify-center sm:min-h-[210px]"
              : "min-h-[230px] justify-center"
          )
        )}
      >
        <p
          className={cn(
            "text-xs font-semibold uppercase tracking-[0.22em]",
            backgroundImage ? "text-white/75" : "text-[var(--public-accent)]"
          )}
        >
          {eyebrow}
        </p>
        <h1
          className={cn(
            "max-w-4xl font-semibold tracking-normal",
            backgroundImage ? "text-white" : "text-[var(--public-foreground)]",
            compact
              ? "mt-3 text-[34px] leading-[1.08] sm:text-5xl"
              : "mt-5 text-4xl sm:text-5xl lg:text-6xl"
          )}
        >
          {title}
        </h1>
        {description ? (
          <p
            className={cn(
              "mt-5 max-w-2xl text-base leading-7 sm:text-lg",
              backgroundImage ? "text-white/80" : "text-[var(--public-muted)]"
            )}
          >
            {description}
          </p>
        ) : null}
        {meta ? (
          <p
            className={cn(
              "text-xs font-medium uppercase tracking-[0.18em]",
              compact ? "mt-3" : "mt-4",
              backgroundImage ? "text-white/75" : "text-[var(--public-muted)]"
            )}
          >
            {meta}
          </p>
        ) : null}
        {children ? <div className="mt-8 w-full max-w-2xl">{children}</div> : null}
      </div>
    </section>
  );
}
