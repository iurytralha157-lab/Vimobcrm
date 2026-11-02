"use client";

import React, { createContext, useCallback, useContext, useEffect, useLayoutEffect, useState, useRef } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase/client';
import { performanceTracker } from '@/lib/performance';
import { performFullCacheClear } from '@/lib/cache-utils';
import { ROUTES } from '@/config/constants';
import { authAPI } from '@/lib/api/auth';
import { meAPI } from '@/lib/api/me';
import { usersAPI } from '@/lib/api/users';
import {
  type Organization,
  type TenantContext,
  type UserProfile,
} from '@/lib/validation/auth-context';
import {
  VimobAPIError,
  setVimobAPIAccessToken,
} from '@/lib/api/vimob-client';
import {
  isPasswordRecoveryAccessToken,
} from '@/lib/auth/password-recovery';
import {
  initializeSignedInUserContext,
  resolveNoMembershipAccountEntry,
  shouldForceOrganizationSelectionForAuthEvent,
  shouldRevalidateMembership,
} from '@/lib/auth/frontend-auth-reliability';
import { captureGlobalSignOutGuard, getGlobalSignOutSessionKey, signOutWithGlobalRevocation, trackGlobalSignOutSession, type GlobalSignOutLifecycle } from '@/lib/auth/global-sign-out';
import {
  resolveActiveOrganization,
  type ActiveOrganizationResolution,
} from '@/lib/auth/active-organization';
import { shouldPersistOrganizationSelectionRemotely } from '@/lib/local-read-only';
import { deactivateCurrentPushEndpoint } from '@/lib/pwa/push-session';
import { usePushDeviceIntent } from '@/hooks/use-push-device-intent';

const isAuthDebugEnabled =
  process.env.NODE_ENV !== 'production' ||
  process.env.NEXT_PUBLIC_AUTH_DEBUG === 'true';

function authDebug(...args: unknown[]) {
  if (isAuthDebugEnabled) {
    console.debug(...args);
  }
}

function authDebugWarn(...args: unknown[]) {
  if (isAuthDebugEnabled) {
    console.warn(...args);
  }
}

function isExpiredAPISessionError(error: unknown) {
  if (error instanceof VimobAPIError) {
    return (
      error.status === 401 ||
      error.code === 'unauthorized' ||
      error.code === 'missing_session'
    );
  }

  const message = error instanceof Error ? error.message : String(error);
  return /invalid or expired bearer token|sess[aã]o expirada|missing bearer token/i.test(message);
}

const normalizeProfileRole = (role: string | null | undefined): UserProfile['role'] => {
  if (role === 'admin' || role === 'super_admin') return role;
  return 'user';
};

export interface UserOrganization {
  organization_id: string;
  organization_name: string;
  organization_logo: string | null;
  member_role: string;
  is_active: boolean;
  joined_at: string;
  last_accessed_at: string | null;
}

interface ImpersonateSession {
  orgId: string;
  orgName: string;
}

function authSnapshotKey(userId: string) {
  return `vimob_auth_snapshot_${userId}`;
}

const MEMBERSHIP_FOCUS_REVALIDATION_INTERVAL_MS = 30_000;

interface AuthContextType {
  user: User | null;
  session: Session | null;
  profile: UserProfile | null;
  organization: Organization | null;
  activeOrganization: ActiveOrganizationResolution;
  tenantContext: TenantContext | null;
  loading: boolean;
  isSuperAdmin: boolean;
  impersonating: ImpersonateSession | null;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<{ error: Error | null }>;
  refreshProfile: () => Promise<boolean>;
  refreshOrganizations: () => Promise<void>;
  startImpersonate: (orgId: string, orgName: string) => Promise<void>;
  stopImpersonate: () => Promise<void>;
  switchOrganization: (orgId: string) => Promise<void>;
  authInitialized: boolean;
  organizationsLoaded: boolean;
  organizationsError: string | null;
  isInitializingOrg: boolean;
  userOrganizations: UserOrganization[];
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const userRef = useRef<User | null>(null);
  const isLoggingOutRef = useRef(false);
  const signOutInFlightRef = useRef<Promise<void> | null>(null);
  const signOutInFlightIdentityRef = useRef<{ generation: number; key: string | null } | null>(null);
  const automaticLogoutSequenceRef = useRef(0);
  const recoveryActionScheduledRef = useRef<{ key: string | null } | null>(null);
  const credentialSignInInFlightRef = useRef(false);

