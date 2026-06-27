"use client";

import React, { useEffect, useMemo, useState } from 'react';
import NextImage from 'next/image';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import {
  LayoutDashboard, Kanban, Building2, Shuffle,
  ChevronLeft, ChevronRight, Users, MessageSquare, Calendar, DollarSign,
  FileText, Receipt, TrendingUp, BarChart3, Zap, MapPin,
  Globe, Trophy, CreditCard, Tags, Target, Activity, Megaphone, Settings, Plug
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useOrganizationModules, type ModuleName } from '@/hooks/use-organization-modules';
import { useUserPermissions } from '@/hooks/use-user-permissions';
import { useUserAccessScope } from '@/hooks/use-user-access-scope';
import { useSidebar } from '@/contexts/SidebarContext';
import { useSystemSettings } from '@/hooks/use-system-settings';
import { useTheme } from 'next-themes';
import { isBillingBlockedStatus } from '@/lib/billing-access';
import { Button } from '@/components/ui/button';

const DEFAULT_BRAND_LOGO_DARK = "/images/logo-white.png";
const DEFAULT_BRAND_LOGO_LIGHT = "/images/logo-black.png";
const DEFAULT_BRAND_ICON = "/favicon.ico";
const SIDEBAR_BACKGROUND = "var(--app-sidebar)";
const SIDEBAR_ICON_STROKE = 1.6;
const SIDEBAR_CHEVRON_STROKE = 1.7;

interface NavItem {
  icon: React.ElementType;
  labelKey: string;
  path: string;
  module?: ModuleName;
  permission?: string;
  anyPermissions?: string[];
  adminOnly?: boolean;
  superAdminOnly?: boolean;
  children?: NavItem[];
}

