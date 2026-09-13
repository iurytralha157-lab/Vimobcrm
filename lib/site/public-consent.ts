export const PUBLIC_COOKIE_CONSENT_KEY_PREFIX =
  "vimob_public_cookie_consent_v2";
export const PUBLIC_COOKIE_CONSENT_EVENT = "vimob:cookie-consent-changed";

export type PublicCookieConsentStorage = Pick<Storage, "getItem" | "setItem">;

const acceptedWithoutStorage = new Set<string>();

export function getPublicCookieConsentKey(organizationId: string) {
  const normalizedOrganizationId = organizationId.trim();
  if (!normalizedOrganizationId) {
    throw new Error("Public site organization id must not be empty");
  }
  return `${PUBLIC_COOKIE_CONSENT_KEY_PREFIX}:${normalizedOrganizationId}`;
}

export function hasPublicCookieConsent(
  organizationId: string,
  storage: PublicCookieConsentStorage | null = getBrowserLocalStorage(),
) {
  const consentKey = getPublicCookieConsentKey(organizationId);
  if (acceptedWithoutStorage.has(consentKey)) return true;

  try {
    return storage?.getItem(consentKey) === "accepted";
  } catch {
    return false;
  }
}

export function acceptPublicCookieConsent(
  organizationId: string,
  storage: PublicCookieConsentStorage | null = getBrowserLocalStorage(),
) {
  const consentKey = getPublicCookieConsentKey(organizationId);
  acceptedWithoutStorage.add(consentKey);
  try {
    storage?.setItem(consentKey, "accepted");
  } catch {
    // Consent remains valid for this page lifecycle when storage is blocked.
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(PUBLIC_COOKIE_CONSENT_EVENT));
  }
}

export function subscribePublicCookieConsent(onStoreChange: () => void) {
  if (typeof window === "undefined") return () => undefined;

  window.addEventListener(PUBLIC_COOKIE_CONSENT_EVENT, onStoreChange);
  window.addEventListener("storage", onStoreChange);
  return () => {
    window.removeEventListener(PUBLIC_COOKIE_CONSENT_EVENT, onStoreChange);
    window.removeEventListener("storage", onStoreChange);
  };
}

function getBrowserLocalStorage(): PublicCookieConsentStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
