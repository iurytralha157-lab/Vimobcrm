"use client";

import Image from "next/image";
import { LoginForm } from "./login-form";

export default function LoginScreen() {
  return (
    <div
      className="auth-page auth-page-dark relative h-dvh max-h-dvh w-full overflow-hidden font-sans"
    >
      <div className="absolute inset-0 z-0 h-full w-full" aria-hidden="true">
        <div className="relative h-full w-full">
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

      <div className="relative z-10 flex h-full w-full">
        <section className="flex w-full items-center justify-center px-8 py-16 lg:w-[45%] lg:px-16 xl:w-[42%]">
          <LoginForm />
        </section>
      </div>
    </div>
  );
}
