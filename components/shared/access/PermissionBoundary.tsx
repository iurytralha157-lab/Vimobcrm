'use client';

import type { ReactNode } from 'react';
import { Loader2, ShieldX } from 'lucide-react';

import { AppLayout } from '@/components/shared/layout/AppLayout';
import type { SystemModuleKey } from '@/config/constants';
import { useOrganizationModules } from '@/hooks/use-organization-modules';
import { useUserPermissions } from '@/hooks/use-user-permissions';

interface PermissionBoundaryProps {
  children: ReactNode;
  title: string;
  module?: SystemModuleKey;
  permission?: string;
  anyOf?: readonly string[];
}

export function PermissionBoundary({
  children,
  title,
  module,
  permission,
  anyOf = [],
}: PermissionBoundaryProps) {
  const { hasPermission, isLoading: permissionsLoading } = useUserPermissions();
  const { hasModule, isLoading: modulesLoading } = useOrganizationModules();
  const permissionAllowed = permission
    ? hasPermission(permission)
    : anyOf.length === 0 || anyOf.some((key) => hasPermission(key));
  const moduleAllowed = !module || hasModule(module);
  const isLoading = permissionsLoading || Boolean(module && modulesLoading);
  const allowed = permissionAllowed && moduleAllowed;

  if (isLoading) {
    return (
      <AppLayout title={title}>
        <div className="flex min-h-[50vh] items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </AppLayout>
    );
  }

  if (!allowed) {
    return (
      <AppLayout title={title}>
        <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-center">
          <span className="flex h-11 w-11 items-center justify-center rounded-[8px] bg-muted text-muted-foreground">
            <ShieldX className="h-5 w-5" />
          </span>
          <div>
            <p className="text-sm font-normal text-foreground">Acesso nao disponivel</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Seu perfil ou plano nao possui acesso a esta pagina.
            </p>
          </div>
        </div>
      </AppLayout>
    );
  }

  return children;
}
