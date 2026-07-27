import Image from "next/image";

export function AuthShell({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <main className="auth-page relative isolate min-h-dvh w-full overflow-x-hidden font-sans text-white">
      <div className="absolute inset-0 z-0 min-h-full w-full" aria-hidden="true">
        <div className="relative h-full min-h-dvh w-full">
          <Image
            src="/images/login-hero.webp"
            alt=""
            fill
            preload
            sizes="100vw"
            className="object-cover object-[63%_center] brightness-[0.6] md:object-[68%_center] md:brightness-[0.88]"
          />
        </div>
      </div>

      <div
        className="auth-hero-overlay absolute inset-0 z-[1] min-h-full w-full"
        aria-hidden="true"
      />
      <div
        className="auth-hero-vignette absolute inset-0 z-[2] min-h-full w-full"
        aria-hidden="true"
      />

      <div className="relative z-10 flex min-h-dvh w-full">
        <section
          aria-label="Acesso ao Vimob CRM"
          className="flex min-h-dvh w-full items-center justify-center px-6 py-10 sm:px-8 sm:py-12 lg:max-h-dvh lg:w-[45%] lg:overflow-y-auto lg:overscroll-contain lg:px-16 lg:py-16 xl:w-[42%]"
        >
          {children}
        </section>
      </div>
    </main>
  );
}
