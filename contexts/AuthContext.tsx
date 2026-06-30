"use client";

import React, { createContext, useContext, useEffect, useState, useRef } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { logAuditAction } from '@/hooks/use-audit-logs';
import { performanceTracker } from '@/lib/performance';
import { performFullCacheClear } from '@/lib/cache-utils';
import { meAPI } from '@/lib/api/me';
import { usersAPI } from '@/lib/api/users';
import { ROUTES, getPublicAppUrl } from '@/config/constants';

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
  whatsapp?: string | null;
  cpf?: string | null;
}

interface Organization {
  id: string;
  name: string;
  logo_url: string | null;
  theme_mode: string;
  accent_color: string;
  is_active?: boolean;
  subscription_status?: string;
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

const IMPERSONATING_STORAGE_KEY = 'impersonating';
const AUTH_BOOTSTRAP_TIMEOUT_MS = 8000;
const SIGN_IN_ROLE_TIMEOUT_MS = 3500;

function isInvalidSessionError(error: unknown) {
  const candidate = error as { code?: unknown; message?: unknown; status?: unknown } | null;
  const message = typeof candidate?.message === 'string' ? candidate.message : '';
  const code = typeof candidate?.code === 'string' ? candidate.code : '';
  const status = typeof candidate?.status === 'number' ? candidate.status : 0;

  return status === 401 && /bearer|token|session|sessao|expir/i.test(`${code} ${message}`);
}

function withSoftTimeout<T>(
  task: Promise<T>,
  fallback: T,
  label: string,
  timeoutMs = AUTH_BOOTSTRAP_TIMEOUT_MS,
): Promise<T> {
  let settled = false;

  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      console.warn(`[AuthContext] ${label} timed out; continuing with degraded auth state.`);
      resolve(fallback);
    }, timeoutMs);

    task
      .then((value) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        console.error(`[AuthContext] ${label} failed:`, error);
        resolve(fallback);
      });
  });
}

function readStoredImpersonation(): ImpersonateSession | null {
  if (typeof window === 'undefined') return null;

  try {
    const stored = window.localStorage?.getItem(IMPERSONATING_STORAGE_KEY);
    if (!stored) return null;

    const parsed = JSON.parse(stored) as Partial<ImpersonateSession>;
    if (typeof parsed.orgId === 'string' && typeof parsed.orgName === 'string') {
      return { orgId: parsed.orgId, orgName: parsed.orgName };
    }
  } catch {
    // Ignore corrupted browser state and reset it below.
  }

  try {
    window.localStorage?.removeItem(IMPERSONATING_STORAGE_KEY);
  } catch {
    // Browser storage may be unavailable in restricted contexts.
  }

  return null;
}

function persistStoredImpersonation(session: ImpersonateSession) {
  try {
    window.localStorage?.setItem(IMPERSONATING_STORAGE_KEY, JSON.stringify(session));
  } catch {
    // Browser storage may be unavailable in restricted contexts.
  }
}

