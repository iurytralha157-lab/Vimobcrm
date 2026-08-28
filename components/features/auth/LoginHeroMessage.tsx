"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

const MESSAGE_ENDINGS = [
  "controle.",
  "organização.",
  "acompanhamento.",
  "processo.",
] as const;

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function subscribeToReducedMotion(onStoreChange: () => void) {
  const mediaQuery = window.matchMedia(REDUCED_MOTION_QUERY);
  mediaQuery.addEventListener("change", onStoreChange);

  return () => mediaQuery.removeEventListener("change", onStoreChange);
}

function getReducedMotionSnapshot() {
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

function getReducedMotionServerSnapshot() {
  return true;
}

export function LoginHeroMessage() {
  const prefersReducedMotion = useSyncExternalStore(
    subscribeToReducedMotion,
    getReducedMotionSnapshot,
    getReducedMotionServerSnapshot,
  );
  const [wordIndex, setWordIndex] = useState(0);
  const [displayedEnding, setDisplayedEnding] = useState<string>(MESSAGE_ENDINGS[0]);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    if (prefersReducedMotion) return;

    const currentEnding = MESSAGE_ENDINGS[wordIndex];
    let delay = 72;
    let nextStep: () => void;

    if (isDeleting && displayedEnding.length > 0) {
      delay = 42;
      nextStep = () => setDisplayedEnding((current) => current.slice(0, -1));
    } else if (isDeleting) {
      delay = 240;
      nextStep = () => {
        setWordIndex((current) => (current + 1) % MESSAGE_ENDINGS.length);
        setIsDeleting(false);
      };
    } else if (displayedEnding === currentEnding) {
      delay = 2100;
      nextStep = () => setIsDeleting(true);
    } else {
      nextStep = () => {
        setDisplayedEnding((current) => currentEnding.slice(0, current.length + 1));
      };
    }

    const timer = window.setTimeout(nextStep, delay);
    return () => window.clearTimeout(timer);
  }, [displayedEnding, isDeleting, prefersReducedMotion, wordIndex]);

  const visibleEnding = prefersReducedMotion ? MESSAGE_ENDINGS[0] : displayedEnding;

  return (
    <h2
      aria-label="O problema não é falta de lead, é falta de controle."
      className="auth-login-hero-title max-w-[620px] text-[clamp(28px,2.6vw,35px)] font-light leading-[1.08] tracking-[-0.025em] text-white"
    >
      <span aria-hidden="true">
        <span className="block whitespace-nowrap">O problema não é falta de lead,</span>
        <span className="block min-h-[1.08em] whitespace-nowrap">
          é falta de {visibleEnding}
          <span className="auth-login-type-cursor ml-[3px] inline-block h-[0.82em] w-px translate-y-[0.05em] bg-current" />
        </span>
      </span>
    </h2>
  );
}