const allNavItems: NavItem[] = [
  {
    icon: LayoutDashboard,
    labelKey: 'dashboard',
    path: '/dashboard',
    children: [{
      icon: LayoutDashboard,
      labelKey: 'dashboardGeneral',
      path: '/dashboard'
    }, {
      icon: Globe,
      labelKey: 'dashboardSite',
      path: '/dashboard/site',
      adminOnly: true,
      module: 'site'
    }, {
      icon: Megaphone,
      labelKey: 'dashboardCampaigns',
      path: '/dashboard/campaigns',
      adminOnly: true
    }]
  }, {
    icon: Kanban,
    labelKey: 'pipelines',
    path: '/crm/pipelines',
    module: 'crm'
  }, {
    icon: MessageSquare, // Substituído o WhatsAppIcon pelo padrão
    labelKey: 'conversations',
    path: '/crm/conversas',
    module: 'whatsapp'
  }, {
    icon: Users,
    labelKey: 'contacts',
    path: '/crm/contacts',
    module: 'crm'
  },
  // Admin modules
  {
    icon: Shuffle,
    labelKey: 'crmManagement',
    path: '/crm/management',
    module: 'crm',
    anyPermissions: ['settings_teams', 'settings_users', 'settings_pipelines'],
    children: [{
      icon: Users,
      labelKey: 'managementTeams',
      path: '/crm/management?tab=teams',
      anyPermissions: ['settings_teams', 'settings_users']
    }, {
      icon: Shuffle,
      labelKey: 'managementDistribution',
      path: '/crm/management?tab=distribution',
      anyPermissions: ['settings_teams', 'settings_users']
    }, {
      icon: Kanban,
      labelKey: 'managementPipelines',
      path: '/crm/management?tab=pipelines',
      permission: 'settings_pipelines'
    }, {
      icon: Tags,
      labelKey: 'managementTags',
      path: '/crm/management?tab=tags',
      permission: 'settings_pipelines'
    }]
  }, {
    icon: Building2,
    labelKey: 'properties',
    path: '/properties',
    module: 'properties',
    children: [{
      icon: Building2,
      labelKey: 'propertiesAll',
      path: '/properties'
    }, {
      icon: Building2,
      labelKey: 'propertiesRentals',
      path: '/properties/rentals'
    }, {
      icon: Building2,
      labelKey: 'propertiesCondos',
      path: '/properties/condominiums'
    }, {
      icon: MapPin,
      labelKey: 'propertiesLocations',
      path: '/properties/locations'
    }]
  }, {
    icon: Calendar,
    labelKey: 'schedule',
    path: '/agenda',
    module: 'agenda'
  }, {
    icon: Zap,
    labelKey: 'automations',
    path: '/automations',
    module: 'automations',
    permission: 'automations_view',
    children: [{
      icon: Zap,
      labelKey: 'automationList',
      path: '/automations?tab=automations',
      permission: 'automations_view'
    }, {
      icon: FileText,
      labelKey: 'automationTemplates',
      path: '/automations?tab=templates',
      permission: 'automations_edit'
    }, {
      icon: Activity,
      labelKey: 'automationHistory',
      path: '/automations?tab=history',
      permission: 'automations_view'
    }]
  }, {
    icon: DollarSign,
    labelKey: 'financial',
    path: '/financeiro',
    module: 'financial',
    adminOnly: true,
    children: [{
      icon: TrendingUp,
      labelKey: 'financialDashboard',
      path: '/financeiro'
    }, {
      icon: Receipt,
      labelKey: 'entries',
      path: '/financeiro/contas'
    }, {
      icon: FileText,
      labelKey: 'contracts',
      path: '/financeiro/contratos'
    }, {
      icon: DollarSign,
      labelKey: 'commissions',
      path: '/financeiro/comissoes'
    }, {
      icon: BarChart3,
      labelKey: 'reports',
      path: '/financeiro/relatorios'
    }, {
      icon: BarChart3,
      labelKey: 'dre',
      path: '/financeiro/dre'
    }]
  }, {
    icon: Trophy,
    labelKey: 'arena',
    path: '/gamificacao',
    module: 'gamification',
    children: [{
      icon: Trophy,
      labelKey: 'arenaOverview',
      path: '/gamificacao'
    }, {
      icon: BarChart3,
      labelKey: 'arenaRanking',
      path: '/gamificacao#ranking'
    }, {
      icon: Target,
      labelKey: 'arenaMissions',
      path: '/gamificacao#missions'
    }, {
      icon: Activity,
      labelKey: 'arenaActivities',
      path: '/gamificacao#activities'
    }]
  }
];

const bottomItems: NavItem[] = [
  {
    icon: Settings,
    labelKey: 'settings',
    path: '/settings',
    children: [{
      icon: Settings,
      labelKey: 'settingsAccount',
      path: '/settings?tab=account'
    }, {
      icon: Users,
      labelKey: 'settingsUsers',
      path: '/settings?tab=team',
      adminOnly: true
    }, {
      icon: CreditCard,
      labelKey: 'settingsBilling',
      path: '/settings?tab=subscription',
      adminOnly: true
    }, {
      icon: Plug,
      labelKey: 'settingsIntegrations',
      path: '/settings?tab=integrations'
    }, {
      icon: Globe,
      labelKey: 'site',
      path: '/settings/site',
      adminOnly: true,
      module: 'site'
    }]
  }
];

