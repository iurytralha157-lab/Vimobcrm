import type { ReactNode } from "react";
import Image from "next/image";
import { AuthLogo } from "./auth-logo";
import { LoginHeroMedia } from "./LoginHeroMedia";
import { LoginHeroMessage } from "./LoginHeroMessage";

type AuthSplitLayoutProps = Readonly<{
  children: ReactNode;
  contentLabel: string;
  footer?: ReactNode;
  heroMedia?: "image" | "video";
  pageClassName?: string;
}>;

export function AuthSplitLayout({
  children,
  contentLabel,
  footer,
  heroMedia = "image",
  pageClassName = "",
}: AuthSplitLayoutProps) {
  return (
    <main
      className={`auth-page auth-login-page min-h-dvh w-full overflow-y-auto bg-[var(--app-background)] text-[var(--app-text-primary)] lg:h-dvh lg:overflow-hidden lg:p-3 ${pageClassName}`}
    >
      <div className="grid min-h-dvh w-full lg:h-full lg:min-h-0 lg:grid-cols-[minmax(400px,42%)_minmax(0,1fr)] lg:gap-3">
        <section
          aria-label={contentLabel}
          className="flex min-h-dvh w-full flex-col px-5 py-6 sm:px-10 sm:py-8 lg:min-h-0 lg:overflow-y-auto lg:px-0 lg:py-6"
        >
          <div className="w-full shrink-0 lg:px-6">
            <div className="w-fit">
              <AuthLogo theme="adaptive" width={85} />
            </div>
          </div>

          <div className="flex w-full flex-1 items-center justify-center py-6 lg:px-8 lg:py-4 xl:px-[clamp(3rem,6vw,5.5rem)]">
            {children}
          </div>

          {footer ? <div className="w-full shrink-0">{footer}</div> : null}
        </section>

        <aside
          aria-label="Vimob crm para sua imobiliária"
          className="relative hidden min-h-0 overflow-hidden rounded-[16px] bg-[var(--auth-hero-background)] lg:block"
        >
          {heroMedia === "video" ? (
            <LoginHeroMedia />
          ) : (
            <Image
              src="/images/login-red-fold-v2.png"
              alt="Composição abstrata em vermelho e preto"
              fill
              sizes="(min-width: 1024px) 58vw, 1px"
              loading="eager"
              className="object-cover object-center"
            />
          )}
          <div
            className="absolute inset-0 bg-[linear-gradient(180deg,rgba(8,8,8,0.05)_28%,rgba(8,8,8,0.82)_100%)]"
            aria-hidden="true"
          />

          <div className="absolute inset-x-0 bottom-0 z-10 p-8 xl:p-10 2xl:p-12">
            <p className="mb-3 text-[12px] font-light text-white/62">
              A solução completa para sua imobiliária
            </p>
            <LoginHeroMessage />
          </div>
        </aside>
      </div>
    </main>
  );
}
