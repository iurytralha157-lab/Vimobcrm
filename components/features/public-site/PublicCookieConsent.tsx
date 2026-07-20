"use client";

import { useCallback, useSyncExternalStore } from "react";
import Link from "next/link";

type PublicCookieConsentProps = Readonly<{
  primaryColor: string;
  privacyHref: string;
  siteTitle: string;
}>;

export const PUBLIC_COOKIE_CONSENT_KEY = "vimob_public_cookie_consent_v1";
export const PUBLIC_COOKIE_CONSENT_EVENT = "vimob:cookie-consent-changed";

export function PublicCookieConsent({ primaryColor, privacyHref, siteTitle }: PublicCookieConsentProps) {
  const visible = useSyncExternalStore(subscribeConsent, getConsentSnapshot, getServerConsentSnapshot);
  const acceptCookies = useCallback(() => {
    window.localStorage.setItem(PUBLIC_COOKIE_CONSENT_KEY, "accepted");
    window.dispatchEvent(new Event(PUBLIC_COOKIE_CONSENT_EVENT));
  }, []);

  if (!visible) return null;

  return (
    <div className="fixed inset-x-3 bottom-3 z-[70] mx-auto max-w-xl rounded-[10px] border border-white/10 bg-[var(--site-card)] p-4 text-[var(--site-fg)] sm:bottom-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm font-light leading-6 opacity-78">
          A {siteTitle} usa cookies para melhorar sua experiência no site. Leia a{" "}
          <Link href={privacyHref} className="font-normal underline underline-offset-4" style={{ color: primaryColor }}>
            Política de Privacidade
          </Link>
          .
        </p>
        <button
          type="button"
          className="h-10 shrink-0 rounded-[10px] px-5 text-sm font-light text-white transition hover:brightness-110"
          style={{ backgroundColor: primaryColor }}
          onClick={acceptCookies}
        >
          Entendi
        </button>
      </div>
    </div>
  );
}

function subscribeConsent(onStoreChange: () => void) {
  window.addEventListener(PUBLIC_COOKIE_CONSENT_EVENT, onStoreChange);
  window.addEventListener("storage", onStoreChange);
  return () => {
    window.removeEventListener(PUBLIC_COOKIE_CONSENT_EVENT, onStoreChange);
    window.removeEventListener("storage", onStoreChange);
  };
}

function getConsentSnapshot() {
  return window.localStorage.getItem(PUBLIC_COOKIE_CONSENT_KEY) !== "accepted";
}

function getServerConsentSnapshot() {
  return false;
}