export const AppSidebar = React.memo(function AppSidebar() {
  const pathname = usePathname() || '';
  const searchParams = useSearchParams();
  const { profile, isSuperAdmin, organization, userOrganizations } = useAuth();
  const { t } = useLanguage();
  const { hasModule } = useOrganizationModules();
  const { hasPermission } = useUserPermissions();
  const { isTeamLeader } = useUserAccessScope();
  const { collapsed, toggleCollapsed } = useSidebar();
  const { data: systemSettings } = useSystemSettings();
  const { resolvedTheme } = useTheme();
  const [pendingPath, setPendingPath] = useState<string | null>(null);
  const searchKey = searchParams.toString();

  const logoUrl = useMemo(() => {
    if (!systemSettings) return null;
    return resolvedTheme === 'dark' ? systemSettings.logo_url_dark || systemSettings.logo_url_light : systemSettings.logo_url_light || systemSettings.logo_url_dark;
  }, [systemSettings, resolvedTheme]);

  const displayLogoUrl = logoUrl || (resolvedTheme === 'dark' ? DEFAULT_BRAND_LOGO_DARK : DEFAULT_BRAND_LOGO_LIGHT);
  const faviconUrl = useMemo(() => DEFAULT_BRAND_ICON, []);
  const logoWidth = systemSettings?.logo_width || 120;
  const logoHeight = systemSettings?.logo_height || 32;
  const isBillingBlocked = !isSuperAdmin && isBillingBlockedStatus(organization?.subscription_status);
  const activeOrganizationId = organization?.id || profile?.organization_id;
  const activeMemberRole = userOrganizations.find(org => org.organization_id === activeOrganizationId)?.member_role;
  const canAccessAdminItems =
    isSuperAdmin ||
    profile?.role === 'admin' ||
    activeMemberRole === 'admin' ||
    activeMemberRole === 'owner';

  const navItems = useMemo<NavItem[]>(() => {
    if (isBillingBlocked) {
      return [{
        icon: CreditCard,
        labelKey: 'Faturamento',
        path: '/settings?tab=subscription'
      }];
    }

    const filterItems = (items: NavItem[]): NavItem[] => {
      return items.filter(item => {
        if (item.superAdminOnly && !isSuperAdmin) return false;
        if (item.module && !hasModule(item.module)) return false;
        if (item.adminOnly && !canAccessAdminItems) return false;
        if (item.permission && !hasPermission(item.permission)) return false;
        if (item.anyPermissions && !item.anyPermissions.some(permission => hasPermission(permission))) {
          if (!(item.path === '/crm/management' && isTeamLeader)) return false;
        }
        return true;
      }).map(item => {
        if (item.children) {
          const filteredChildren = filterItems(item.children);
          return {
            ...item,
            children: filteredChildren.length > 0 ? filteredChildren : undefined
          };
        }
        return item;
      });
    };

    return filterItems(allNavItems);
  }, [hasModule, hasPermission, canAccessAdminItems, isBillingBlocked, isTeamLeader, isSuperAdmin]);

  const computedBottomItems = useMemo(() => {
    if (isBillingBlocked) return [];

    const filterItems = (items: NavItem[]): NavItem[] => {
      return items.filter(item => {
        if (item.superAdminOnly && !isSuperAdmin) return false;
        if (item.module && !hasModule(item.module)) return false;
        if (item.adminOnly && !canAccessAdminItems) return false;
        if (item.permission && !hasPermission(item.permission)) return false;
        if (item.anyPermissions && !item.anyPermissions.some(permission => hasPermission(permission))) {
          if (!(item.path === '/crm/management' && isTeamLeader)) return false;
        }
        return true;
      }).map(item => {
        if (item.children) {
          const filteredChildren = filterItems(item.children);
          return {
            ...item,
            children: filteredChildren.length > 0 ? filteredChildren : undefined
          };
        }
        return item;
      });
    };

    return filterItems(bottomItems);
  }, [canAccessAdminItems, hasModule, hasPermission, isBillingBlocked, isSuperAdmin, isTeamLeader]);

  const getLabel = (labelKey: string): string => {
    return (t.nav as Record<string, string>)[labelKey] || labelKey;
  };

  useEffect(() => {
    setPendingPath(null);
  }, [pathname, searchKey]);

  const parseNavPath = (path: string) => {
    const [withoutHash, hash] = path.split('#');
    const [basePath, queryString] = withoutHash.split('?');
    const params = new URLSearchParams(queryString || '');
    return {
      basePath,
      hash,
      tab: params.get('tab')
    };
  };

  const isPathActive = (path: string, options?: { parent?: boolean }) => {
    const { basePath, hash, tab } = parseNavPath(path);

    if (pathname !== basePath && !pathname.startsWith(`${basePath}/`)) return false;
    if (tab) {
      const currentTab = searchParams.get('tab');
      return currentTab === tab
        || (!currentTab && basePath === '/crm/management' && tab === 'teams')
        || (!currentTab && basePath === '/automations' && tab === 'automations')
        || (!currentTab && basePath === '/settings' && tab === 'account');
    }
    if (hash) return false;
    if (options?.parent) return true;
    if (searchParams.get('tab') && pathname === basePath) return false;
    return pathname === basePath;
  };

  const isPathPending = (path: string, options?: { parent?: boolean }) => {
    if (!pendingPath) return false;

    const target = parseNavPath(path);
    const pending = parseNavPath(pendingPath);

    if (pending.basePath !== target.basePath && !pending.basePath.startsWith(`${target.basePath}/`)) return false;
    if (target.tab) return pending.tab === target.tab;
    if (target.hash) return pending.hash === target.hash;
    if (options?.parent) return true;
    return pending.basePath === target.basePath;
  };

  const isActiveParent = (item: NavItem) => {
    if (item.children) {
      return isPathActive(item.path, { parent: true })
        || isPathPending(item.path, { parent: true })
        || item.children.some(child => isPathActive(child.path) || isPathPending(child.path));
    }
    return isPathActive(item.path, { parent: true }) || isPathPending(item.path, { parent: true });
  };

  const renderNavItem = (item: NavItem) => {
    const Icon = item.icon;
    const isActive = item.children ? isActiveParent(item) : isPathActive(item.path, { parent: true });

    if (item.children) {
      return (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className={cn(
                "flex w-full items-center gap-3 rounded-[6px] px-3 py-2.5 text-sm font-extralight tracking-wide transition-colors",
                "text-[var(--app-text-secondary)] hover:bg-[var(--app-surface-hover)] hover:text-[var(--app-text-primary)]",
                isActive && "bg-[var(--app-surface-soft)] text-[#FF4529] font-normal",
                collapsed && "justify-center"
              )}
              aria-label={getLabel(item.labelKey)}
            >
              <Icon className="h-5 w-5 flex-shrink-0" strokeWidth={SIDEBAR_ICON_STROKE} />
              {!collapsed && (
                <>
                  <span className="flex-1 text-left">{getLabel(item.labelKey)}</span>
                  <ChevronRight className="h-4 w-4 text-[var(--app-text-tertiary)]" strokeWidth={SIDEBAR_CHEVRON_STROKE} />
                </>
              )}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            side="right"
            align="start"
            sideOffset={8}
            className="w-60 rounded-[6px] border-0 bg-[var(--app-sidebar)] p-1.5 text-[var(--app-text-primary)] shadow-[0_8px_18px_rgba(0,0,0,0.045)] backdrop-blur-md dark:shadow-[0_8px_18px_rgba(0,0,0,0.14)]"
          >
            {item.children.map(child => {
              const ChildIcon = child.icon;
              const childActive = isPathActive(child.path) || isPathPending(child.path);

              return (
                <DropdownMenuItem
                  key={child.path}
                  asChild
                  className={cn(
                    "cursor-pointer rounded-[6px] p-0 text-[var(--app-text-secondary)] outline-none focus:bg-[var(--app-surface-hover)] focus:text-[var(--app-text-primary)]",
                    childActive && "bg-[var(--app-surface-soft)] text-[#FF4529]"
                  )}
                >
                  <Link
                    href={child.path}
                    onPointerDown={() => setPendingPath(child.path)}
                    className="flex w-full items-center gap-3 px-3 py-2.5"
                  >
                    <ChildIcon className="h-4 w-4 flex-shrink-0" strokeWidth={SIDEBAR_ICON_STROKE} />
                    <span className="text-sm font-extralight tracking-wide">{getLabel(child.labelKey)}</span>
                  </Link>
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      );
    }

    return (
      <Link
        href={item.path}
        onPointerDown={() => setPendingPath(item.path)}
        className={cn(
          "flex items-center gap-3 rounded-[6px] px-3 py-2.5 text-sm font-extralight tracking-wide transition-colors",
          "text-[var(--app-text-secondary)] hover:bg-[var(--app-surface-hover)] hover:text-[var(--app-text-primary)]",
          isActive && "bg-[var(--app-surface-soft)] text-[#FF4529] font-normal",
          collapsed && "justify-center"
        )}
      >
        <Icon className="h-5 w-5 flex-shrink-0" strokeWidth={SIDEBAR_ICON_STROKE} />
        {!collapsed && <span>{getLabel(item.labelKey)}</span>}
      </Link>
    );
  };

  return (
    <aside className={cn(
      "h-[calc(100%-16px)] rounded-[6px] relative flex flex-col transition-all duration-300 my-2 ml-2 mr-0 flex-shrink-0",
      collapsed ? "w-16" : "w-56"
    )}
    style={{ backgroundColor: SIDEBAR_BACKGROUND }}>
      {/* Header */}
      <div className={cn("flex items-center px-3 pt-4 pb-4", collapsed ? "justify-center" : "justify-between")}>
        {collapsed ? (
          <div className="h-8 w-8 flex items-center justify-center">
            {faviconUrl ? (
              <NextImage src={faviconUrl} alt="Icon" width={32} height={32} className="object-contain opacity-90" priority unoptimized />
            ) : (
              <div className="h-8 w-8 rounded-[6px] bg-[#FF4529] flex items-center justify-center text-white font-light text-sm">V</div>
            )}
          </div>
        ) : (
          <>
            <div className="flex items-center">
              {displayLogoUrl ? (
                <NextImage
                  src={displayLogoUrl}
                  alt="Logo"
                  width={logoWidth}
                  height={logoHeight}
                  style={{ maxWidth: logoWidth, maxHeight: logoHeight }}
                  className="object-contain"
                  priority
                  unoptimized
                />
              ) : (
                <div className="h-8 w-8 rounded-[6px] bg-[#FF4529] flex items-center justify-center text-white font-light text-sm">V</div>
              )}
            </div>
            <Button variant="ghost" size="icon" className="h-7 w-7 text-[var(--app-text-tertiary)] hover:text-[var(--app-text-primary)] hover:bg-[var(--app-surface-hover)] rounded-[6px]" onClick={toggleCollapsed} aria-label="Recolher menu">
              <ChevronLeft className="h-4 w-4" strokeWidth={SIDEBAR_CHEVRON_STROKE} />
            </Button>
          </>
        )}
      </div>

      {/* Toggle Flutuante quando fechado */}
      {collapsed && (
        <Button
          variant="outline"
          size="icon"
          className="absolute -right-3 top-14 z-50 flex h-6 w-6 items-center justify-center rounded-[6px] border border-white/[0.055] bg-[var(--app-sidebar)] text-[var(--app-text-secondary)] shadow-none hover:bg-[var(--app-surface-hover)] hover:text-[var(--app-text-primary)]"
          onClick={toggleCollapsed}
          aria-label="Expandir menu"
        >
          <ChevronRight className="h-3 w-3" strokeWidth={SIDEBAR_CHEVRON_STROKE} />
        </Button>
      )}

      {/* Navegação */}
      <nav className="flex-1 py-4 px-2 overflow-y-auto scrollbar-thin">
        <ul className="space-y-1">
          {navItems.map(item => (
            <li key={item.path}>{renderNavItem(item)}</li>
          ))}
        </ul>
      </nav>

      {/* Bottom Itens */}
      <div className="py-3 px-2">
        <ul className="space-y-1">
          {computedBottomItems.map(item => (
            <li key={item.path}>{renderNavItem(item)}</li>
          ))}
        </ul>
      </div>
    </aside>
  );
});