  const [session, setSessionState] = useState<Session | null>(null);
  const logoutLifecycleRef = useRef<GlobalSignOutLifecycle>({ generation: 0, sessionKey: null, userId: null, mounted: false, pendingPush: new Set() });
  const setSession = useCallback((nextSession: Session | null) => {
    trackGlobalSignOutSession(logoutLifecycleRef.current, nextSession);
    setSessionState(nextSession);
  }, []);
  useLayoutEffect(() => {
    const lifecycle = logoutLifecycleRef.current;
    lifecycle.mounted = true;
    return () => {
      lifecycle.mounted = false;
      lifecycle.generation += 1;
      lifecycle.pendingPush?.forEach(controller => controller.abort());
      lifecycle.pendingPush?.clear();
    };
  }, []);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const profileRef = useRef<UserProfile | null>(null);
  const [organization, setOrganization] = useState<Organization | null>(null);
  const captureLogoutPushIntent = usePushDeviceIntent(user?.id, organization?.id || profile?.organization_id);
  const organizationRef = useRef<Organization | null>(null);
  const fetchProfileRequestRef = useRef(0);
  const organizationListRequestRef = useRef(0);
  const organizationSwitchGenerationRef = useRef(0);
  const [tenantContext, setTenantContext] = useState<TenantContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [authInitialized, setAuthInitialized] = useState(false);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [organizationsLoaded, setOrganizationsLoaded] = useState(false);
  const [organizationsError, setOrganizationsError] = useState<string | null>(null);
  const [isInitializingOrg, setIsInitializingOrg] = useState(false);
  const [userOrganizations, setUserOrganizations] = useState<UserOrganization[]>([]);
  const authStateRef = useRef({
    authInitialized: false,
    organizationsLoaded: false,
    isInitializingOrg: false,
  });

  useEffect(() => {
    authStateRef.current = {
      authInitialized,
      organizationsLoaded,
      isInitializingOrg,
    };
  }, [authInitialized, organizationsLoaded, isInitializingOrg]);

  useEffect(() => {
    profileRef.current = profile;
  }, [profile]);

  useEffect(() => {
    organizationRef.current = organization;
  }, [organization]);

