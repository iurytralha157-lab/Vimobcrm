import { getSafeInvitationPostLoginPath } from './post-login-redirect';

export const SUPER_ADMIN_HOME_ROUTE = '/admin' as const;

const USER_HOME_ROUTE = '/inicio';

export type PostLoginDestinationInput = {
  /** Already validated by getSafePostLoginPath. */
  requestedPath: string;
  isSuperAdmin: boolean;
  isImpersonating: boolean;
  hasActiveOrganization: boolean;
  activeOrganizationCount: number;
};

export type PostLoginDestination =
  | { kind: 'navigate'; path: string }
  | { kind: 'select-organization'; redirectTo: string };

function pathnameOf(path: string) {
  return path.split(/[?#]/, 1)[0];
}

function isSuperAdminPath(path: string) {
  const pathname = pathnameOf(path);
  return pathname === SUPER_ADMIN_HOME_ROUTE || pathname.startsWith(`${SUPER_ADMIN_HOME_ROUTE}/`);
}

/** The only post-login routing rule. Authorization remains enforced by the API. */
export function resolvePostLoginDestination(input: PostLoginDestinationInput): PostLoginDestination {
  const { requestedPath } = input;

  if (getSafeInvitationPostLoginPath(requestedPath)) {
    return { kind: 'navigate', path: requestedPath };
  }

  if (input.isSuperAdmin && !input.isImpersonating) {
    const canOpenRequestedPath = isSuperAdminPath(requestedPath)
      || (input.hasActiveOrganization && pathnameOf(requestedPath) !== USER_HOME_ROUTE);
    return {
      kind: 'navigate',
      path: canOpenRequestedPath ? requestedPath : SUPER_ADMIN_HOME_ROUTE,
    };
  }

  if (input.hasActiveOrganization || input.activeOrganizationCount === 1) {
    return { kind: 'navigate', path: requestedPath };
  }

  return { kind: 'select-organization', redirectTo: requestedPath };
}

/**
 * The proxy cannot read the platform role, so the user home applies this guard.
 * An active organization keeps its home: a super admin may have chosen it.
 */
export function shouldRedirectToSuperAdminHome(input: {
  pathname: string | null;
  isSuperAdmin: boolean;
  isImpersonating: boolean;
  hasActiveOrganization: boolean;
}) {
  return input.isSuperAdmin
    && !input.isImpersonating
    && !input.hasActiveOrganization
    && input.pathname === USER_HOME_ROUTE;
}
