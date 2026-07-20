"use client";

import { useEffect, useSyncExternalStore } from "react";

import {
  PUBLIC_COOKIE_CONSENT_EVENT,
  PUBLIC_COOKIE_CONSENT_KEY,
} from "./PublicCookieConsent";

type PublicTrackingScriptsProps = Readonly<{
  bodyScripts?: string | null;
  googleAdsId?: string | null;
  googleAnalyticsId?: string | null;
  gtmId?: string | null;
  headScripts?: string | null;
  metaPixelId?: string | null;
}>;

export function PublicTrackingScripts({
  bodyScripts,
  googleAdsId,
  googleAnalyticsId,
  gtmId,
  headScripts,
  metaPixelId,
}: PublicTrackingScriptsProps) {
  const consentAccepted = useSyncExternalStore(
    subscribeToConsent,
    getConsentSnapshot,
    getServerConsentSnapshot,
  );

  useEffect(() => {
    if (!consentAccepted) return;

    const injectedNodes: Node[] = [];
    const customScripts = `${headScripts || ""}\n${bodyScripts || ""}`;
    const normalizedGtmId = normalizeTrackingId(gtmId, /^GTM-[A-Z0-9]+$/i);
    const normalizedMetaPixelId = normalizeTrackingId(metaPixelId, /^\d{5,30}$/);
    const normalizedGoogleAdsId = normalizeTrackingId(googleAdsId, /^AW-\d+$/i);
    const normalizedAnalyticsId = normalizeTrackingId(
      googleAnalyticsId,
      /^(?:G-[A-Z0-9]+|UA-\d+-\d+)$/i,
    );

    if (normalizedGtmId && !customScripts.includes(normalizedGtmId)) {
      injectedNodes.push(
        ...injectMarkup(
          document.head,
          `<script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${normalizedGtmId}');</script>`,
        ),
        ...injectMarkup(
          document.body,
          `<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=${normalizedGtmId}" height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>`,
        ),
      );
    }

    if (normalizedMetaPixelId && !customScripts.includes(normalizedMetaPixelId)) {
      injectedNodes.push(
        ...injectMarkup(
          document.head,
          `<script>!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=true;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=true;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${normalizedMetaPixelId}');fbq('track','PageView');</script>`,
        ),
      );
    }

    const gtagIds = [normalizedAnalyticsId, normalizedGoogleAdsId].filter(
      (id): id is string => Boolean(id) && !customScripts.includes(id || ""),
    );
    if (gtagIds.length > 0) {
      const configurations = gtagIds.map((id) => `gtag('config','${id}');`).join("");
      injectedNodes.push(
        ...injectMarkup(
          document.head,
          `<script async src="https://www.googletagmanager.com/gtag/js?id=${gtagIds[0]}"></script><script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('js',new Date());${configurations}</script>`,
        ),
      );
    }

    injectedNodes.push(
      ...injectMarkup(document.head, headScripts),
      ...injectMarkup(document.body, bodyScripts),
    );

    return () => injectedNodes.forEach((node) => node.parentNode?.removeChild(node));
  }, [
    bodyScripts,
    consentAccepted,
    googleAdsId,
    googleAnalyticsId,
    gtmId,
    headScripts,
    metaPixelId,
  ]);

  return null;
}

function subscribeToConsent(onStoreChange: () => void) {
  window.addEventListener(PUBLIC_COOKIE_CONSENT_EVENT, onStoreChange);
  window.addEventListener("storage", onStoreChange);
  return () => {
    window.removeEventListener(PUBLIC_COOKIE_CONSENT_EVENT, onStoreChange);
    window.removeEventListener("storage", onStoreChange);
  };
}

function getConsentSnapshot() {
  return window.localStorage.getItem(PUBLIC_COOKIE_CONSENT_KEY) === "accepted";
}

function getServerConsentSnapshot() {
  return false;
}

function normalizeTrackingId(value: string | null | undefined, pattern: RegExp) {
  const normalized = value?.trim() || "";
  return pattern.test(normalized) ? normalized : null;
}

function injectMarkup(target: HTMLElement, markup?: string | null) {
  if (!markup?.trim()) return [];

  const template = document.createElement("template");
  template.innerHTML = markup;
  const nodes: Node[] = [];

  Array.from(template.content.childNodes).forEach((sourceNode) => {
    const node = cloneExecutableNode(sourceNode);
    if (!node) return;
    target.appendChild(node);
    nodes.push(node);
  });

  return nodes;
}

function cloneExecutableNode(sourceNode: Node): Node | null {
  if (!(sourceNode instanceof HTMLScriptElement)) {
    return sourceNode.cloneNode(true);
  }

  const source = sourceNode.textContent || "";
  const gtmId = source.match(/GTM-[A-Z0-9]+/i)?.[0];
  if (
    gtmId &&
    document.querySelector(
      `script[src*="googletagmanager.com/gtm.js?id=${gtmId}"]`,
    )
  ) {
    return null;
  }

  const script = document.createElement("script");
  Array.from(sourceNode.attributes).forEach((attribute) => {
    script.setAttribute(attribute.name, attribute.value);
  });
  script.textContent = source;
  return script;
}
