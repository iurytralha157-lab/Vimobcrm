"use client";

import { useCallback, useSyncExternalStore } from "react";
import Link from "next/link";

import {
  acceptPublicCookieConsent,
  hasPublicCookieConsent,
  subscribePublicCookieConsent,
} from "@/lib/site/public-consent";

type PublicCookieConsentProps = Readonly<{
  organizationId: string;
  primaryColor: string;
  privacyHref: string;
  siteTitle: string;
}>;

export function PublicCookieConsent({ organizationId, primaryColor, privacyHref, siteTitle }: PublicCookieConsentProps) {
  const getConsentSnapshot = useCallback(
    () => !hasPublicCookieConsent(organizationId),
    [organizationId],
  );
  const visible = useSyncExternalStore(
    subscribePublicCookieConsent,
    getConsentSnapshot,
    getServerConsentSnapshot,
  );
  const acceptCookies = useCallback(() => {
    acceptPublicCookieConsent(organizationId);
  }, [organizationId]);

  if (!visible) return null;

  return (
    <div className="fixed inset-x-3 bottom-3 z-[70] mx-auto max-w-xl rounded-[8px] border border-[color-mix(in_srgb,var(--site-card-fg)_10%,transparent)] bg-[var(--site-card)] p-4 text-[var(--site-card-fg)] sm:bottom-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-[12px] font-light leading-5 opacity-80">
          A {siteTitle} usa cookies para melhorar sua experiência no site. Leia a{" "}
          <Link
            href={privacyHref}
            className="rounded-[4px] font-normal underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-[var(--site-primary)]"
            style={{ color: primaryColor }}
          >
            Política de Privacidade
          </Link>
          .
        </p>
        <button
          type="button"
          className="h-10 shrink-0 rounded-[6px] px-5 text-[12px] font-light text-[var(--site-primary-fg)] outline-none transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-[var(--site-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--site-card)]"
          style={{ backgroundColor: primaryColor }}
          onClick={acceptCookies}
        >
          Entendi
        </button>
      </div>
    </div>
  );
}

function getServerConsentSnapshot() {
  return false;
}
