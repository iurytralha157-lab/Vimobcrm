"use client";

import { useEffect, useState } from "react";
import {
  LOGIN_HERO_MESSAGE_ENDINGS,
  startLoginHeroMessageAnimation,
} from "@/lib/auth/login-hero-animation";

export function LoginHeroMessage() {
  const [displayedEnding, setDisplayedEnding] = useState<string>(LOGIN_HERO_MESSAGE_ENDINGS[0]);

  useEffect(() => {
    return startLoginHeroMessageAnimation(setDisplayedEnding, window);
  }, []);

  return (
    <h2
      aria-label="O problema não é falta de lead, é falta de controle."
      className="auth-login-hero-title max-w-[620px] text-[clamp(28px,2.6vw,35px)] font-light leading-[1.08] tracking-[-0.025em] text-white"
    >
      <span aria-hidden="true">
        <span className="block whitespace-nowrap">O problema não é falta de lead,</span>
        <span className="block min-h-[1.08em] whitespace-nowrap">
          é falta de {displayedEnding}
          <span className="auth-login-type-cursor ml-[3px] inline-block h-[0.82em] w-px translate-y-[0.05em] bg-current" />
        </span>
      </span>
    </h2>
  );
}
