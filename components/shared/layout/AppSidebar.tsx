"use client";

import React, { useEffect, useMemo, useState } from 'react';
import NextImage from 'next/image';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import {
  LayoutDashboard, Kanban, Building2, Shuffle,
  ChevronLeft, ChevronRight, Users, MessageSquare, Calendar, DollarSign,
  FileText, Receipt, TrendingUp, BarChart3, Zap, MapPin,
  Globe, Trophy, CreditCard, Tags, Activity, History, Megaphone, Settings, Plug, Bot, BellRing
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useOrganizationModules } from '@/hooks/use-organization-modules';
import { useUserPermissions } from '@/hooks/use-user-permissions';
import { useSidebar } from '@/contexts/SidebarContext';
import { useSystemSettings } from '@/hooks/use-system-settings';
import { useTheme } from 'next-themes';
import { isBillingBlockedStatus } from '@/lib/billing-access';
import { canUseFinancialModule } from '@/lib/financial-access';
import { Button } from '@/components/ui/button';
import { canManageOrganization } from '@/lib/access/organization';
import {
  filterNavigationItems,
  type NavigationAccessItem,
} from '@/lib/access/navigation';

const DEFAULT_BRAND_LOGO_DARK = "/images/logo-white.png";
const DEFAULT_BRAND_LOGO_LIGHT = "/images/logo-black.png";
const DEFAULT_BRAND_ICON = "/icons/favicon-laranja.png";
const SIDEBAR_BACKGROUND = "var(--app-sidebar)";
const SIDEBAR_ICON_STROKE = 1.32;
const SIDEBAR_CHEVRON_STROKE = 1.4;
const SIDEBAR_NAV_RESET =
  "border-0 shadow-none outline-none ring-0 focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0";
const SIDEBAR_NAV_TEXT = "font-sans text-sm font-extralight leading-none tracking-wide";
const SIDEBAR_NAV_CHILD_TEXT = "font-sans text-sm font-extralight leading-none tracking-wide";

interface NavItem extends NavigationAccessItem {
  icon: React.ElementType;
  labelKey: string;
  children?: NavItem[];
}

const allNavItems: NavItem[] = [
  {
    icon: LayoutDashboard,
    labelKey: 'dashboard',
    path: '/dashboard',
    anyPermissions: ['dashboard_view', 'dashboard_site_view', 'dashboard_campaigns_view'],
    children: [{
      icon: LayoutDashboard,
      labelKey: 'dashboardGeneral',
      path: '/dashboard',
      permission: 'dashboard_view'
    }, {
      icon: Globe,
      labelKey: 'dashboardSite',
      path: '/dashboard/site',
      permission: 'dashboard_site_view',
      module: 'site'
    }, {
      icon: Megaphone,
      labelKey: 'dashboardCampaigns',
      path: '/dashboard/campaigns',
      permission: 'dashboard_campaigns_view'
    }]
  }, {
    icon: Kanban,
    labelKey: 'pipelines',
    path: '/crm/pipelines',
    module: 'crm'
  }, {
    icon: BellRing,
    labelKey: 'attentionCenter',
    path: '/attention',
    module: 'crm',
    feature: 'ENABLE_ATTENTION_CENTER'
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
    anyPermissions: ['team_manage', 'distribution_manage', 'pipeline_manage', 'tag_manage'],
    children: [{
      icon: Users,
      labelKey: 'managementTeams',
      path: '/crm/management?tab=teams',
      anyPermissions: ['team_manage']
    }, {
      icon: Shuffle,
      labelKey: 'managementDistribution',
      path: '/crm/management?tab=distribution',
      permission: 'distribution_manage'
    }, {
      icon: Kanban,
      labelKey: 'managementPipelines',
      path: '/crm/management?tab=pipelines',
      permission: 'pipeline_manage'
    }, {
      icon: Tags,
      labelKey: 'managementTags',
      path: '/crm/management?tab=tags',
      permission: 'tag_manage'
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
      labelKey: 'propertiesCondos',
      path: '/properties/condominiums'
    }, {
      icon: MapPin,
      labelKey: 'propertiesLocations',
      path: '/properties/locations'
    }, {
      icon: Users,
      labelKey: 'propertiesOwners',
      path: '/properties/owners'
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
      permission: 'automations_manage'
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
    permission: 'financial_view',
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
      labelKey: 'dashboard',
      path: '/gamificacao#dashboard'
    }, {
      icon: History,
      labelKey: 'history',
      path: '/gamificacao#history'
    }, {
      icon: Settings,
      labelKey: 'arenaSettings',
      path: '/gamificacao#config',
      permission: 'gamification_manage'
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
      anyPermissions: ['users_manage', 'permissions_manage']
    }, {
      icon: CreditCard,
      labelKey: 'settingsBilling',
      path: '/settings?tab=subscription',
      permission: 'settings_billing'
    }, {
      icon: Plug,
      labelKey: 'settingsIntegrations',
      path: '/settings?tab=integrations',
      anyPermissions: ['settings_integrations', 'whatsapp_manage', 'settings_ai']
    }, {
      icon: Bot,
      labelKey: 'settingsAI',
      path: '/settings?tab=ai',
      permission: 'settings_ai',
      module: 'ai_agent'
    }, {
      icon: Building2,
      labelKey: 'settingsProperties',
      path: '/settings?tab=properties',
      permission: 'property_manage'
    }, {
      icon: Globe,
      labelKey: 'site',
      path: '/settings/site',
      permission: 'settings_site',
      module: 'site'
    }]
  }
];