  const [impersonating, setImpersonating] = useState<ImpersonateSession | null>(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('impersonating');
      return stored ? JSON.parse(stored) : null;
    }
    return null;
  });

  const clearOrganizationContext = useCallback(() => {
    organizationRef.current = null;
    setOrganization(null);
    setTenantContext(null);
    setProfile((currentProfile) => {
      const nextProfile = currentProfile
        ? { ...currentProfile, organization_id: null }
        : currentProfile;
      profileRef.current = nextProfile;
      return nextProfile;
    });
  }, []);

  const failOrganizationValidation = useCallback((message: string) => {
    clearOrganizationContext();
    setUserOrganizations([]);
    setOrganizationsError(message);
  }, [clearOrganizationContext]);

  const fetchProfile = async (
    userId: string,
    requestedOrganizationId?: string | null,
  ): Promise<boolean> => {
    const requestId = ++fetchProfileRequestRef.current;
    return performanceTracker.trackTimed('fetchProfile', async () => {
      try {
        // This route is authenticated without tenant resolution. A member who
        // lost the last organization must still reach the organization picker,
        // while a globally suspended account must remain blocked.
        const memberships = await usersAPI.listUserOrganizations();
        if (requestId !== fetchProfileRequestRef.current || userRef.current?.id !== userId) return true;
        if (memberships.length === 0) {
          const accountStatus = await meAPI.getAccountStatus();
          if (requestId !== fetchProfileRequestRef.current || userRef.current?.id !== userId) return true;
          const accountEntry = resolveNoMembershipAccountEntry(accountStatus);
          if (accountEntry === 'missing_profile') {
            failOrganizationValidation('Seu perfil não foi encontrado. Entre em contato com o suporte.');
            return false;
          }
          if (accountEntry === 'globally_suspended') {
            const guard = captureGlobalSignOutGuard(session, userId, logoutLifecycleRef.current);
            if (!guard.isCurrent()) return false;
            failOrganizationValidation('Seu acesso está desativado. Entre em contato com os administradores.');
            await signOutWithGlobalRevocation({
              getSession: () => supabase.auth.getSession(),
              revokeGlobal: token => supabase.auth.admin.signOut(token, 'global'),
              clearLocal: () => supabase.auth.signOut({ scope: 'local' }),
            }, guard);
            return false;
          }
          if (accountEntry === 'no_organization') {
            setIsSuperAdmin(false);
            setUserOrganizations([]);
            setOrganizationsError(null);
            localStorage.removeItem(`vimob_active_organization_${userId}`);
            localStorage.removeItem(authSnapshotKey(userId));
            clearOrganizationContext();
            return true;
          }
        }

        const storedImpersonating = localStorage.getItem('impersonating');
        const activeImpersonation: ImpersonateSession | null = storedImpersonating
          ? JSON.parse(storedImpersonating)
          : null;
        const preferredOrganizationIdCandidate = activeImpersonation?.orgId
          || requestedOrganizationId
          || localStorage.getItem(`vimob_active_organization_${userId}`);
        const preferredOrganizationId = preferredOrganizationIdCandidate
          && (activeImpersonation?.orgId || requestedOrganizationId
            || memberships.some((membership) => membership.organization_id === preferredOrganizationIdCandidate))
          ? preferredOrganizationIdCandidate
          : memberships[0]?.organization_id;
        const response = await meAPI.getProfile(preferredOrganizationId);
        if (requestId !== fetchProfileRequestRef.current || userRef.current?.id !== userId) return true;
        const superAdmin = response.context.isSuperAdmin;
        const profileData: UserProfile = {
          ...response.profile,
          organization_id: response.context.organizationId || response.profile.organization_id,
          role: superAdmin ? 'super_admin' : normalizeProfileRole(response.context.memberRole),
        };

        setIsSuperAdmin(superAdmin);
        if (!profileData.is_active && !superAdmin) {
          const guard = captureGlobalSignOutGuard(session, userId, logoutLifecycleRef.current);
          if (!guard.isCurrent()) return false;
          authDebugWarn('User is deactivated, signing out');
          failOrganizationValidation('Seu acesso está desativado. Entre em contato com os administradores.');
          await signOutWithGlobalRevocation({
            getSession: () => supabase.auth.getSession(),
            revokeGlobal: token => supabase.auth.admin.signOut(token, 'global'),
            clearLocal: () => supabase.auth.signOut({ scope: 'local' }),
          }, guard);
          return false;
        }

        const organizationData: Organization | null = response.organization
          ? {
              ...response.organization,
              subscription_status:
                response.context.subscriptionStatus
                ?? response.organization.subscription_status,
              subscription_type:
                response.context.subscriptionType
                ?? response.organization.subscription_type,
              trial_ends_at:
                response.context.trialEndsAt
                ?? response.organization.trial_ends_at,
              billing_grace_until:
                response.context.billingGraceUntil
                ?? response.organization.billing_grace_until,
            }
          : null;
        profileRef.current = profileData;
        organizationRef.current = organizationData;
        setProfile(profileData);
        setOrganization(organizationData);
        setTenantContext(response.context);

        if (response.context.organizationId) {
          localStorage.setItem(
            `vimob_active_organization_${userId}`,
            response.context.organizationId,
          );
        }

        return true;
      } catch (error) {
        if (requestId !== fetchProfileRequestRef.current || userRef.current?.id !== userId) return true;
        console.error('Error fetching profile:', error);
        failOrganizationValidation('Não foi possível validar seu acesso. Tente novamente.');
        if (isExpiredAPISessionError(error)) {
          const guard = captureGlobalSignOutGuard(session, userId, logoutLifecycleRef.current);
          if (!guard.isCurrent()) return false;
          const logoutSequence = ++automaticLogoutSequenceRef.current;
          isLoggingOutRef.current = true;
          localStorage.removeItem(authSnapshotKey(userId));
          setUser(null);
          setSession(null);
          userRef.current = null;
          profileRef.current = null;
          organizationRef.current = null;
          setProfile(null);
          setOrganization(null);
          setTenantContext(null);
          setUserOrganizations([]);
          setOrganizationsLoaded(true);

          try {
            const outcome = await signOutWithGlobalRevocation({
              getSession: () => supabase.auth.getSession(),
              revokeGlobal: token => supabase.auth.admin.signOut(token, 'global'),
              clearLocal: () => supabase.auth.signOut({ scope: 'local' }),
            }, guard);
            if (outcome === 'cancelled' || !guard.isCurrent()) return false;
            await performFullCacheClear({
              clearAuth: true,
              redirectTo: outcome === 'verified-global' ? '/login' : '/login?logout=unverified',
              isCurrent: guard.isCurrent,
            });
          } catch (signOutError) {
            authDebug('Logout server-side falhou apos token invalido:', signOutError);
          } finally {
            if (automaticLogoutSequenceRef.current === logoutSequence && !signOutInFlightRef.current) {
              isLoggingOutRef.current = false;
            }
          }
        }
        return false;
      }
    });
  };

  const startImpersonate = async (orgId: string, orgName: string) => {
    if (!user) return;

    const switchGeneration = ++organizationSwitchGenerationRef.current;
    setIsInitializingOrg(true);

    const impersonateSession: ImpersonateSession = { orgId, orgName };

    // Persistir no localStorage ANTES de setar o estado para que fetchProfile já leia corretamente
    localStorage.setItem('impersonating', JSON.stringify(impersonateSession));
    setImpersonating(impersonateSession);

    try {
      const profileLoaded = await fetchProfile(user.id);
      if (!profileLoaded) {
        setImpersonating(null);
        localStorage.removeItem('impersonating');
        throw new Error('Não foi possível carregar a organização impersonada.');
      }
    } finally {
      if (switchGeneration === organizationSwitchGenerationRef.current) {
        setIsInitializingOrg(false);
      }
    }
  };

  const stopImpersonate = async () => {
    const switchGeneration = ++organizationSwitchGenerationRef.current;
    setIsInitializingOrg(true);

    setImpersonating(null);
    localStorage.removeItem('impersonating');
    organizationRef.current = null;
    setOrganization(null); // Limpa org impersonada imediatamente

    // Recarregar org original do super admin (usando organization_id real do banco)
    try {
      if (user) {
        const profileLoaded = await fetchProfile(user.id);
        if (!profileLoaded) {
          localStorage.removeItem(`vimob_active_organization_${user.id}`);
          localStorage.removeItem(authSnapshotKey(user.id));
          setTenantContext(null);
          setProfile((currentProfile) => {
            const nextProfile = currentProfile
              ? { ...currentProfile, organization_id: null }
              : currentProfile;
            profileRef.current = nextProfile;
            return nextProfile;
          });
          throw new Error('Não foi possível restaurar a organização original.');
        }
      }
    } finally {
      if (switchGeneration === organizationSwitchGenerationRef.current) {
        setIsInitializingOrg(false);
      }
    }
  };

  const switchOrganization = async (orgId: string) => {
    const activeUser = userRef.current || user;
    if (!activeUser) return;

    const switchGeneration = ++organizationSwitchGenerationRef.current;
    setIsInitializingOrg(true);

    authDebug('[AuthContext] switching organization to:', orgId);

    try {
      if (shouldPersistOrganizationSelectionRemotely()) {
        await meAPI.switchOrganization(orgId);
      }

      // Pass the target explicitly and let fetchProfile persist it only after
      // the complete tenant payload has passed validation.
      const profileLoaded = await fetchProfile(activeUser.id, orgId);
      if (!profileLoaded) {
        // The previous organization, tenant context and snapshot remain valid;
        // do not turn a failed switch into a forced selector redirect.
        throw new Error('Não foi possível carregar a organização selecionada.');
      }
    } finally {
      if (switchGeneration === organizationSwitchGenerationRef.current) {
        setIsInitializingOrg(false);
      }
    }
  };

  const checkMultiOrg = async (
    userId: string,
    options?: { forceSelectorForMultiOrg?: boolean }
  ) => {
    const requestId = ++organizationListRequestRef.current;
    return performanceTracker.trackTimed('checkMultiOrg', async () => {
      setOrganizationsError(null);

      try {
        authDebug('[AuthContext] checking organizations for userId:', userId);

        const uniqueOrgs = await usersAPI.listUserOrganizations();
        if (requestId !== organizationListRequestRef.current || userRef.current?.id !== userId) return;
        setUserOrganizations(uniqueOrgs);
        const count = uniqueOrgs.length;
        let currentOrganizationId =
          organizationRef.current?.id || profileRef.current?.organization_id || null;
        authDebug('[AuthContext] found', count, 'active organizations');

        if (currentOrganizationId && !uniqueOrgs.some((org) => org.organization_id === currentOrganizationId)) {
          clearOrganizationContext();
          localStorage.removeItem(`vimob_active_organization_${userId}`);
          currentOrganizationId = null;
        }

        if (count === 0) {
          authDebugWarn('[AuthContext] no active organization remains for this user');
          localStorage.removeItem(`vimob_active_organization_${userId}`);
          localStorage.removeItem(authSnapshotKey(userId));
          clearOrganizationContext();
        } else if (count === 1) {
          const onlyOrgId = uniqueOrgs[0].organization_id;
          
          if (currentOrganizationId !== onlyOrgId) {
            authDebug('[AuthContext] auto-selecting single org:', onlyOrgId);
            setIsInitializingOrg(true);
            try {
              await switchOrganization(onlyOrgId);
            } finally {
              setIsInitializingOrg(false);
            }
          }
        } else if (count > 1) {
          if (options?.forceSelectorForMultiOrg) {
            authDebug('[AuthContext] multiple organizations found; forcing organization selector');
            clearOrganizationContext();
            return;
          }

          const savedOrgId = localStorage.getItem(`vimob_active_organization_${userId}`);
          
          if (savedOrgId && currentOrganizationId !== savedOrgId) {
            const isValid = uniqueOrgs.some(o => o.organization_id === savedOrgId);
            
            if (isValid) {
              authDebug('[AuthContext] loading last used org for multi-org user:', savedOrgId);
              setIsInitializingOrg(true);
              try {
                await switchOrganization(savedOrgId);
              } finally {
                setIsInitializingOrg(false);
              }
            } else {
              authDebugWarn('[AuthContext] saved organization no longer valid:', savedOrgId);
              localStorage.removeItem(`vimob_active_organization_${userId}`);
            }
          } else if (!savedOrgId) {
            authDebug('[AuthContext] multiple organizations found but none active/saved');
          }
        }
      } catch (err) {
        if (requestId !== organizationListRequestRef.current || userRef.current?.id !== userId) return;
        console.error('[AuthContext] Error in checkMultiOrg:', err);
        failOrganizationValidation('Não foi possível carregar suas organizações. Tente novamente.');
      } finally {
        if (requestId === organizationListRequestRef.current && userRef.current?.id === userId) {
          setOrganizationsLoaded(true);
        }
      }
    });
  };

  const fetchProfileRef = useRef(fetchProfile);
  const checkMultiOrgRef = useRef(checkMultiOrg);

  useEffect(() => {
    fetchProfileRef.current = fetchProfile;
    checkMultiOrgRef.current = checkMultiOrg;
  });

  useEffect(() => {
    let isMounted = true;
    let apiTokenAuthEventGeneration = 0;
    let membershipRefreshInFlight = false;
    let lastMembershipRefreshAt = 0;
    authDebug('AuthProvider mounted');

    const clearAllStates = () => {
      authDebug('Cleaning auth states');
      credentialSignInInFlightRef.current = false;
      organizationListRequestRef.current += 1;
      setVimobAPIAccessToken(null, null);
      const currentUserId = userRef.current?.id;
      if (currentUserId) {
        localStorage.removeItem(`vimob_active_organization_${currentUserId}`);
        localStorage.removeItem(authSnapshotKey(currentUserId));
      }

      setSession(null);
      setUser(null);
      userRef.current = null;
      profileRef.current = null;
      organizationRef.current = null;
      setProfile(null);
      setOrganization(null);
      setTenantContext(null);
      setIsSuperAdmin(false);
      setImpersonating(null);
      localStorage.removeItem('impersonating');
      setOrganizationsLoaded(false);
      setOrganizationsError(null);
      setUserOrganizations([]);
      setIsInitializingOrg(false);
    };

    const isolatePasswordRecoverySession = (recoverySession: Session) => {
      if (!isPasswordRecoveryAccessToken(recoverySession.access_token)) return false;

      // This SDK event precedes the regular session setter. Record its visit
      // synchronously before isolating it from the CRM's authenticated state.
      trackGlobalSignOutSession(logoutLifecycleRef.current, recoverySession);
      const guard = captureGlobalSignOutGuard(recoverySession, recoverySession.user.id, logoutLifecycleRef.current);
      clearAllStates();
      setLoading(false);
      setAuthInitialized(true);
      setOrganizationsLoaded(true);

      if (window.location.pathname.startsWith(ROUTES.RESET_PASSWORD)) {
        return true;
      }

      // Auth events also arrive from other tabs. Passive isolation must never
      // sign out the browser-wide recovery session owned by the email tab.
      const action = { key: getGlobalSignOutSessionKey(recoverySession) };
      recoveryActionScheduledRef.current = action;
      const isCurrent = () => isMounted && recoveryActionScheduledRef.current === action && guard.isCurrent();

      setTimeout(() => {
        if (!isCurrent()) return;
        void (async () => {
          const { data, error } = await supabase.auth.getSession();
          if (!isCurrent() || error || getGlobalSignOutSessionKey(data.session) !== action.key
            || !isPasswordRecoveryAccessToken(data.session?.access_token)) return;
          if (!window.location.pathname.startsWith(ROUTES.RESET_PASSWORD)) {
            window.location.replace(ROUTES.RESET_PASSWORD);
          }
        })().catch(() => {
          if (isCurrent()) authDebugWarn('Não foi possível conferir a sessão antes de redirecionar a recuperação.');
        }).finally(() => {
          if (recoveryActionScheduledRef.current === action) recoveryActionScheduledRef.current = null;
        });
      }, 0);

      return true;
    };

    const revalidateCurrentMembership = (fromFocus = false) => {
      const currentUserId = userRef.current?.id;
      const now = Date.now();
      if (!shouldRevalidateMembership({
        active: isMounted,
        hasUser: Boolean(currentUserId),
        authInitialized: authStateRef.current.authInitialized,
        organizationsLoaded: authStateRef.current.organizationsLoaded,
        isInitializingOrganization: authStateRef.current.isInitializingOrg,
        isLoggingOut: isLoggingOutRef.current,
        inFlight: membershipRefreshInFlight,
        onRecoveryRoute: window.location.pathname.startsWith(ROUTES.RESET_PASSWORD),
        fromFocus,
        now,
        lastRefreshAt: lastMembershipRefreshAt,
        focusIntervalMs: MEMBERSHIP_FOCUS_REVALIDATION_INTERVAL_MS,
      })) return;
      if (!currentUserId) return;
      lastMembershipRefreshAt = now;
      membershipRefreshInFlight = true;
      const switchGeneration = organizationSwitchGenerationRef.current;

      void (async () => {
        const profileLoaded = await fetchProfileRef.current(currentUserId);
        if (
          !isMounted || userRef.current?.id !== currentUserId || !profileLoaded
          || organizationSwitchGenerationRef.current !== switchGeneration
        ) return;
        await checkMultiOrgRef.current(currentUserId);
      })()
        .catch((error) => {
          if (!isMounted || userRef.current?.id !== currentUserId) return;
          console.error('[AuthContext] Falha ao revalidar o acesso:', error);
          failOrganizationValidation('Não foi possível validar seu acesso. Tente novamente.');
        })
        .finally(() => {
          membershipRefreshInFlight = false;
        });
    };

    // Safety timeout: stop loading only if the auth flow is truly still stuck.
    const safetyTimeout = setTimeout(() => {
      const state = authStateRef.current;
      if (isMounted && (!state.authInitialized || !state.organizationsLoaded)) {
        authDebugWarn('Auth safety timeout reached - forcing all loading states to complete');
        if (userRef.current && !state.organizationsLoaded) {
          setOrganizationsError('Não foi possível carregar suas organizações. Tente novamente.');
        }
        setLoading(false);
        setAuthInitialized(true);
        setOrganizationsLoaded(true);
        setIsInitializingOrg(false);
      }
    }, 15000);

    authDebug('getSession started');
    const initialAPITokenGeneration = apiTokenAuthEventGeneration;
    supabase.auth.getSession().then(async ({ data: { session }, error }) => {
      if (!isMounted) return;
      authDebug('getSession finished, session:', !!session, 'error:', error?.message);

      if (error || !session) {
        clearAllStates();
        setLoading(false);
        setAuthInitialized(true);
        setOrganizationsLoaded(true); // Must set this even without session
        authDebug('Auth initialization complete naturally (no session)');
        return;
      }

      if (isolatePasswordRecoverySession(session)) {
        authDebug('[AuthContext] recovery session isolated from application auth');
        return;
      }

      if (initialAPITokenGeneration === apiTokenAuthEventGeneration) {
        setVimobAPIAccessToken(session.access_token, session.user.id);
      }
      setSession(session);
      setUser(session.user);
      userRef.current = session.user;
      authDebug('[AuthContext] login user loaded:', session.user.id);
      // Cached tenant claims must never unlock the CRM before fresh validation.
      localStorage.removeItem(authSnapshotKey(session.user.id));

      try {
        // Sequencial to ensure organizations are loaded before setting initialized
        const profileLoaded = await fetchProfileRef.current(session.user.id);
        if (profileLoaded && userRef.current?.id === session.user.id) {
          await checkMultiOrgRef.current(session.user.id);
        } else if (userRef.current?.id === session.user.id) {
          setOrganizationsLoaded(true);
        }
      } catch (err) {
        console.error('[AuthContext] Error during initial auth data fetch:', err);
      } finally {
        if (isMounted) {
          setLoading(false);
          setAuthInitialized(true);
          authDebug('[AuthContext] Auth initialization complete naturally');
        }
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (!isMounted) return;

        const authEvent = event as string;
        authDebug('Auth event:', authEvent, 'Session:', !!session);

        // CRITICAL: Never use async/await with Supabase calls inside this callback.
        // Doing so deadlocks getSession() and other queries. Only update local state
        // synchronously here, and defer any Supabase calls via setTimeout(..., 0).
        apiTokenAuthEventGeneration += 1;
        if (session && isolatePasswordRecoverySession(session)) {
          authDebug('[AuthContext] recovery auth event isolated:', authEvent);
          return;
        }
        setVimobAPIAccessToken(
          session?.access_token ?? null,
          session?.user.id ?? null,
        );

        // Initial profile loading is handled by the getSession() block above. The
        // API token still needs to be synchronized for this auth generation.
        if (authEvent === 'INITIAL_SESSION') {
          authDebug('INITIAL_SESSION API token synchronized');
          return;
        }

        if (authEvent === 'SIGNED_OUT') {
          clearAllStates();
          setLoading(false);
          setAuthInitialized(true);
          setOrganizationsLoaded(true);

          if (isLoggingOutRef.current) {
            authDebug('[AuthContext] SIGNED_OUT event ignored (explicit signOut in progress)');
            return;
          }

          // Don't redirect from public routes - just clear state
          const isPublicRoute = typeof window !== 'undefined' && [
            '/login',
            '/cadastro',
            '/convite',
            '/reset-password',
            '/onboarding',
            '/checkout',
            '/help',
            '/termos-de-uso',
            '/politica-de-privacidade'
          ].some(route => window.location.pathname.startsWith(route));

          if (isPublicRoute) {
            authDebug('[AuthContext] SIGNED_OUT on public route, skipping redirect');
            return;
          }

          const guard = captureGlobalSignOutGuard(null, null, logoutLifecycleRef.current);
          setTimeout(() => {
            if (!isMounted || !guard.isCurrent()) return;
            void performFullCacheClear({ clearAuth: true, redirectTo: '/login', isCurrent: guard.isCurrent });
          }, 0);
          return;
        }

        if (authEvent === 'SIGNED_IN' || authEvent === 'USER_UPDATED') {
          if (session) {
            const forceSelectorForMultiOrg = shouldForceOrganizationSelectionForAuthEvent({
              authEvent,
              credentialSignInInFlight: credentialSignInInFlightRef.current,
            });
            const isSameInitializedUser =
              authStateRef.current.authInitialized &&
              userRef.current?.id === session.user.id;

            if (isSameInitializedUser) {
              setSession(session);
              setUser(session.user);
              userRef.current = session.user;

              setTimeout(() => {
                if (!isMounted) return;
                revalidateCurrentMembership(true);
              }, 0);
              return;
            }

            setLoading(true);
            setOrganizationsLoaded(false);
            setIsInitializingOrg(true);
            setSession(session);
            setUser(session.user);
            userRef.current = session.user;

            // Defer Supabase calls to avoid deadlock with the auth listener
            setTimeout(() => {
              if (!isMounted) return;
              void initializeSignedInUserContext(
                () => fetchProfileRef.current(session.user.id),
                () => checkMultiOrgRef.current(session.user.id, {
                  forceSelectorForMultiOrg,
                }),
              )
                .catch((error) => {
                  console.error('[AuthContext] Error loading signed-in user context:', error);
                })
                .finally(() => {
                  if (!isMounted) return;
                  setIsInitializingOrg(false);
                  setLoading(false);
                  setAuthInitialized(true);
                });
            }, 0);
          } else {
            setLoading(false);
            setAuthInitialized(true);
            setOrganizationsLoaded(true);
          }
          return;
        }

        if (authEvent === 'TOKEN_REFRESHED') {
          if (session) {
            setSession(session);
            setUser(session.user);
            userRef.current = session.user;
            // Run outside the Auth callback to avoid holding the Supabase auth lock.
            setTimeout(() => revalidateCurrentMembership(), 0);
          }
          return;
        }

        if (!session) {
          clearAllStates();
          setLoading(false);
          setAuthInitialized(true);
          setOrganizationsLoaded(true);
        }
      }
    );

    const handlePageShow = (event: PageTransitionEvent) => {
      // A page restored from the back/forward cache also restores its old
      // in-memory bearer token. Reload through the proxy so a completed or
      // cancelled recovery cannot revive a frozen authenticated screen.
      if (event.persisted) {
        window.location.reload();
        return;
      }

      if (window.location.pathname.startsWith(ROUTES.RESET_PASSWORD)) return;

      void supabase.auth.getSession().then(({ data }) => {
        if (isMounted && data.session) {
          isolatePasswordRecoverySession(data.session);
        }
      });
    };
    window.addEventListener('pageshow', handlePageShow);

    const handleFocus = () => {
      if (document.visibilityState === 'visible') revalidateCurrentMembership(true);
    };
    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleFocus);

    return () => {
      isMounted = false;
      clearTimeout(safetyTimeout);
      window.removeEventListener('pageshow', handlePageShow);
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleFocus);
      subscription.unsubscribe();
    };
  }, [failOrganizationValidation, setSession]);

  const signIn = async (email: string, password: string) => {
    credentialSignInInFlightRef.current = true;

    try {
      const { error } = await authAPI.login(email, password);

      return { error };
    } finally {
      credentialSignInInFlightRef.current = false;
    }
  };

  const resetPassword = async (email: string) => {
    try {
      const { error } = await authAPI.resetPassword(email);

      if (error) {
        return { error };
      }

      return { error: null };
    } catch (err) {
      return { error: err as Error };
    }
  };

  const signOut = (): Promise<void> => {
    const guard = captureGlobalSignOutGuard(session, user?.id ?? null, logoutLifecycleRef.current);
    if (!guard.isCurrent()) return Promise.resolve();
    if (signOutInFlightRef.current && signOutInFlightIdentityRef.current?.generation === guard.generation
      && signOutInFlightIdentityRef.current.key === guard.key) return signOutInFlightRef.current;

    const operation = (async () => {
      isLoggingOutRef.current = true;

      // Deactivate only this device while the API bearer token is still valid.
      try {
        const intent = captureLogoutPushIntent();
        const controller = new AbortController();
        const abort = () => controller.abort();
        if (intent.signal.aborted) controller.abort();
        else intent.signal.addEventListener('abort', abort, { once: true });
        logoutLifecycleRef.current.pendingPush?.add(controller);
        try {
          await deactivateCurrentPushEndpoint(intent.organizationId, {
            expectedUserId: intent.userId, signal: controller.signal,
            isCurrent: () => guard.isCurrent() && intent.isCurrent(),
          });
        } finally {
          intent.signal.removeEventListener('abort', abort);
          logoutLifecycleRef.current.pendingPush?.delete(controller);
          intent.finish();
        }
      } catch (error) {
        authDebug('Falha ao desativar push deste dispositivo no logout:', error);
      }
      if (!guard.isCurrent()) return;

      const outcome = await signOutWithGlobalRevocation({
        getSession: () => supabase.auth.getSession(),
        revokeGlobal: (accessToken) => supabase.auth.admin.signOut(accessToken, 'global'),
        clearLocal: () => supabase.auth.signOut({ scope: 'local' }),
      }, guard);
      if (outcome === 'cancelled' || !guard.isCurrent()) return;

      await performFullCacheClear({
        clearAuth: true,
        redirectTo: outcome === 'verified-global' ? '/login' : '/login?logout=unverified',
        isCurrent: guard.isCurrent,
      });
    })();

    signOutInFlightRef.current = operation;
    signOutInFlightIdentityRef.current = { generation: guard.generation, key: guard.key };
    void operation.then(
      () => { if (signOutInFlightRef.current === operation) {
        signOutInFlightRef.current = null; signOutInFlightIdentityRef.current = null; isLoggingOutRef.current = false;
      } },
      () => {
        if (signOutInFlightRef.current !== operation) return;
        signOutInFlightRef.current = null;
        signOutInFlightIdentityRef.current = null;
        isLoggingOutRef.current = false;
      },
    );
    return operation;
  };

  const refreshProfile = async () => {
    if (!user) return false;
    return fetchProfile(user.id);
  };

  const refreshOrganizations = async () => {
    const activeUser = userRef.current || user;
    if (!activeUser) return;

    setOrganizationsLoaded(false);
    setOrganizationsError(null);
    const profileLoaded = await fetchProfile(activeUser.id);
    if (profileLoaded && userRef.current?.id === activeUser.id) {
      await checkMultiOrg(activeUser.id);
    } else if (userRef.current?.id === activeUser.id) {
      setOrganizationsLoaded(true);
    }
  };

  const activeOrganization = resolveActiveOrganization({
    userId: user?.id,
    authInitialized,
    authLoading: loading,
    organizationsLoaded,
    isInitializingOrganization: isInitializingOrg,
    organizationId: organization?.id,
    tenantOrganizationId: tenantContext?.organizationId,
    profileOrganizationId: profile?.organization_id,
    impersonatedOrganizationId: impersonating?.orgId,
    organizationsError,
  });

  return (
    <AuthContext.Provider value={{
      user,
      session,
      profile,
      organization,
      activeOrganization,
      tenantContext,
      loading,
      isSuperAdmin,
      impersonating,
      authInitialized,
      organizationsLoaded,
      organizationsError,
      isInitializingOrg,
      userOrganizations,
      signIn,
      signOut,
      resetPassword,
      refreshProfile,
      refreshOrganizations,
      startImpersonate,
      stopImpersonate,
      switchOrganization,
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
