"use client";

import React, { createContext, useContext, useEffect, useState, useRef } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { logAuditAction } from '@/hooks/use-audit-logs';
import { performanceTracker } from '@/lib/performance';
import { performFullCacheClear } from '@/lib/cache-utils';
import { ROUTES, getPublicAppUrl } from '@/config/constants';
import { meAPI, type TenantContext } from '@/lib/api/me';
import { usersAPI } from '@/lib/api/users';
import {
  VimobAPIError,
  setVimobAPIAccessToken,
} from '@/lib/api/vimob-client';
import {
  clearPasswordRecoveryEvidence,
  isPasswordRecoveryAccessToken,
} from '@/lib/auth/password-recovery';
import { initializeSignedInUserContext } from '@/lib/auth/frontend-auth-reliability';
import { deactivateCurrentPushEndpoint } from '@/lib/pwa/push-session';

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

interface UserProfile {
  id: string;
  organization_id: string | null;
  name: string;
  email: string;
  role: 'admin' | 'user' | 'super_admin';
  avatar_url: string | null;
  is_active: boolean;
  language?: string | null;
  theme_mode?: 'light' | 'dark' | 'system' | null;
  phone?: string | null;
  whatsapp?: string | null;
  cpf?: string | null;
  cep?: string | null;
  endereco?: string | null;
  numero?: string | null;
  complemento?: string | null;
  bairro?: string | null;
  cidade?: string | null;
  uf?: string | null;
}

