'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import NextImage from 'next/image';
import { useTheme } from 'next-themes';
import { useRouter } from 'next/navigation';
import { AlertCircle, ArrowRight, Building2, LogOut, Shield, User } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useSystemSettings } from '@/hooks/use-system-settings';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { VimobLoader } from '@/components/shared/loading';
import { BRAND_HEADER_LAYOUT, DEFAULT_AUTHENTICATED_ROUTE } from '@/config/constants';
import {
  createLoginPath,
  getPostLoginPathFromSearchParams,
} from '@/lib/auth/post-login-redirect';
import {
  ORGANIZATION_SWITCH_WAIT_MS,
  runBestEffortAuthOperation,
  shouldShowOrganizationSelectionLoader,
} from '@/lib/auth/frontend-auth-reliability';

const defaultOrganizationRedirectPath = DEFAULT_AUTHENTICATED_ROUTE;

function getCurrentRedirectPath() {
  if (typeof window === 'undefined') {
    return defaultOrganizationRedirectPath;
  }

  const params = new URLSearchParams(window.location.search);
  return getPostLoginPathFromSearchParams(params, defaultOrganizationRedirectPath);
}

function getInitials(name?: string | null) {
  const parts = (name || 'OR').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'OR';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function formatLastAccess(iso: string | null) {
  if (!iso) return null;

  try {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return null;

    return date.toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).replace(',', ' as');
  } catch {
    return null;
  }
}

