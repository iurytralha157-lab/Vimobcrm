"use client";

import { useState, useMemo } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { MoreHorizontal, Plus } from 'lucide-react';

import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { useOrganizationModules } from '@/hooks/use-organization-modules';
import { useUserPermissions } from '@/hooks/use-user-permissions';
import { useLocationHash } from '@/hooks/use-location-hash';
import { MobileSidebar } from './MobileSidebar';
import { isBillingAccessBlocked } from '@/lib/billing-access';
import { canUseFinancialModule } from '@/lib/financial-access';
import { canManageOrganization } from '@/lib/access/organization';
import {
  filterNavigationItems,
  isNavigationPathActive,
  resolveMobileFabAction,
  selectMobileNavigationItems,
} from '@/lib/access/navigation';
import {
  APP_NAVIGATION_ITEMS,
  BILLING_NAVIGATION_ITEM,
  type AppNavigationItem,
} from '@/config/navigation';
import { getNavigationIcon } from './navigation-icons';

const CreateLeadDialog = dynamic(
  () => import('@/components/features/leads/CreateLeadDialog').then((module) => module.CreateLeadDialog),
  { ssr: false },
);

export function MobileBottomNav() {
  const [createLeadOpen, setCreateLeadOpen] = useState(false);
  const router = useRouter();
  const pathname = usePathname() || '';
  const searchParams = useSearchParams();
  const currentHash = useLocationHash();
  const { profile, isSuperAdmin, organization, tenantContext, userOrganizations } = useAuth();
  const { t } = useLanguage();
  const { hasModule, isLoading: modulesLoading } = useOrganizationModules();
  const { hasPermission, isLoading: permissionsLoading } = useUserPermissions();
  const isBillingBlocked = !isSuperAdmin && isBillingAccessBlocked(organization);
  const canAccessFinancialModule = canUseFinancialModule(organization);
  const activeOrganizationId = organization?.id || profile?.organization_id;
  const activeMembership = userOrganizations.find((org) => org.organization_id === activeOrganizationId);
  const fallbackMemberRole = tenantContext && tenantContext.organizationId === activeOrganizationId
    ? tenantContext.memberRole
    : undefined;
  const activeMemberRole = activeMembership?.member_role || fallbackMemberRole;
  const isTeamLeader = Boolean(tenantContext?.isTeamLeader);
  const canManageCurrentOrganization = canManageOrganization({ isSuperAdmin, memberRole: activeMemberRole });
  const navigationLoading = modulesLoading || permissionsLoading;

  const tabs = useMemo(() => {
    if (navigationLoading) {
      return ['loading', 'loading', 'loading', 'loading', 'loading'] as const;
    }

    if (isBillingBlocked) {
      return [BILLING_NAVIGATION_ITEM];
    }

    const authorizedItems = filterNavigationItems(APP_NAVIGATION_ITEMS, {
      canAccessAdminItems: canManageCurrentOrganization,
      canAccessFinancialModule,
      hasModule,
      hasPermission,
      isSuperAdmin,
      isTeamLeader,
    });
    const { primary, secondary } = selectMobileNavigationItems(authorizedItems);
    const result: (AppNavigationItem | 'fab' | 'more' | 'loading')[] = [...primary, 'fab'];
    if (secondary) result.push(secondary);
    result.push('more');
    return result;
  }, [canAccessFinancialModule, canManageCurrentOrganization, hasModule, hasPermission, isBillingBlocked, isSuperAdmin, isTeamLeader, navigationLoading]);

  const isActive = (path: string) => {
    return isNavigationPathActive(path, pathname, searchParams, { parent: true, currentHash });
  };

  const getLabel = (labelKey: string): string => {
    return (t.nav as Record<string, string>)[labelKey] || labelKey;
  };

  const managementTab = searchParams.get('tab');
  const fabAction = resolveMobileFabAction({
    pathname,
    tab: managementTab,
    isBillingBlocked,
    hasPermission,
  });
  const fabLabel = fabAction ? {
    lead: 'Novo lead',
    property: 'Novo imóvel',
    schedule: 'Novo agendamento',
    team: 'Nova equipe',
    user: 'Novo usuário',
  }[fabAction] : '';

  const handleFabClick = () => {
    if (fabAction === 'property') {
      router.push('/properties/new');
      return;
    }

    if (fabAction === 'schedule') {
      window.dispatchEvent(new CustomEvent('vimob:mobile-create-agenda'));
      return;
    }

    if (fabAction === 'team') {
      window.dispatchEvent(new CustomEvent('vimob:mobile-create-team'));
      return;
    }

    if (fabAction === 'user') {
      window.dispatchEvent(new CustomEvent('vimob:mobile-create-user'));
      return;
    }

    if (fabAction === 'lead') setCreateLeadOpen(true);
  };

  return (
    <>
      <nav
        className="app-mobile-bottom-nav fixed bottom-0 left-0 right-0 z-50 border-t border-[var(--app-border)] bg-[var(--app-sidebar)] pb-[env(safe-area-inset-bottom)]"
        aria-busy={navigationLoading}
      >
        <div className="flex items-end justify-around px-1 h-16 py-[4px] pb-[10px]">
          {tabs.map((tab, index) => {
            if (tab === 'loading') {
              return (
                <div
                  key={`loading-${index}`}
                  className="flex min-h-12 min-w-[56px] items-center justify-center px-1 py-2"
                  aria-hidden="true"
                >
                  <div className="h-8 w-8 animate-pulse rounded-[6px] bg-[var(--app-surface-soft)]" />
                </div>
              );
            }

            if (tab === 'fab') {
              return (
                <div key="fab" className="flex flex-col items-center justify-center -mt-4">
                  {fabAction ? (
                    <button
                      type="button"
                      onClick={handleFabClick}
                      className="flex h-12 w-12 touch-manipulation items-center justify-center rounded-[6px] bg-primary/50 text-primary-foreground shadow-none transition-colors hover:bg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2"
                      aria-label={fabLabel}
                    >
                      <Plus className="h-6 w-6" />
                    </button>
                  ) : (
                    <div className="h-12 w-12" />
                  )}
                </div>
              );
            }

            if (tab === 'more') {
              return (
                <MobileSidebarTab key="more" label={(t.nav as Record<string, string>).more || 'Mais'} />
              );
            }

            const active = isActive(tab.path);
            const Icon = getNavigationIcon(tab.icon);

            return (
              <Link
                key={tab.path}
                href={tab.path}
                className={cn(
                  "relative flex min-h-12 min-w-[56px] touch-manipulation flex-col items-center justify-center gap-0.5 px-1 py-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30",
                  active ? "text-primary" : "text-[var(--app-text-tertiary)] hover:text-[var(--app-text-secondary)]"
                )}
                aria-current={active ? 'page' : undefined}
                aria-label={getLabel(tab.labelKey)}
              >
                {active && (
                  <span className="absolute top-0 h-0.5 w-8 rounded-full bg-primary/50" />
                )}

                <Icon className="h-5 w-5 mb-0.5" />

                <span className="max-w-[56px] truncate text-[10px] font-light leading-tight">
                  {getLabel(tab.labelKey)}
                </span>
              </Link>
            );
          })}
        </div>
      </nav>

      {createLeadOpen && (
        <CreateLeadDialog open={createLeadOpen} onOpenChange={setCreateLeadOpen} />
      )}
    </>
  );
}

// Wrapper that renders the More tab button and triggers MobileSidebar sheet
function MobileSidebarTab({ label }: { label: string; }) {
  const [open, setOpen] = useState(false);
  const [hasOpened, setHasOpened] = useState(false);

  const handleOpen = () => {
    setHasOpened(true);
    setOpen(true);
  };

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        className="flex min-h-12 min-w-[56px] touch-manipulation flex-col items-center justify-center gap-0.5 px-1 py-2 text-[var(--app-text-tertiary)] transition-colors hover:text-[var(--app-text-secondary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
        aria-label={label}
      >
        <MoreHorizontal className="h-5 w-5 mb-0.5" />
        <span className="text-[10px] font-light leading-tight">{label}</span>
      </button>
      {hasOpened && <MobileSidebarSheet open={open} onOpenChange={setOpen} />}
    </>
  );
}

// Extracted sheet from MobileSidebar, controlled externally
function MobileSidebarSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void; }) {
  return <MobileSidebar externalOpen={open} onExternalOpenChange={onOpenChange} />;
}
