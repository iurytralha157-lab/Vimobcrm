"use client";

import { LockKeyhole } from "lucide-react";
import { AppLayout } from "@/components/shared/layout/AppLayout";
import { MetaIntegrationSettings } from "@/components/features/integrations/MetaIntegrationSettings";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/contexts/AuthContext";
import { canManageOrganization } from "@/lib/access/organization";
import { useUserPermissions } from "@/hooks/use-user-permissions";

export default function MetaSettingsScreen() {
  const {
    profile,
    organization,
    isSuperAdmin,
    userOrganizations,
    loading,
    organizationsLoaded,
  } = useAuth();
  const { hasPermission, isLoading: permissionsLoading } = useUserPermissions();
  const activeOrganizationId = organization?.id || profile?.organization_id;
  const activeMemberRole = userOrganizations.find(
    (item) => item.organization_id === activeOrganizationId,
  )?.member_role;
  const canManageMeta =
    Boolean(activeOrganizationId) &&
    (canManageOrganization({ isSuperAdmin, memberRole: activeMemberRole }) ||
      hasPermission("settings_integrations"));
  const accessLoading =
    loading || !organizationsLoaded || permissionsLoading || !profile;

  return (
    <AppLayout title="Facebook / Meta" borderless>
      <div className="mx-auto w-full max-w-[1280px] space-y-4 pb-8 sm:pt-2">
        {accessLoading ? (
          <div className="space-y-3" aria-label="Carregando integração Meta">
            <Skeleton className="h-16 w-full rounded-[8px]" />
            <Skeleton className="h-12 w-full rounded-[8px]" />
            <Skeleton className="h-72 w-full rounded-[8px]" />
          </div>
        ) : !activeOrganizationId ? (
          <section className="app-card flex items-start gap-3 p-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[6px] bg-[var(--app-surface-soft)] text-[var(--app-text-tertiary)]">
              <LockKeyhole className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <h2 className="app-card-title">Selecione uma organização</h2>
              <p className="mt-1 text-sm text-[var(--app-text-secondary)]">
                Escolha a organização que terá as contas, formulários e o CRM Dataset configurados.
              </p>
            </div>
          </section>
        ) : canManageMeta ? (
          <MetaIntegrationSettings />
        ) : (
          <section className="app-card flex items-start gap-3 p-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[6px] bg-[var(--app-surface-soft)] text-[var(--app-text-tertiary)]">
              <LockKeyhole className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <h2 className="app-card-title">Acesso restrito</h2>
              <p className="mt-1 text-sm text-[var(--app-text-secondary)]">
                Apenas administradores ou usuários com permissão de integrações podem gerenciar o Meta.
              </p>
            </div>
          </section>
        )}
      </div>
    </AppLayout>
  );
}
