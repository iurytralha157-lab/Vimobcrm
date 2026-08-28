const MAX_POST_LOGIN_PATH_LENGTH = 4096;
const INTERNAL_URL_ORIGIN = 'https://vimob.internal';
const INVITATION_POST_LOGIN_PATH_PATTERN = /^\/convite\/[a-f0-9]{64}$/;

export const PROTECTED_APP_ROUTE_PREFIXES = [
  '/admin',
  '/agenda',
  '/attention',
  '/automations',
  '/crm',
  '/dashboard',
  '/financeiro',
  '/gamificacao',
  '/inicio',
  '/marketing',
  '/notifications',
  '/pipeline',
  '/properties',
  '/select-organization',
  '/settings',
  '/suporte',
] as const;

const BLOCKED_POST_LOGIN_ROUTE_PREFIXES = [
  '/login',
  '/cadastro',
  '/reset-password',
  '/onboarding',
  '/select-organization',
] as const;

function matchesRoutePrefix(pathname: string, prefix: string) {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function isProtectedAppPath(pathname: string) {
  return PROTECTED_APP_ROUTE_PREFIXES.some((prefix) => (
    matchesRoutePrefix(pathname, prefix)
  ));
}

function normalizeProtectedInternalPath(value: string) {
  if (
    value.length === 0
    || value.length > MAX_POST_LOGIN_PATH_LENGTH
    || value !== value.trim()
    || !value.startsWith('/')
    || value.startsWith('//')
    || value.includes('\\')
    || /[\u0000-\u001F\u007F]/.test(value)
  ) {
    return null;
  }

  try {
    const parsed = new URL(value, INTERNAL_URL_ORIGIN);

    if (parsed.origin !== INTERNAL_URL_ORIGIN) return null;
    if (!isProtectedAppPath(parsed.pathname)) return null;
    if (BLOCKED_POST_LOGIN_ROUTE_PREFIXES.some((prefix) => (
      matchesRoutePrefix(parsed.pathname, prefix)
    ))) {
      return null;
    }

    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return null;
  }
}

function normalizeInvitationPostLoginPath(value: string) {
  if (
    value.length === 0
    || value.length > MAX_POST_LOGIN_PATH_LENGTH
    || value !== value.trim()
    || !value.startsWith('/')
    || value.startsWith('//')
    || value.includes('\\')
    || /[\u0000-\u001F\u007F]/.test(value)
  ) {
    return null;
  }

  try {
    const parsed = new URL(value, INTERNAL_URL_ORIGIN);

    if (parsed.origin !== INTERNAL_URL_ORIGIN) return null;
    if (parsed.search || parsed.hash) return null;
    if (!INVITATION_POST_LOGIN_PATH_PATTERN.test(parsed.pathname)) return null;

    return parsed.pathname;
  } catch {
    return null;
  }
}

export function getSafeProtectedAppPath(value: string | null | undefined) {
  return value ? normalizeProtectedInternalPath(value) : null;
}

export function getSafeInvitationPostLoginPath(value: string | null | undefined) {
  return value ? normalizeInvitationPostLoginPath(value) : null;
}

export function getSafePostLoginPath(
  value: string | null | undefined,
  fallback: string,
) {
  const safeFallback = normalizeProtectedInternalPath(fallback);

  if (!safeFallback) {
    throw new Error('O destino padrao pos-login precisa ser uma rota interna protegida.');
  }

  return getSafeProtectedAppPath(value)
    ?? getSafeInvitationPostLoginPath(value)
    ?? safeFallback;
}

export function getPostLoginPathFromSearchParams(
  searchParams: Pick<URLSearchParams, 'get'>,
  fallback: string,
) {
  return getSafePostLoginPath(searchParams.get('redirectTo'), fallback);
}

export function createLoginPath(
  destination: string | null | undefined,
  fallback: string,
) {
  const params = new URLSearchParams({
    redirectTo: getSafePostLoginPath(destination, fallback),
  });

  return `/login?${params.toString()}`;
}