function clearStoredImpersonation() {
  try {
    window.localStorage?.removeItem(IMPERSONATING_STORAGE_KEY);
  } catch {
    // Browser storage may be unavailable in restricted contexts.
  }
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  profile: UserProfile | null;
  organization: Organization | null;
  loading: boolean;
  isSuperAdmin: boolean;
  impersonating: ImpersonateSession | null;
  signIn: (email: string, password: string) => Promise<{ error: Error | null; isSuperAdmin?: boolean }>;
  signUp: (email: string, password: string, name: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<{ error: Error | null }>;
  refreshProfile: () => Promise<void>;
  startImpersonate: (orgId: string, orgName: string) => Promise<void>;
  stopImpersonate: () => Promise<void>;
  switchOrganization: (orgId: string) => Promise<void>;
  authInitialized: boolean;
  organizationsLoaded: boolean;
  isInitializingOrg: boolean;
  userOrganizations: UserOrganization[];
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const userRef = useRef<User | null>(null);
  const isLoggingOutRef = useRef(false);

  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [loading, setLoading] = useState(true);
  const [authInitialized, setAuthInitialized] = useState(false);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [organizationsLoaded, setOrganizationsLoaded] = useState(false);
  const [isInitializingOrg, setIsInitializingOrg] = useState(false);
  const [userOrganizations, setUserOrganizations] = useState<UserOrganization[]>([]);
  const organizationRef = useRef<Organization | null>(null);
  const lastSuperAdminRef = useRef(false);
  const authStateRef = useRef({
    authInitialized: false,
    organizationsLoaded: false,
  });

  const setActiveOrganization = (nextOrganization: Organization | null) => {
    organizationRef.current = nextOrganization;
    setOrganization(nextOrganization);
  };

  const resetClientAuthState = () => {
    const currentUserId = userRef.current?.id;
    if (currentUserId) {
      localStorage.removeItem(`vimob_active_organization_${currentUserId}`);
    }

    setSession(null);
    setUser(null);
    userRef.current = null;
    setProfile(null);
    setActiveOrganization(null);
    setIsSuperAdmin(false);
    lastSuperAdminRef.current = false;
    setImpersonating(null);
    clearStoredImpersonation();
    setUserOrganizations([]);
    setIsInitializingOrg(false);
    setOrganizationsLoaded(true);
    setAuthInitialized(true);
    setLoading(false);
  };

  const recoverFromInvalidSession = async () => {
    if (isLoggingOutRef.current) return;

    isLoggingOutRef.current = true;

    try {
      await supabase.auth.signOut({ scope: 'local' });
    } catch {
      // A sessao ja pode estar invalida no Supabase; a limpeza local ainda resolve o app.
    }

    resetClientAuthState();

    const isPublicRoute = typeof window !== 'undefined' && [
      '/login',
      '/cadastro',
      '/reset-password',
      '/onboarding',
      '/convite',
      '/checkout',
      '/termos-de-uso',
      '/politica-de-privacidade'
    ].some(route => window.location.pathname.startsWith(route));

    if (!isPublicRoute) {
      await performFullCacheClear({
        clearAuth: true,
        redirectTo: '/login',
        clearBrowserCaches: false
      });
    }
  };

  useEffect(() => {
    authStateRef.current = {
      authInitialized,
      organizationsLoaded,
    };
  }, [authInitialized, organizationsLoaded]);

  useEffect(() => {
    if (organization) {
      console.log('[AuthContext] active organization changed:', organization.id);
      if (user) {
        localStorage.setItem(`vimob_active_organization_${user.id}`, organization.id);
        console.log('[AuthContext] saved active organization to localStorage:', organization.id);
      }
    }
  }, [organization, user]);
  const [impersonating, setImpersonating] = useState<ImpersonateSession | null>(() => readStoredImpersonation());

  const checkSuperAdmin = async (userId: string): Promise<boolean> => {
    void userId;
    return performanceTracker.trackTimed('checkSuperAdmin', async () => {
      const response = await meAPI.getMe();
      return response.context.isSuperAdmin;
    });
  };

  const fetchProfile = async (userId: string, organizationId?: string | null): Promise<boolean> => {
    return performanceTracker.trackTimed('fetchProfile', async () => {
      try {
        const activeImpersonation = readStoredImpersonation();
        const response = await meAPI.getProfile(activeImpersonation?.orgId || organizationId || undefined);
        const profileData = response.profile;
        const superAdmin = response.context.isSuperAdmin;

        if (profileData) {
          setIsSuperAdmin(superAdmin);
          lastSuperAdminRef.current = superAdmin;

          if (!profileData.is_active && !superAdmin) {
            console.warn('User is deactivated, signing out');
            await supabase.auth.signOut();

            return false;
          }

          setProfile({
            ...profileData,
            role: normalizeProfileRole(profileData.role),
          } as UserProfile);

          const orgData = response.organization;
          if (orgData) {
            if (!orgData.is_active && !superAdmin && !activeImpersonation) {
              console.warn('Organization is deactivated, signing out');
              await supabase.auth.signOut();
              return false;
            }
            setActiveOrganization({
              ...orgData,
              theme_mode: orgData.theme_mode || 'system',
              accent_color: orgData.accent_color || '#FF4529',
            } as Organization);
          } else {
            setActiveOrganization(null);
          }

          return true;
        }
        return false;
      } catch (error) {
        console.error('Error fetching profile:', error);
        if (isInvalidSessionError(error)) {
          await recoverFromInvalidSession();
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
    persistStoredImpersonation(impersonateSession);
    setImpersonating(impersonateSession);

    const data = await meAPI.getProfile(orgId);
    setIsSuperAdmin(data.context.isSuperAdmin);
    lastSuperAdminRef.current = data.context.isSuperAdmin;
    if (data.organization) {
      setActiveOrganization({
        ...data.organization,
        theme_mode: data.organization.theme_mode || 'system',
        accent_color: data.organization.accent_color || '#FF4529',
      } as Organization);
    }
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
    clearStoredImpersonation();
    setActiveOrganization(null); // Limpa org impersonada imediatamente

    // Recarregar org original do super admin (usando organization_id real do banco)
    if (user) {
      await fetchProfile(user.id);
    }
  };

  const switchOrganization = async (orgId: string) => {
    const activeUser = userRef.current || user;
    if (!activeUser) return;

    localStorage.setItem(`vimob_active_organization_${activeUser.id}`, orgId);
    console.log('[AuthContext] switching organization to:', orgId);

    await meAPI.switchOrganization(orgId);
    await fetchProfile(activeUser.id, orgId);
  };

  const checkMultiOrg = async (
    userId: string,
    options?: { forceSelectorForMultiOrg?: boolean }
  ) => {
    return performanceTracker.trackTimed('checkMultiOrg', async () => {
      try {
        console.log('[AuthContext] checking organizations for userId:', userId);

        const uniqueOrgs = await usersAPI.listUserOrganizations();
        setUserOrganizations(uniqueOrgs);
        const count = uniqueOrgs.length;
        console.log('[AuthContext] found', count, 'active organizations');

        if (count === 1) {
          const onlyOrgId = uniqueOrgs[0].organization_id;

          const currentOrganization = organizationRef.current;

          if (!currentOrganization || currentOrganization.id !== onlyOrgId) {
            console.log('[AuthContext] auto-selecting single org:', onlyOrgId);
            setIsInitializingOrg(true);
            try {
              await switchOrganization(onlyOrgId);
            } finally {
              setIsInitializingOrg(false);
            }
          }
        } else if (count > 1) {
          if (options?.forceSelectorForMultiOrg) {
            console.log('[AuthContext] multiple organizations found; forcing organization selector');
            setActiveOrganization(null);
            setProfile(prev => prev ? { ...prev, organization_id: null } : prev);
            return;
          }

          const savedOrgId = localStorage.getItem(`vimob_active_organization_${userId}`);

          const currentOrganization = organizationRef.current;

          if (savedOrgId && (!currentOrganization || currentOrganization.id !== savedOrgId)) {
            const isValid = uniqueOrgs.some(o => o.organization_id === savedOrgId);

            if (isValid) {
              console.log('[AuthContext] loading last used org for multi-org user:', savedOrgId);
              setIsInitializingOrg(true);
              try {
                await switchOrganization(savedOrgId);
              } finally {
                setIsInitializingOrg(false);
              }
            } else {
              console.warn('[AuthContext] saved organization no longer valid:', savedOrgId);
              localStorage.removeItem(`vimob_active_organization_${userId}`);
            }
          } else if (!savedOrgId) {
            console.log('[AuthContext] multiple organizations found but none active/saved');
          }
        }
      } catch (err) {
        console.error('[AuthContext] Error in checkMultiOrg:', err);
        if (isInvalidSessionError(err)) {
          await recoverFromInvalidSession();
          return;
        }
      } finally {
        setOrganizationsLoaded(true);
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
    console.log('AuthProvider mounted');

    const clearAllStates = () => {
      console.log('Cleaning auth states');
      const currentUserId = userRef.current?.id;
      if (currentUserId) {
        localStorage.removeItem(`vimob_active_organization_${currentUserId}`);
      }

      setSession(null);
      setUser(null);
      setProfile(null);
      setActiveOrganization(null);
      setIsSuperAdmin(false);
      lastSuperAdminRef.current = false;
      setImpersonating(null);
      clearStoredImpersonation();
      setOrganizationsLoaded(false);
      setUserOrganizations([]);
      setIsInitializingOrg(false);
    };

    // Safety timeout: stop loading only if the auth flow is truly still stuck.
    const safetyTimeout = setTimeout(() => {
      const state = authStateRef.current;
      if (isMounted && (!state.authInitialized || !state.organizationsLoaded)) {
        console.warn('Auth safety timeout reached - forcing all loading states to complete');
        setLoading(false);
        setAuthInitialized(true);
        setOrganizationsLoaded(true);
        setIsInitializingOrg(false);
      }
    }, 15000);

    console.log('getSession started');
    supabase.auth.getSession().then(async ({ data: { session }, error }) => {
      if (!isMounted) return;
      console.log('getSession finished, session:', !!session, 'error:', error?.message);

      if (error || !session) {
        clearAllStates();
        setLoading(false);
        setAuthInitialized(true);
        setOrganizationsLoaded(true); // Must set this even without session
        console.log('Auth initialization complete naturally (no session)');
        return;
      }

      setSession(session);
      setUser(session.user);
      userRef.current = session.user;
      console.log('[AuthContext] login user loaded:', session.user.id);

      try {
        // Sequencial to ensure organizations are loaded before setting initialized.
        // These calls depend on our backend, so they must not leave a valid Supabase
        // session stuck if a secondary module/API is slow or temporarily unavailable.
        await withSoftTimeout(fetchProfileRef.current(session.user.id), false, 'initial fetchProfile');
        if (userRef.current) {
          await withSoftTimeout(checkMultiOrgRef.current(session.user.id), undefined, 'initial checkMultiOrg');
        }
      } catch (err) {
        console.error('[AuthContext] Error during initial auth data fetch:', err);
      } finally {
        if (isMounted) {
          setLoading(false);
          setAuthInitialized(true);
          setOrganizationsLoaded(true);
          console.log('[AuthContext] Auth initialization complete naturally');
        }
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (!isMounted) return;

        const authEvent = event as string;
        console.log('Auth event:', authEvent, 'Session:', !!session);

        // CRITICAL: Never use async/await with Supabase calls inside this callback.
        // Doing so deadlocks getSession() and other queries. Only update local state
        // synchronously here, and defer any Supabase calls via setTimeout(..., 0).

        // Initial session is handled by the getSession() block above
        if (authEvent === 'INITIAL_SESSION') {
          console.log('Ignoring INITIAL_SESSION event');
          return;
        }

        if (authEvent === 'SIGNED_OUT') {
          clearAllStates();
          setLoading(false);
          setAuthInitialized(true);
          setOrganizationsLoaded(true);

          if (isLoggingOutRef.current) {
            console.log('[AuthContext] SIGNED_OUT event ignored (explicit signOut in progress)');
            return;
          }

          // Don't redirect from public routes - just clear state
          const isPublicRoute = typeof window !== 'undefined' && [
            '/login',
            '/cadastro',
            '/reset-password',
            '/onboarding',
            '/convite',
            '/checkout',
            '/termos-de-uso',
            '/politica-de-privacidade'
          ].some(route => window.location.pathname.startsWith(route));

          if (isPublicRoute) {
            console.log('[AuthContext] SIGNED_OUT on public route, skipping redirect');
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
              Promise.all([
                withSoftTimeout(fetchProfileRef.current(session.user.id), false, 'signIn fetchProfile'),
                withSoftTimeout(checkMultiOrgRef.current(session.user.id, {
                  forceSelectorForMultiOrg: authEvent === 'SIGNED_IN',
                }), undefined, 'signIn checkMultiOrg'),
              ]).catch((error) => {
                console.error('[AuthContext] Deferred auth bootstrap failed:', error);
              }).finally(() => {
                if (!isMounted) return;
                setIsInitializingOrg(false);
                setLoading(false);
                setAuthInitialized(true);
                setOrganizationsLoaded(true);
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

    return () => {
      isMounted = false;
      clearTimeout(safetyTimeout);
      subscription.unsubscribe();
    };
  }, []);

  const signIn = async (email: string, password: string) => {
    const { error, data } = await supabase.auth.signInWithPassword({ email, password });
    let signedInIsSuperAdmin = false;

    if (!error && data.user) {
      signedInIsSuperAdmin = await withSoftTimeout(
        checkSuperAdmin(data.user.id),
        false,
        'signIn checkSuperAdmin',
        SIGN_IN_ROLE_TIMEOUT_MS,
      );

      void fetchProfile(data.user.id).catch((profileError) => {
        console.error('[AuthContext] Non-blocking signIn profile refresh failed:', profileError);
      });

      setTimeout(() => {
        logAuditAction('login', 'session', data.user.id, undefined, {
          email,
          login_at: new Date().toISOString()
        }).catch(console.error);
      }, 0);
    }

    return { error, isSuperAdmin: signedInIsSuperAdmin };
  };

  const signUp = async (email: string, password: string, name: string) => {
    const redirectUrl = `${window.location.origin}/`;

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: redirectUrl,
        data: { name }
      }
    });
    return { error };
  };

  const resetPassword = async (email: string) => {
    try {
      const redirectUrl = getPublicAppUrl(ROUTES.RESET_PASSWORD);
      console.log('[AuthContext] Resetting password for:', email, 'redirectUrl:', redirectUrl);

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

    // Tentar signOut global (invalida refresh token no servidor)
    try {
      await supabase.auth.signOut({ scope: 'global' });
    } catch (error) {
      console.log('Logout server-side falhou (sessão provavelmente já expirada):', error);
    }

    // Executar limpeza profunda e redirecionar para login com cache bust
    await performFullCacheClear({
      clearAuth: true,
      redirectTo: '/login',
      clearBrowserCaches: false
    });
  };

  const refreshProfile = async () => {
    if (user) {
      await fetchProfile(user.id);
    }
  };

  return (
    <AuthContext.Provider value={{
      user,
      session,
      profile,
      organization,
      loading,
      isSuperAdmin,
      impersonating,
      authInitialized,
      organizationsLoaded,
      isInitializingOrg,
      userOrganizations,
      signIn,
      signUp,
      signOut,
      resetPassword,
      refreshProfile,
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
