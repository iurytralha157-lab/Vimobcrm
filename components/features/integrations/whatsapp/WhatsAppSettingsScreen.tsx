"use client";

import { LockKeyhole } from "lucide-react";

import { WhatsAppTab as WhatsAppIntegrationSettings } from "@/components/features/settings/WhatsAppTab";
import { AppLayout } from "@/components/shared/layout/AppLayout";
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
        <div className="flex w-full flex-col gap-4 pb-6">
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
              {access.canManageOwnSessions ? (
                <WhatsAppIntegrationSettings />
              ) : null}

              <WhatsAppSessionStatusPanel />
            </>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