interface Organization {
  id: string;
  name: string;
  logo_url: string | null;
  theme_mode?: string | null;
  accent_color?: string | null;
  is_active?: boolean;
  subscription_status?: string;
  subscription_type?: string | null;
  trial_ends_at?: string | null;
  billing_grace_until?: string | null;
  segment?: 'imobiliario' | 'telecom' | 'servicos' | null;
  cnpj?: string | null;
  creci?: string | null;
  inscricao_estadual?: string | null;
  razao_social?: string | null;
  nome_fantasia?: string | null;
  cep?: string | null;
  endereco?: string | null;
  numero?: string | null;
  complemento?: string | null;
  bairro?: string | null;
  cidade?: string | null;
  uf?: string | null;
  telefone?: string | null;
  whatsapp?: string | null;
  email?: string | null;
  website?: string | null;
  default_commission_percentage?: number | null;
  property_edit_policy?: 'everyone' | 'responsible_or_admin' | null;
  property_owner_contact_visibility?: 'visible' | 'hidden' | null;
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

const AUTH_SNAPSHOT_VERSION = 3;
const AUTH_SNAPSHOT_TTL_MS = 1000 * 60 * 60 * 8;

interface CachedAuthSnapshot {
  version: number;
  cachedAt: number;
  profile: UserProfile;
  organization: Organization | null;
  tenantContext: TenantContext | null;
  isSuperAdmin: boolean;
}

function authSnapshotKey(userId: string) {
  return `vimob_auth_snapshot_${userId}`;
}

function readAuthSnapshot(userId: string): CachedAuthSnapshot | null {
  if (typeof window === 'undefined') return null;

  try {
    const raw = localStorage.getItem(authSnapshotKey(userId));
    if (!raw) return null;

    const snapshot = JSON.parse(raw) as Partial<CachedAuthSnapshot>;
    if (
      snapshot.version !== AUTH_SNAPSHOT_VERSION ||
      !snapshot.cachedAt ||
      Date.now() - snapshot.cachedAt > AUTH_SNAPSHOT_TTL_MS ||
      !snapshot.profile?.id
    ) {
      localStorage.removeItem(authSnapshotKey(userId));
      return null;
    }

    return snapshot as CachedAuthSnapshot;
  } catch {
    localStorage.removeItem(authSnapshotKey(userId));
    return null;
  }
}

function writeAuthSnapshot(userId: string, snapshot: Omit<CachedAuthSnapshot, 'version' | 'cachedAt'>) {
  if (typeof window === 'undefined') return;

  localStorage.setItem(
    authSnapshotKey(userId),
    JSON.stringify({
      version: AUTH_SNAPSHOT_VERSION,
      cachedAt: Date.now(),
      ...snapshot,
    }),
  );
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  profile: UserProfile | null;
  organization: Organization | null;
  tenantContext: TenantContext | null;
  loading: boolean;
  isSuperAdmin: boolean;
  impersonating: ImpersonateSession | null;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<{ error: Error | null }>;
  refreshProfile: () => Promise<void>;
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
  const recoveryActionScheduledRef = useRef(false);

  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const profileRef = useRef<UserProfile | null>(null);
  const [organization, setOrganization] = useState<Organization | null>(null);
  const organizationRef = useRef<Organization | null>(null);
  const fetchProfileRequestRef = useRef(0);
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
  });

  useEffect(() => {
    authStateRef.current = {
      authInitialized,
      organizationsLoaded,
    };
  }, [authInitialized, organizationsLoaded]);

  useEffect(() => {
    profileRef.current = profile;
  }, [profile]);

  useEffect(() => {
    organizationRef.current = organization;
  }, [organization]);

  useEffect(() => {
    if (organization) {
      authDebug('[AuthContext] active organization changed:', organization.id);
      if (user) {
        localStorage.setItem(`vimob_active_organization_${user.id}`, organization.id);
        authDebug('[AuthContext] saved active organization to localStorage:', organization.id);
      }
    }
  }, [organization, user]);
  const [impersonating, setImpersonating] = useState<ImpersonateSession | null>(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('impersonating');
      return stored ? JSON.parse(stored) : null;
    }
    return null;
  });

  const fetchProfile = async (userId: string): Promise<boolean> => {
    const requestId = ++fetchProfileRequestRef.current;
    return performanceTracker.trackTimed('fetchProfile', async () => {
      try {
        const storedImpersonating = localStorage.getItem('impersonating');
        const activeImpersonation: ImpersonateSession | null = storedImpersonating
          ? JSON.parse(storedImpersonating)
          : null;
        const preferredOrganizationId = activeImpersonation?.orgId
          || localStorage.getItem(`vimob_active_organization_${userId}`);
        const response = await meAPI.getProfile(preferredOrganizationId);
        if (requestId !== fetchProfileRequestRef.current) return true;
        const superAdmin = response.context.isSuperAdmin;
        const profileData: UserProfile = {
          ...response.profile,
          organization_id: response.context.organizationId || response.profile.organization_id,
          role: superAdmin ? 'super_admin' : normalizeProfileRole(response.context.memberRole),
        } as UserProfile;

        setIsSuperAdmin(superAdmin);
        if (!profileData.is_active && !superAdmin) {
          authDebugWarn('User is deactivated, signing out');
          await supabase.auth.signOut();
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

        writeAuthSnapshot(userId, {
          profile: profileData,
          organization: organizationData,
          tenantContext: response.context,
          isSuperAdmin: superAdmin,
        });

        if (response.context.organizationId) {
          localStorage.setItem(
            `vimob_active_organization_${userId}`,
            response.context.organizationId,
          );
        }

        return true;
      } catch (error) {
        if (requestId !== fetchProfileRequestRef.current) return true;
        console.error('Error fetching profile:', error);
        if (isExpiredAPISessionError(error)) {
          isLoggingOutRef.current = true;
          localStorage.removeItem(authSnapshotKey(userId));
          setUser(null);
          setSession(null);
          profileRef.current = null;
          organizationRef.current = null;
          setProfile(null);
          setOrganization(null);
          setTenantContext(null);
          setUserOrganizations([]);
          setOrganizationsLoaded(true);

          try {
            await supabase.auth.signOut({ scope: 'global' });
          } catch (signOutError) {
            authDebug('Logout server-side falhou apos token invalido:', signOutError);
          }

          await performFullCacheClear({
            clearAuth: true,
            redirectTo: '/login',
          });
        }
        return false;
      }
    });
  };

  const startImpersonate = async (orgId: string, orgName: string) => {
    if (!user) return;

    // Log auditoria (sem alterar o banco)
    logAuditAction('impersonate_start', 'organization', orgId, undefined, {
      org_name: orgName,
      started_at: new Date().toISOString()
    }).catch(console.error);

    const impersonateSession: ImpersonateSession = { orgId, orgName };

    // Persistir no localStorage ANTES de setar o estado para que fetchProfile já leia corretamente
    localStorage.setItem('impersonating', JSON.stringify(impersonateSession));
    setImpersonating(impersonateSession);

    await fetchProfile(user.id);
  };

  const stopImpersonate = async () => {
    // Log auditoria antes de limpar o estado
    if (user && impersonating) {
      logAuditAction('impersonate_stop', 'organization', impersonating.orgId, undefined, {
        org_name: impersonating.orgName,
        stopped_at: new Date().toISOString()
      }).catch(console.error);
    }

    setImpersonating(null);
    localStorage.removeItem('impersonating');
    organizationRef.current = null;
    setOrganization(null); // Limpa org impersonada imediatamente

    // Recarregar org original do super admin (usando organization_id real do banco)
    if (user) {
      await fetchProfile(user.id);
    }
  };

  const switchOrganization = async (orgId: string) => {
    const activeUser = userRef.current || user;
    if (!activeUser) return;

    authDebug('[AuthContext] switching organization to:', orgId);

    await meAPI.switchOrganization(orgId);
    localStorage.setItem(`vimob_active_organization_${activeUser.id}`, orgId);

    await fetchProfile(activeUser.id);
  };

  const checkMultiOrg = async (
    userId: string,
    options?: { forceSelectorForMultiOrg?: boolean }
  ) => {
    return performanceTracker.trackTimed('checkMultiOrg', async () => {
      setOrganizationsError(null);

      try {
        authDebug('[AuthContext] checking organizations for userId:', userId);

        const uniqueOrgs = await usersAPI.listUserOrganizations();
        setUserOrganizations(uniqueOrgs);
        const count = uniqueOrgs.length;
        const currentOrganizationId =
          organizationRef.current?.id || profileRef.current?.organization_id || null;
        authDebug('[AuthContext] found', count, 'active organizations');

        if (count === 0) {
          authDebugWarn('[AuthContext] no active organization remains for this user');
          localStorage.removeItem(`vimob_active_organization_${userId}`);
          localStorage.removeItem(authSnapshotKey(userId));
          organizationRef.current = null;
          setOrganization(null);
          setTenantContext(null);
          setProfile((currentProfile) => {
            const nextProfile = currentProfile ? { ...currentProfile, organization_id: null } : currentProfile;
            profileRef.current = nextProfile;
            return nextProfile;
          });
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
            organizationRef.current = null;
            setOrganization(null);
            setProfile(prev => {
              const next = prev ? { ...prev, organization_id: null } : prev;
              profileRef.current = next;
              return next;
            });
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
        console.error('[AuthContext] Error in checkMultiOrg:', err);
        setOrganizationsError('Não foi possível carregar suas organizações. Tente novamente.');
      } finally {
        setOrganizationsLoaded(true);
      }
    });
  };

  const fetchProfileRef = useRef(fetchProfile);
  const checkMultiOrgRef = useRef(checkMultiOrg);

  const hydrateAuthSnapshot = (userId: string) => {
    if (typeof window === 'undefined') return false;
    if (localStorage.getItem('impersonating')) return false;

    const snapshot = readAuthSnapshot(userId);
    if (!snapshot) return false;

    profileRef.current = snapshot.profile;
    organizationRef.current = snapshot.organization;
    setProfile(snapshot.profile);
    setOrganization(snapshot.organization);
    setTenantContext(snapshot.tenantContext);
    setIsSuperAdmin(snapshot.isSuperAdmin);

    if (snapshot.tenantContext?.organizationId) {
      localStorage.setItem(
        `vimob_active_organization_${userId}`,
        snapshot.tenantContext.organizationId,
      );
    }

    return true;
  };

  useEffect(() => {
    fetchProfileRef.current = fetchProfile;
    checkMultiOrgRef.current = checkMultiOrg;
  });

  useEffect(() => {
    let isMounted = true;
    let apiTokenAuthEventGeneration = 0;
    authDebug('AuthProvider mounted');

    const clearAllStates = () => {
      authDebug('Cleaning auth states');
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

      clearAllStates();
      setLoading(false);
      setAuthInitialized(true);
      setOrganizationsLoaded(true);

      if (window.location.pathname.startsWith(ROUTES.RESET_PASSWORD)) {
        return true;
      }

      if (recoveryActionScheduledRef.current) return true;
      recoveryActionScheduledRef.current = true;

      const shouldCancelRecovery = ['/login', '/cadastro', '/onboarding'].some((route) =>
        window.location.pathname.startsWith(route),
      );

      setTimeout(() => {
        if (!isMounted) return;

        if (!shouldCancelRecovery) {
          window.location.replace(ROUTES.RESET_PASSWORD);
          return;
        }

        const destination = window.location.pathname.startsWith('/cadastro')
          ? ROUTES.SIGNUP
          : ROUTES.LOGIN;

        clearPasswordRecoveryEvidence(window.sessionStorage);
        void supabase.auth.signOut({ scope: 'local' }).finally(() => {
          setVimobAPIAccessToken(null, null);
          window.location.replace(destination);
        });
      }, 0);

      return true;
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
      if (hydrateAuthSnapshot(session.user.id)) {
        authDebug('[AuthContext] hydrated cached auth snapshot');
      }

      try {
        // Sequencial to ensure organizations are loaded before setting initialized
        await fetchProfileRef.current(session.user.id);
        await checkMultiOrgRef.current(session.user.id);
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

          setTimeout(() => {
            performFullCacheClear({ clearAuth: true, redirectTo: '/login' });
          }, 0);
          return;
        }

        if (authEvent === 'SIGNED_IN' || authEvent === 'USER_UPDATED') {
          if (session) {
            const isSameInitializedUser =
              authStateRef.current.authInitialized &&
              authStateRef.current.organizationsLoaded &&
              userRef.current?.id === session.user.id;

            if (isSameInitializedUser) {
              setSession(session);
              setUser(session.user);
              userRef.current = session.user;

              setTimeout(() => {
                if (!isMounted) return;
                fetchProfileRef.current(session.user.id).catch(console.error);
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
                  forceSelectorForMultiOrg: authEvent === 'SIGNED_IN',
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
          // Just update session/user, never refetch profile here
          if (session) {
            setSession(session);
            setUser(session.user);
            userRef.current = session.user;
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

    return () => {
      isMounted = false;
      clearTimeout(safetyTimeout);
      window.removeEventListener('pageshow', handlePageShow);
      subscription.unsubscribe();
    };
  }, []);

  const signIn = async (email: string, password: string) => {
    const { error, data } = await supabase.auth.signInWithPassword({ email, password });

    // Log successful login (async to avoid blocking)
    if (!error && data.user) {
      setTimeout(() => {
        logAuditAction('login', 'session', data.user.id, undefined, {
          email,
          login_at: new Date().toISOString()
        }).catch(console.error);
      }, 0);
    }

    return { error };
  };

  const resetPassword = async (email: string) => {
    try {
      const redirectUrl = getPublicAppUrl(ROUTES.RESET_PASSWORD);
      authDebug('[AuthContext] Resetting password for:', email, 'redirectUrl:', redirectUrl);

      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: redirectUrl,
      });

      if (error) {
        console.error('[AuthContext] Reset password error:', error);
        return { error };
      }

      logAuditAction('password_reset_request', 'session', undefined, undefined, {
        email,
        requested_at: new Date().toISOString()
      }).catch(console.error);

      return { error: null };
    } catch (err) {
      console.error('[AuthContext] Reset password exception:', err);
      return { error: err as Error };
    }
  };

  const signOut = async () => {
    isLoggingOutRef.current = true;
    
    // Log logout before clearing states (capture user ID while we still have it)
    const currentUserId = user?.id;
    if (currentUserId) {
      logAuditAction('logout', 'session', currentUserId).catch(console.error);
    }

    // Deactivate only this device while the API bearer token is still valid.
    // Other devices belonging to the same user remain subscribed.
    try {
      await deactivateCurrentPushEndpoint(
        organization?.id || profile?.organization_id,
      );
    } catch (error) {
      authDebug('Falha ao desativar push deste dispositivo no logout:', error);
    }

    // Tentar signOut global (invalida refresh token no servidor)
    try {
      await supabase.auth.signOut({ scope: 'global' });
    } catch (error) {
      authDebug('Logout server-side falhou (sessão provavelmente já expirada):', error);
    }

    // Executar limpeza profunda e redirecionar para login com cache bust
    await performFullCacheClear({
      clearAuth: true,
      redirectTo: '/login'
    });
  };

  const refreshProfile = async () => {
    if (user) {
      await fetchProfile(user.id);
    }
  };

  const refreshOrganizations = async () => {
    const activeUser = userRef.current || user;
    if (!activeUser) return;

    setOrganizationsLoaded(false);
    setOrganizationsError(null);
    await checkMultiOrg(activeUser.id);
  };

  return (
    <AuthContext.Provider value={{
      user,
      session,
      profile,
      organization,
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