export default function SelectOrganization() {
  const {
    user,
    loading,
    authInitialized,
    isSuperAdmin,
    switchOrganization,
    signOut,
    userOrganizations: rawOrganizations = [],
    organizationsLoaded,
    organizationsError,
    isInitializingOrg,
    refreshOrganizations,
  } = useAuth();
  const router = useRouter();
  const { resolvedTheme } = useTheme();
  const { data: systemSettings } = useSystemSettings();
  const [emptyStateReadyKey, setEmptyStateReadyKey] = useState<string | null>(null);
  const [pendingOrgId, setPendingOrgId] = useState<string | null>(null);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const [failedOrgId, setFailedOrgId] = useState<string | null>(null);
  const [failedLogoUrl, setFailedLogoUrl] = useState<string | null>(null);
  const autoRoutingOrgIdRef = useRef<string | null>(null);

  const organizations = useMemo(() => {
    const map = new Map<string, (typeof rawOrganizations)[number]>();
    rawOrganizations.forEach((org) => {
      if (!map.has(org.organization_id)) {
        map.set(org.organization_id, org);
      }
    });
    return Array.from(map.values());
  }, [rawOrganizations]);

  const logoUrl = useMemo(() => {
    if (!systemSettings) return null;
    return resolvedTheme === 'dark'
      ? systemSettings.logo_url_dark || systemSettings.logo_url_light
      : systemSettings.logo_url_light || systemSettings.logo_url_dark;
  }, [resolvedTheme, systemSettings]);

  const defaultLogoUrl = resolvedTheme === 'dark'
    ? '/images/logo-white.png'
    : '/images/logo-black.png';
  const displayLogoUrl = logoUrl && logoUrl !== failedLogoUrl
    ? logoUrl
    : defaultLogoUrl;
  const isConfiguredLogo = Boolean(logoUrl && displayLogoUrl === logoUrl);

  useEffect(() => {
    if (!loading && authInitialized && !user) {
      router.replace(createLoginPath(
        getCurrentRedirectPath(),
        defaultOrganizationRedirectPath,
      ));
    }
  }, [authInitialized, loading, router, user]);

  const emptyStateKey = `${organizationsLoaded}:${organizations.length}`;
  const showEmptyState = emptyStateReadyKey === emptyStateKey
    && organizationsLoaded
    && !organizationsError
    && organizations.length === 0;

  useEffect(() => {
    if (!organizationsLoaded || organizations.length !== 0) return;
    const timer = setTimeout(() => setEmptyStateReadyKey(emptyStateKey), 500);
    return () => clearTimeout(timer);
  }, [emptyStateKey, organizations.length, organizationsLoaded]);

  const shouldAutoRouteSingleOrg =
    organizationsLoaded
    && !organizationsError
    && !loading
    && !isInitializingOrg
    && pendingOrgId === null
    && organizations.length === 1;

  useEffect(() => {
    if (!shouldAutoRouteSingleOrg || selectionError) return;

    const onlyOrgId = organizations[0]?.organization_id;
    if (!onlyOrgId || autoRoutingOrgIdRef.current === onlyOrgId) return;

    autoRoutingOrgIdRef.current = onlyOrgId;
    void (async () => {
      const result = await runBestEffortAuthOperation(
        () => switchOrganization(onlyOrgId),
        ORGANIZATION_SWITCH_WAIT_MS,
      );

      if (result === 'completed') {
        router.replace(getCurrentRedirectPath());
        return;
      }

      autoRoutingOrgIdRef.current = null;
      setFailedOrgId(onlyOrgId);
      setSelectionError('Não foi possível abrir esta organização. Tente novamente.');
    })();
  }, [organizations, router, selectionError, shouldAutoRouteSingleOrg, switchOrganization]);

  async function handleSelectOrg(orgId: string) {
    setSelectionError(null);
    setFailedOrgId(null);
    setPendingOrgId(orgId);

    try {
      const result = await runBestEffortAuthOperation(
        () => switchOrganization(orgId),
        ORGANIZATION_SWITCH_WAIT_MS,
      );

      if (result === 'completed') {
        router.replace(getCurrentRedirectPath());
        return;
      }

      setFailedOrgId(orgId);
      setSelectionError('Não foi possível abrir esta organização. Tente novamente.');
    } finally {
      setPendingOrgId(null);
    }
  }

  const showOrganizationLoader = shouldShowOrganizationSelectionLoader({
    authLoading: loading,
    hasSelectionError: selectionError !== null,
    isInitializingOrganization: isInitializingOrg,
    organizationsLoaded,
    shouldAutoRouteSingleOrganization: shouldAutoRouteSingleOrg,
  });
  const visibleSelectionError = selectionError || organizationsError;

  if (showOrganizationLoader) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--app-background)] text-[var(--app-text-primary)]">
        <div className="flex flex-col items-center gap-4">
          <VimobLoader size="lg" label="Carregando ambiente..." />
          <p className="animate-pulse text-[12px] font-light text-[var(--app-text-tertiary)]">
            Carregando seu ambiente...
          </p>
        </div>
      </div>
    );
  }

  if (organizationsError && organizations.length === 0) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-[var(--app-background)] p-4 text-center text-[var(--app-text-primary)]">
        <div className="grid h-12 w-12 place-items-center rounded-[8px] bg-destructive/10 text-destructive">
          <AlertCircle className="h-6 w-6" strokeWidth={1.35} />
        </div>
        <h2 className="mt-5 text-[16px] font-normal">Não foi possível carregar os acessos</h2>
        <p className="mt-2 max-w-sm text-[12px] font-light leading-[18px] text-[var(--app-text-tertiary)]">
          {organizationsError}
        </p>
        <div className="mt-6 flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={() => void refreshOrganizations()}
            className="h-10 rounded-[6px] bg-primary/50 px-5 text-[12px] font-light text-primary-foreground transition-colors hover:bg-primary"
          >
            Tentar novamente
          </button>
          <button
            type="button"
            onClick={() => void signOut()}
            className="h-10 rounded-[6px] bg-[var(--app-surface-soft)] px-5 text-[12px] font-light text-[var(--app-text-secondary)] transition-colors hover:bg-[var(--app-surface-hover)]"
          >
            Sair
          </button>
        </div>
      </div>
    );
  }

  if (showEmptyState && organizations.length === 0) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-[var(--app-background)] p-4 text-center text-[var(--app-text-primary)]">
        <div className="flex h-12 w-12 items-center justify-center rounded-[8px] bg-[var(--app-surface-soft)] text-[var(--app-text-tertiary)]">
          <Building2 className="h-6 w-6" strokeWidth={1.35} />
        </div>
        <h2 className="mt-5 text-[16px] font-normal text-[var(--app-text-primary)]">
          Nenhuma organização encontrada
        </h2>
        <p className="mt-2 max-w-xs text-[12px] font-light leading-[18px] text-[var(--app-text-tertiary)]">
          Você não possui acesso a nenhuma organização ativa no momento.
        </p>

        <div className="mt-5 flex max-w-sm items-start gap-2 rounded-[8px] bg-destructive/10 px-4 py-3 text-left text-[12px] font-light leading-[18px] text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.5} />
          <span>
            Erro: este usuário não está vinculado a uma organização ativa. Peça ao administrador para revisar o convite ou liberar o acesso.
          </span>
        </div>

        <div className="mt-8 flex flex-col gap-2">
          <button
            onClick={() => window.location.reload()}
            className="h-10 rounded-[6px] bg-primary/50 px-5 text-[12px] font-light text-primary-foreground transition-colors hover:bg-primary"
          >
            Tentar novamente
          </button>

          {isSuperAdmin && (
            <button
              onClick={() => router.push('/admin')}
              className="h-10 text-[12px] font-light text-[var(--app-text-tertiary)] transition-colors hover:text-primary"
            >
              Acessar Painel Super Admin
            </button>
          )}

          <button
            onClick={signOut}
            className="h-10 text-[12px] font-light text-[var(--app-text-tertiary)] transition-colors hover:text-[var(--app-text-primary)]"
          >
            Sair
          </button>
        </div>
      </div>
    );
  }

  if (organizations.length === 0) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--app-background)] text-[var(--app-text-primary)]">
        <div className="flex flex-col items-center gap-4">
          <VimobLoader size="lg" label="Verificando acessos..." />
          <p className="animate-pulse text-[12px] font-light text-[var(--app-text-tertiary)]">
            Verificando acessos...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell min-h-screen bg-[var(--app-background)] text-[var(--app-text-primary)]">
      <header className="sticky top-0 z-30 bg-[var(--app-background)]">
        <div
          className="mx-auto flex h-[72px] w-full items-center justify-between px-4 sm:px-6 lg:px-8"
          style={{ maxWidth: BRAND_HEADER_LAYOUT.maxWidth }}
        >
          <div className="inline-flex min-h-11 w-fit items-center">
            <NextImage
              src={displayLogoUrl}
              alt="Vimob"
              width={1228}
              height={429}
              className="h-auto w-auto object-contain"
              style={{ width: BRAND_HEADER_LAYOUT.logoWidth }}
              preload
              unoptimized={isConfiguredLogo}
              onError={() => {
                if (isConfiguredLogo && logoUrl) {
                  setFailedLogoUrl(logoUrl);
                }
              }}
            />
          </div>
          <button
            type="button"
            onClick={signOut}
            className="group inline-flex h-10 items-center gap-2 rounded-[6px] bg-[var(--app-surface-solid)] px-4 text-xs font-light text-[var(--app-text-secondary)] outline-none transition-colors hover:bg-primary hover:text-primary-foreground focus-visible:ring-2 focus-visible:ring-primary/30"
          >
            <LogOut className="h-4 w-4 text-primary/70 transition-colors group-hover:text-primary-foreground" strokeWidth={1.6} />
            Sair
          </button>
        </div>
      </header>

      <main className="mx-auto flex min-h-[calc(100vh-72px)] w-full max-w-[1040px] flex-col px-4 pb-8 pt-5 sm:px-6 sm:pb-10 sm:pt-7 lg:px-8">
        <div className="flex flex-1 flex-col justify-center py-7 sm:py-9">
          <div className="mx-auto w-full max-w-3xl text-center">
            <h1 className="text-[16px] font-normal text-[var(--app-text-primary)]">
              Selecione a organização
            </h1>
            <p className="mx-auto mt-2 max-w-xl text-[12px] font-light leading-[18px] text-[var(--app-text-tertiary)]">
              Você tem acesso a múltiplas organizações. Escolha o ambiente para continuar.
            </p>
          </div>

          {visibleSelectionError ? (
            <div
              role="alert"
              className="mx-auto mt-6 flex w-full max-w-3xl flex-col items-center gap-3 rounded-[8px] bg-destructive/10 px-4 py-3 text-center text-[12px] font-light leading-[18px] text-destructive sm:flex-row sm:justify-between sm:text-left"
            >
              <span className="flex items-start gap-2">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.5} />
                {visibleSelectionError}
              </span>
              <button
                type="button"
                onClick={() => {
                  if (failedOrgId) {
                    void handleSelectOrg(failedOrgId);
                    return;
                  }
                  void refreshOrganizations();
                }}
                disabled={pendingOrgId !== null}
                className="h-9 shrink-0 rounded-[6px] bg-primary/50 px-4 text-[12px] font-light text-primary-foreground transition-colors hover:bg-primary disabled:cursor-wait disabled:opacity-60"
              >
                Tentar novamente
              </button>
            </div>
          ) : null}

          <div className="mt-8 grid w-full grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {organizations.map((org) => {
              const name = org.organization_name || 'Organização';
              const lastAccess = formatLastAccess(org.last_accessed_at);
              const isAdmin = org.member_role === 'admin' || org.member_role === 'super_admin';
              const isPending = pendingOrgId === org.organization_id;

              return (
                <button
                  key={org.organization_id}
                  type="button"
                  onClick={() => handleSelectOrg(org.organization_id)}
                  disabled={pendingOrgId !== null}
                  aria-busy={isPending}
                  className="group flex min-h-[124px] flex-col rounded-[8px] border-0 bg-[var(--app-surface-solid)] px-5 py-4 text-left shadow-none transition-colors hover:bg-[var(--app-surface-hover)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-vimob-accent/70 disabled:cursor-wait disabled:opacity-70"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <Avatar className="h-12 w-12 shrink-0 rounded-[8px] bg-[var(--app-surface-soft)]">
                      {org.organization_logo ? (
                        <AvatarImage src={org.organization_logo} alt="" className="object-contain" />
                      ) : null}
                      <AvatarFallback className="rounded-[8px] bg-primary/50 text-[12px] font-light text-primary-foreground transition-colors group-hover:bg-primary group-focus-visible:bg-primary">
                        {getInitials(name)}
                      </AvatarFallback>
                    </Avatar>

                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[14px] font-normal text-[var(--app-text-primary)]">
                        {name}
                      </p>
                      <p className="mt-1 truncate text-[12px] font-light text-[var(--app-text-tertiary)]">
                        {lastAccess ? `Último acesso ${lastAccess}` : 'Primeiro acesso'}
                      </p>
                    </div>
                  </div>

                  <div className="mt-3 flex items-center justify-between gap-3">
                    <span className="inline-flex h-7 items-center gap-2 rounded-[6px] bg-[var(--app-surface-soft)] px-2.5 text-[12px] font-light text-[var(--app-text-secondary)]">
                      {isAdmin ? (
                        <>
                          <Shield className="h-3.5 w-3.5 text-primary" strokeWidth={1.35} /> Administrador
                        </>
                      ) : (
                        <>
                          <User className="h-3.5 w-3.5 text-primary" strokeWidth={1.35} /> Usuário
                        </>
                      )}
                    </span>
                    <span className="flex items-center gap-2">
                      {isPending ? (
                        <span role="status" className="text-[12px] font-light text-primary">
                          Entrando...
                        </span>
                      ) : null}
                      <span className="inline-flex h-8 w-8 items-center justify-center rounded-[6px] bg-primary/50 text-primary-foreground transition-colors group-hover:bg-primary group-focus-visible:bg-primary">
                        <ArrowRight className="h-4 w-4" strokeWidth={1.35} />
                      </span>
                    </span>
                  </div>
                </button>
              );
            })}
          </div>

          {isSuperAdmin && (
            <button
              onClick={() => router.push('/admin')}
              className="mx-auto mt-8 block text-center text-[12px] font-light text-[var(--app-text-tertiary)] transition-colors hover:text-primary"
            >
              Acessar Painel Super Admin
            </button>
          )}
        </div>
      </main>
    </div>
  );
}