export const AppSidebar = React.memo(function AppSidebar() {
  const pathname = usePathname() || '';
  const searchParams = useSearchParams();
  const { profile, isSuperAdmin, organization, tenantContext, userOrganizations } = useAuth();
  const { t } = useLanguage();
  const { hasModule } = useOrganizationModules();
  const { hasPermission } = useUserPermissions();
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
  const logoWidth = Math.min(systemSettings?.logo_width || 120, 108);
  const logoHeight = Math.min(systemSettings?.logo_height || 32, 28);
  const isBillingBlocked = !isSuperAdmin && isBillingBlockedStatus(organization?.subscription_status);
  const activeOrganizationId = organization?.id || profile?.organization_id;
  const activeOrganizationMembership = userOrganizations.find(org => org.organization_id === activeOrganizationId);
  const fallbackMemberRole = tenantContext && tenantContext.organizationId === activeOrganizationId
    ? tenantContext.memberRole
    : undefined;
  const activeMemberRole = activeOrganizationMembership?.member_role || fallbackMemberRole;
  const isTeamLeader = Boolean(tenantContext?.isTeamLeader);
  const canAccessFinancialModule = canUseFinancialModule({
    id: activeOrganizationId,
    name: organization?.name || activeOrganizationMembership?.organization_name,
  });
  const canAccessAdminItems = canManageOrganization({
    isSuperAdmin,
    memberRole: activeMemberRole,
  });

  const navItems = useMemo<NavItem[]>(() => {
    if (isBillingBlocked) {
      return [{
        icon: CreditCard,
        labelKey: 'Faturamento',
        path: '/settings?tab=subscription'
      }];
    }

    return filterNavigationItems(allNavItems, {
      canAccessAdminItems,
      canAccessFinancialModule,
      hasModule,
      hasPermission,
      isSuperAdmin,
      isTeamLeader,
    });
  }, [canAccessFinancialModule, hasModule, hasPermission, canAccessAdminItems, isBillingBlocked, isTeamLeader, isSuperAdmin]);

  const computedBottomItems = useMemo(() => {
    if (isBillingBlocked) return [];

    return filterNavigationItems(bottomItems, {
      canAccessAdminItems,
      canAccessFinancialModule,
      hasModule,
      hasPermission,
      isSuperAdmin,
      isTeamLeader,
    });
  }, [canAccessAdminItems, canAccessFinancialModule, hasModule, hasPermission, isBillingBlocked, isSuperAdmin, isTeamLeader]);

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
    const shouldLiftDropdown = item.path === '/settings';
    const dropdownAlignOffset = shouldLiftDropdown ? -180 : 0;

    if (item.children) {
      return (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className={cn(
                "flex w-full items-center gap-3 rounded-[6px] px-3 py-2.5 transition-colors",
                SIDEBAR_NAV_TEXT,
                SIDEBAR_NAV_RESET,
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
            alignOffset={dropdownAlignOffset}
            sideOffset={8}
            className="w-60 space-y-1 rounded-[6px] border-0 bg-[var(--app-sidebar)] p-1.5 text-[var(--app-text-primary)] shadow-[0_8px_18px_rgba(0,0,0,0.045)] backdrop-blur-md dark:shadow-[0_8px_18px_rgba(0,0,0,0.14)]"
          >
            {item.children.map(child => {
              const ChildIcon = child.icon;
              const childActive = isPathActive(child.path) || isPathPending(child.path);

              return (
                <DropdownMenuItem
                  key={child.path}
                  className={cn(
                    "cursor-pointer rounded-[5px] p-0 text-[var(--app-text-secondary)] focus:bg-[var(--app-surface-hover)] focus:text-[var(--app-text-primary)]",
                    SIDEBAR_NAV_RESET,
                    childActive && "bg-[var(--app-surface-soft)] text-[#FF4529]"
                  )}
                  onSelect={(e) => {
                    if (child.path.includes('#') && pathname === child.path.split('#')[0]) {
                      e.preventDefault();
                      const hash = child.path.split('#')[1];
                      setPendingPath(child.path);
                      window.location.hash = hash;
                    } else {
                      setPendingPath(child.path);
                    }
                  }}
                  asChild={!child.path.includes('#') || pathname !== child.path.split('#')[0]}
                >
                  {(!child.path.includes('#') || pathname !== child.path.split('#')[0]) ? (
                    <Link
                      href={child.path}
                      onPointerDown={() => setPendingPath(child.path)}
                      className={cn("flex w-full items-center gap-3 px-3 py-2", SIDEBAR_NAV_CHILD_TEXT, SIDEBAR_NAV_RESET)}
                    >
                      <ChildIcon className="h-4 w-4 flex-shrink-0" strokeWidth={SIDEBAR_ICON_STROKE} />
                      <span>{getLabel(child.labelKey)}</span>
                    </Link>
                  ) : (
                    <button
                      className={cn("flex w-full items-center gap-3 px-3 py-2", SIDEBAR_NAV_CHILD_TEXT, SIDEBAR_NAV_RESET)}
                    >
                      <ChildIcon className="h-4 w-4 flex-shrink-0" strokeWidth={SIDEBAR_ICON_STROKE} />
                      <span>{getLabel(child.labelKey)}</span>
                    </button>
                  )}
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
          "flex items-center gap-3 rounded-[6px] px-3 py-2.5 transition-colors",
          SIDEBAR_NAV_TEXT,
          SIDEBAR_NAV_RESET,
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
      "app-sidebar h-[calc(100%-16px)] rounded-[6px] relative flex flex-col transition-all duration-300 my-2 ml-2 mr-0 flex-shrink-0",
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
          className="absolute -right-3 top-14 z-50 flex h-6 w-6 items-center justify-center rounded-[6px] border-0 bg-[var(--app-sidebar)] text-[var(--app-text-secondary)] shadow-none outline-none ring-0 hover:bg-[var(--app-surface-hover)] hover:text-[var(--app-text-primary)] focus-visible:ring-0 focus-visible:ring-offset-0"
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
