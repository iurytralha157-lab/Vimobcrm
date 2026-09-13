"use client";

import Link from "next/link";
import { ArrowLeft, LockKeyhole, ShieldCheck, Smartphone } from "lucide-react";

import { WhatsAppTab as WhatsAppIntegrationSettings } from "@/components/features/settings/WhatsAppTab";
import { AppLayout } from "@/components/shared/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/contexts/AuthContext";
import { useOrganizationModules } from "@/hooks/use-organization-modules";
import { useUserPermissions } from "@/hooks/use-user-permissions";
import { getWhatsAppIntegrationAccess } from "@/lib/access/whatsapp-integration";
import { isTenantContextForOrganization } from "@/lib/access/tenant-navigation";

import { WhatsAppSessionStatusPanel } from "./WhatsAppSessionStatusPanel";

function RestrictedState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <section className="app-card flex items-start gap-3 p-4">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[6px] bg-[var(--app-surface-soft)] text-[var(--app-text-tertiary)]">
        <LockKeyhole className="h-5 w-5" aria-hidden="true" />
      </div>
      <div>
        <h2 className="app-card-title">{title}</h2>
        <p className="mt-1 text-sm text-[var(--app-text-secondary)]">
          {description}
        </p>
      </div>
    </section>
  );
}

export default function WhatsAppSettingsScreen() {
  const {
    activeOrganization,
    profile,
    isSuperAdmin,
    tenantContext,
    userOrganizations,
    loading,
    organizationsLoaded,
  } = useAuth();
  const {
    hasPermission,
    isLoading: permissionsLoading,
  } = useUserPermissions();
  const { hasModule, isLoading: modulesLoading } = useOrganizationModules();
  const organizationId = activeOrganization.organizationId;
  const activeMemberRole = userOrganizations.find(
    (membership) => membership.organization_id === organizationId,
  )?.member_role;
  const hasCurrentTenantContext = isTenantContextForOrganization(
    organizationId,
    tenantContext,
  );
  const access = getWhatsAppIntegrationAccess({
    hasModule: Boolean(organizationId) && hasModule("whatsapp"),
    isSuperAdmin,
    memberRole: activeMemberRole,
    isTeamLeader:
      hasCurrentTenantContext && Boolean(tenantContext?.isTeamLeader),
    hasViewPermission: hasPermission("whatsapp_view"),
    hasManagePermission: hasPermission("whatsapp_manage"),
  });
  const accessLoading =
    loading ||
    !organizationsLoaded ||
    permissionsLoading ||
    modulesLoading ||
    !profile;

  return (
    <AppLayout title="WhatsApp" borderless disableMainScroll>
      <div className="flex h-full min-h-0 w-full min-w-0 flex-col overflow-y-auto sm:pt-2">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 pb-6">
          <header className="app-card flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[7px] bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                <Smartphone className="h-5 w-5" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <h1 className="text-base font-medium text-[var(--app-text-primary)]">
                  Integração com WhatsApp
                </h1>
                <p className="mt-1 text-xs leading-5 text-[var(--app-text-secondary)]">
                  Acompanhe a conexão dos números no seu escopo e gerencie somente as suas próprias sessões.
                </p>
              </div>
            </div>
            <Button asChild variant="outline" size="sm" className="h-8 gap-1.5 rounded-[6px]">
              <Link href="/settings?tab=integrations">
                <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
                Integrações
              </Link>
            </Button>
          </header>

          {accessLoading ? (
            <div className="space-y-3" aria-label="Carregando integração WhatsApp">
              <Skeleton className="h-52 w-full rounded-[8px]" />
              <Skeleton className="h-72 w-full rounded-[8px]" />
            </div>
          ) : !organizationId ? (
            <RestrictedState
              title="Selecione uma organização"
              description="Escolha a organização cujas conexões WhatsApp você precisa acompanhar."
            />
          ) : !access.canViewStatuses ? (
            <RestrictedState
              title="Acesso restrito"
              description="O módulo WhatsApp e a permissão de visualização são necessários. Líderes veem somente os usuários das equipes sob sua responsabilidade."
            />
          ) : (
            <>
              <WhatsAppSessionStatusPanel />

              {access.canManageOwnSessions ? (
                <section className="space-y-3">
                  <div className="flex items-start gap-2 px-0.5">
                    <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[var(--app-text-tertiary)]" aria-hidden="true" />
                    <div>
                      <h2 className="text-sm font-medium text-[var(--app-text-primary)]">
                        Minhas conexões
                      </h2>
                      <p className="mt-0.5 text-xs text-[var(--app-text-secondary)]">
                        Criar, reconectar, desconectar e apagar continuam limitados ao responsável pelo número. O remetente de notificações só pode ser escolhido por owner ou administrador.
                      </p>
                    </div>
                  </div>
                  <WhatsAppIntegrationSettings />
                </section>
              ) : null}
            </>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
