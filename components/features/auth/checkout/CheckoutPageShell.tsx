import type { ReactNode } from "react";
import { ShieldCheck } from "lucide-react";
import { AuthLogo } from "@/components/features/auth/auth-logo";
import { BRAND_HEADER_LAYOUT } from "@/config/constants";

export function CheckoutPageShell({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <div className="app-shell min-h-screen bg-[var(--app-background)] text-[var(--app-text-primary)]">
      <header className="sticky top-0 z-30 bg-[var(--app-background)]">
        <div
          className="mx-auto flex h-[72px] w-full items-center justify-between px-4 sm:px-6 lg:px-8"
          style={{ maxWidth: BRAND_HEADER_LAYOUT.maxWidth }}
        >
          <div className="inline-flex min-h-11 w-fit items-center">
            <AuthLogo theme="adaptive" width={BRAND_HEADER_LAYOUT.logoWidth} />
          </div>
          <div className="flex h-10 items-center gap-2 rounded-[6px] bg-[var(--app-surface-solid)] px-4 text-xs font-light text-[var(--app-text-secondary)]">
            <ShieldCheck
              className="h-4 w-4 text-primary/70"
              strokeWidth={1.6}
              aria-hidden="true"
            />
            Checkout seguro
          </div>
        </div>
      </header>
      <main
        className="mx-auto w-full px-4 pb-8 pt-5 sm:px-6 sm:pb-10 sm:pt-7 lg:px-8"
        style={{ maxWidth: BRAND_HEADER_LAYOUT.maxWidth }}
      >
        {children}
      </main>
    </div>
  );
}
