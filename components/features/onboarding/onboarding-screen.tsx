import Image from "next/image";
import { OnboardingForm } from "./onboarding-form";

export default function OnboardingScreen() {
  return (
    <main className="auth-page relative isolate min-h-dvh w-full overflow-x-hidden font-sans text-white lg:h-dvh lg:overflow-hidden">
      <div className="absolute inset-0 z-0 min-h-dvh w-full" aria-hidden="true">
        <div className="relative h-full min-h-dvh w-full">
          <Image
            src="/images/login-hero.webp"
            alt=""
            fill
            priority
            unoptimized
            className="object-cover object-[63%_center] brightness-[0.6] md:object-[68%_center] md:brightness-[0.88]"
            sizes="100vw"
          />
        </div>
      </div>

      <div
        className="auth-hero-overlay absolute inset-0 z-[1] h-full w-full"
        aria-hidden="true"
      />
      <div
        className="auth-hero-vignette absolute inset-0 z-[2] h-full w-full"
        aria-hidden="true"
      />

      <div className="relative z-10 flex min-h-dvh w-full lg:h-full">
        <section className="flex min-h-dvh w-full items-center justify-center overflow-visible px-8 py-16 lg:h-full lg:min-h-0 lg:w-[45%] lg:overflow-y-auto lg:overscroll-contain lg:px-16 xl:w-[42%]">
          <OnboardingForm />
        </section>
      </div>
    </main>
  );
}
