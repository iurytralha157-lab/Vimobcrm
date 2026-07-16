'use client';

import type { ReactNode } from 'react';
import { Loader2, ShieldX } from 'lucide-react';

import { AppLayout } from '@/components/shared/layout/AppLayout';
import { useUserPermissions } from '@/hooks/use-user-permissions';

interface PermissionBoundaryProps {
  children: ReactNode;
  title: string;
  permission?: string;
  anyOf?: readonly string[];
}

export function PermissionBoundary({
  children,
  title,
  permission,
  anyOf = [],
}: PermissionBoundaryProps) {
  const { hasPermission, isLoading } = useUserPermissions();
  const allowed = permission
    ? hasPermission(permission)
    : anyOf.some((key) => hasPermission(key));

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
            <p className="text-sm font-semibold text-foreground">Acesso nao disponivel</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Seu perfil nao possui permissao para acessar esta pagina.
            </p>
          </div>
        </div>
      </AppLayout>
    );
  }

  return children;
}
