'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import NextImage from 'next/image';
import { useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';
import { ArrowRight, Building2, LogOut, Shield, User } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useSystemSettings } from '@/hooks/use-system-settings';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { VimobLoader } from '@/components/shared/loading';

const defaultOrganizationRedirectPath = '/dashboard';
const blockedOrganizationRedirectPrefixes = [
  '/login',
  '/cadastro',
  '/reset-password',
  '/onboarding',
  '/select-organization',
];

function getSafeRedirectPath(value?: string | null) {
  if (!value || !value.startsWith('/') || value.startsWith('//')) {
    return defaultOrganizationRedirectPath;
  }

  if (blockedOrganizationRedirectPrefixes.some((prefix) => value.startsWith(prefix))) {
    return defaultOrganizationRedirectPath;
  }

  return value;
}

function getCurrentRedirectPath() {
  if (typeof window === 'undefined') {
    return defaultOrganizationRedirectPath;
  }

  const params = new URLSearchParams(window.location.search);
  return getSafeRedirectPath(params.get('redirectTo'));
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
    isInitializingOrg,
  } = useAuth();
  const router = useRouter();
  const { data: systemSettings } = useSystemSettings();
  const { resolvedTheme } = useTheme();
  const [emptyStateReadyKey, setEmptyStateReadyKey] = useState<string | null>(null);
  const [pendingOrgId, setPendingOrgId] = useState<string | null>(null);
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
  }, [systemSettings, resolvedTheme]);

  useEffect(() => {
    if (!loading && authInitialized && !user) {
      router.replace('/login');
    }
  }, [authInitialized, loading, router, user]);

  const emptyStateKey = `${organizationsLoaded}:${organizations.length}`;
  const showEmptyState = emptyStateReadyKey === emptyStateKey && organizationsLoaded && organizations.length === 0;

  useEffect(() => {
    if (!organizationsLoaded || organizations.length !== 0) return;
    const timer = setTimeout(() => setEmptyStateReadyKey(emptyStateKey), 500);
    return () => clearTimeout(timer);
  }, [emptyStateKey, organizations.length, organizationsLoaded]);

  const shouldAutoRouteSingleOrg =
    organizationsLoaded && !loading && !isInitializingOrg && organizations.length === 1;

  useEffect(() => {
    if (!shouldAutoRouteSingleOrg) return;

    const onlyOrgId = organizations[0]?.organization_id;
    if (!onlyOrgId || autoRoutingOrgIdRef.current === onlyOrgId) return;

    autoRoutingOrgIdRef.current = onlyOrgId;
    void switchOrganization(onlyOrgId)
      .then(() => {
        router.replace(getCurrentRedirectPath());
      })
      .catch(() => {
        autoRoutingOrgIdRef.current = null;
      });
  }, [organizations, router, shouldAutoRouteSingleOrg, switchOrganization]);

  async function handleSelectOrg(orgId: string) {
    setPendingOrgId(orgId);
    try {
      await switchOrganization(orgId);
      router.replace(getCurrentRedirectPath());
    } finally {
      setPendingOrgId(null);
    }
  }

  if (loading || !organizationsLoaded || isInitializingOrg || shouldAutoRouteSingleOrg) {
    return (
      <div className="dark flex min-h-screen items-center justify-center bg-[#090909]">
        <div className="flex flex-col items-center gap-4">
          <VimobLoader size="lg" label="Carregando ambiente..." />
          <p className="animate-pulse text-sm font-extralight tracking-wide text-white/48">
            Carregando seu ambiente...
          </p>
        </div>
      </div>
    );
  }

  if (showEmptyState && organizations.length === 0) {
    return (
      <div className="dark flex min-h-screen flex-col items-center justify-center bg-[#090909] p-4 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-[8px] bg-white/[0.055] text-white/48">
          <Building2 className="h-6 w-6" strokeWidth={1.35} />
        </div>
        <h2 className="mt-5 text-xl font-extralight tracking-wide text-white">
          Nenhuma organização encontrada
        </h2>
        <p className="mt-2 max-w-xs text-sm font-extralight leading-6 tracking-wide text-white/48">
          Você não possui acesso a nenhuma organização ativa no momento.
        </p>

        <div className="mt-8 flex flex-col gap-2">
          <button
            onClick={() => window.location.reload()}
            className="h-10 rounded-[6px] bg-[#FF4529] px-5 text-sm font-light text-white transition-colors hover:bg-[#ff583f]"
          >
            Tentar novamente
          </button>

          {isSuperAdmin && (
            <button
              onClick={() => router.push('/admin')}
              className="h-10 text-sm font-extralight tracking-wide text-white/48 transition-colors hover:text-[#FF4529]"
            >
              Acessar Painel Super Admin
            </button>
          )}

          <button
            onClick={signOut}
            className="h-10 text-sm font-extralight tracking-wide text-white/48 transition-colors hover:text-white"
          >
            Sair
          </button>
        </div>
      </div>
    );
  }

  if (organizations.length === 0) {
    return (
      <div className="dark flex min-h-screen items-center justify-center bg-[#090909]">
        <div className="flex flex-col items-center gap-4">
          <VimobLoader size="lg" label="Verificando acessos..." />
          <p className="animate-pulse text-sm font-extralight tracking-wide text-white/48">
            Verificando acessos...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="dark min-h-screen bg-[#090909] px-5 py-8 text-white sm:px-8">
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-6xl flex-col">
        <div className="flex items-center justify-end">
          <button
            onClick={signOut}
            className="inline-flex h-9 items-center gap-2 rounded-[6px] bg-white/[0.055] px-3 text-xs font-extralight tracking-wide text-white/70 transition-colors hover:bg-white/[0.085] hover:text-white"
          >
            <LogOut className="h-3.5 w-3.5" strokeWidth={1.35} />
            Sair
          </button>
        </div>

        <div className="flex flex-1 flex-col justify-center py-10">
          <div className="mx-auto w-full max-w-3xl text-center">
            {logoUrl ? (
              <NextImage
                src={logoUrl}
                alt="Vimob"
                width={180}
                height={48}
                className="mx-auto h-auto w-[136px] object-contain"
                unoptimized
              />
            ) : (
              <NextImage
                src="/images/logo-white.png"
                alt="Vimob"
                width={1228}
                height={429}
                className="mx-auto h-auto w-[136px]"
                priority
              />
            )}
            <h1 className="mt-7 text-[28px] font-extralight tracking-wide text-white sm:text-[34px]">
              Selecione a organização
            </h1>
            <p className="mx-auto mt-2 max-w-xl text-sm font-extralight leading-6 tracking-wide text-white/48">
              Você tem acesso a múltiplas organizações. Escolha o ambiente para continuar.
            </p>
          </div>

          <div className="mx-auto mt-8 grid w-full max-w-5xl grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
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
                  className="group flex min-h-[148px] flex-col rounded-[8px] bg-[#121212] p-5 text-left transition-colors hover:bg-[#171717] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#FF4529]/70 disabled:cursor-wait disabled:opacity-70"
                >
                  <div className="flex items-start justify-between gap-4">
                    <Avatar className="h-12 w-12 rounded-full bg-black/40">
                      {org.organization_logo ? (
                        <AvatarImage src={org.organization_logo} className="object-contain" />
                      ) : null}
                      <AvatarFallback className="rounded-full bg-[#FF4529] text-sm font-light tracking-wide text-white">
                        {getInitials(name)}
                      </AvatarFallback>
                    </Avatar>

                    <span className="inline-flex h-8 w-8 items-center justify-center rounded-[6px] bg-white/[0.045] text-white/38 transition-colors group-hover:bg-[#FF4529] group-hover:text-white">
                      <ArrowRight className="h-4 w-4" strokeWidth={1.35} />
                    </span>
                  </div>

                  <div className="mt-5 min-w-0">
                    <p className="truncate text-sm font-light tracking-wide text-white">
                      {name}
                    </p>
                    <p className="mt-1 text-xs font-extralight tracking-wide text-white/38">
                      {lastAccess ? `Último acesso ${lastAccess}` : 'Primeiro acesso'}
                    </p>
                  </div>

                  <div className="mt-auto flex items-center justify-between gap-3 pt-5">
                    <span className="inline-flex h-7 items-center gap-2 rounded-[6px] bg-white/[0.055] px-2.5 text-xs font-extralight tracking-wide text-white/68">
                      {isAdmin ? (
                        <>
                          <Shield className="h-3.5 w-3.5 text-[#FF4529]" strokeWidth={1.35} /> Administrador
                        </>
                      ) : (
                        <>
                          <User className="h-3.5 w-3.5 text-[#FF4529]" strokeWidth={1.35} /> Usuário
                        </>
                      )}
                    </span>
                    {isPending ? (
                      <span className="text-xs font-extralight tracking-wide text-[#FF4529]">
                        Entrando...
                      </span>
                    ) : null}
                  </div>
                </button>
              );
            })}
          </div>

          {isSuperAdmin && (
            <button
              onClick={() => router.push('/admin')}
              className="mx-auto mt-8 block text-center text-sm font-extralight tracking-wide text-white/42 transition-colors hover:text-[#FF4529]"
            >
              Acessar Painel Super Admin
            </button>
          )}

          <div className="mx-auto mt-10 h-px w-full max-w-5xl bg-white/[0.045]" />
        </div>
      </div>
    </div>
  );
}
