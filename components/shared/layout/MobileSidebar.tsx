"use client";

import { useState, useMemo, type ElementType } from 'react';
import NextImage from 'next/image';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useTheme } from 'next-themes';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { useOrganizationModules, type ModuleName } from '@/hooks/use-organization-modules';
import { useUserPermissions } from '@/hooks/use-user-permissions';
import { useUserAccessScope } from '@/hooks/use-user-access-scope';
import {
  Menu,
  LayoutDashboard,
  Kanban,
  Users,
  Calendar,
  Building2,
  DollarSign,
  CreditCard,
  BarChart3,
  ChevronDown,
  ChevronRight,
  Shuffle,
  MessageSquare,
  TrendingUp,
  Receipt,
  FileText,
  Zap,
  Globe,
  Trophy,
  Target,
  Activity,
  Tags,
  MapPin,
  Settings,
  Megaphone,
  Plug,
} from 'lucide-react';

const DEFAULT_BRAND_LOGO_DARK = "/images/logo-white.png";
const DEFAULT_BRAND_LOGO_LIGHT = "/images/logo-black.png";
const MOBILE_LOGO_WIDTH = 120;
const SIDEBAR_BACKGROUND = "var(--app-sidebar)";
const SIDEBAR_ICON_STROKE = 1.6;
const SIDEBAR_CHEVRON_STROKE = 1.7;

interface NavItem {
  icon: ElementType;
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
    children: [
      { icon: LayoutDashboard, labelKey: 'dashboardGeneral', path: '/dashboard' },
      { icon: Globe, labelKey: 'dashboardSite', path: '/dashboard/site', adminOnly: true, module: 'site' },
      { icon: Megaphone, labelKey: 'dashboardCampaigns', path: '/dashboard/campaigns', adminOnly: true },
    ],
  },
  { icon: Kanban, labelKey: 'pipelines', path: '/crm/pipelines', module: 'crm' },
  { icon: MessageSquare, labelKey: 'conversations', path: '/crm/conversas', module: 'whatsapp' },
  { icon: Users, labelKey: 'contacts', path: '/crm/contacts', module: 'crm' },
  {
    icon: Shuffle,
    labelKey: 'crmManagement',
    path: '/crm/management',
    module: 'crm',
    anyPermissions: ['settings_teams', 'settings_users', 'settings_pipelines'],
    children: [
      { icon: Users, labelKey: 'managementTeams', path: '/crm/management?tab=teams', anyPermissions: ['settings_teams', 'settings_users'] },
      { icon: Shuffle, labelKey: 'managementDistribution', path: '/crm/management?tab=distribution', anyPermissions: ['settings_teams', 'settings_users'] },
      { icon: Kanban, labelKey: 'managementPipelines', path: '/crm/management?tab=pipelines', permission: 'settings_pipelines' },
      { icon: Tags, labelKey: 'managementTags', path: '/crm/management?tab=tags', permission: 'settings_pipelines' },
    ],
  },
  {
    icon: Building2,
    labelKey: 'properties',
    path: '/properties',
    module: 'properties',
    children: [
      { icon: Building2, labelKey: 'propertiesAll', path: '/properties' },
      { icon: Building2, labelKey: 'propertiesRentals', path: '/properties/rentals' },
      { icon: Building2, labelKey: 'propertiesCondos', path: '/properties/condominiums' },
      { icon: MapPin, labelKey: 'propertiesLocations', path: '/properties/locations' },
    ],
  },
  { icon: Calendar, labelKey: 'schedule', path: '/agenda', module: 'agenda' },
  {
    icon: Zap,
    labelKey: 'automations',
    path: '/automations',
    module: 'automations',
    permission: 'automations_view',
    children: [
      { icon: Zap, labelKey: 'automationList', path: '/automations?tab=automations', permission: 'automations_view' },
      { icon: FileText, labelKey: 'automationTemplates', path: '/automations?tab=templates', permission: 'automations_edit' },
      { icon: Activity, labelKey: 'automationHistory', path: '/automations?tab=history', permission: 'automations_view' },
    ],
  },
  {
    icon: DollarSign,
    labelKey: 'financial',
    path: '/financeiro',
    module: 'financial',
    adminOnly: true,
    children: [
      { icon: TrendingUp, labelKey: 'financialDashboard', path: '/financeiro' },
      { icon: Receipt, labelKey: 'entries', path: '/financeiro/contas' },
      { icon: FileText, labelKey: 'contracts', path: '/financeiro/contratos' },
      { icon: DollarSign, labelKey: 'commissions', path: '/financeiro/comissoes' },
      { icon: BarChart3, labelKey: 'reports', path: '/financeiro/relatorios' },
      { icon: BarChart3, labelKey: 'dre', path: '/financeiro/dre' },
    ],
  },
  {
    icon: Trophy,
    labelKey: 'arena',
    path: '/gamificacao',
    module: 'gamification',
    children: [
      { icon: Trophy, labelKey: 'arenaOverview', path: '/gamificacao' },
      { icon: BarChart3, labelKey: 'arenaRanking', path: '/gamificacao#ranking' },
      { icon: Target, labelKey: 'arenaMissions', path: '/gamificacao#missions' },
      { icon: Activity, labelKey: 'arenaActivities', path: '/gamificacao#activities' },
    ],
  },
];

const bottomItems: NavItem[] = [
  {
    icon: Settings,
    labelKey: 'settings',
    path: '/settings',
    children: [
      { icon: Settings, labelKey: 'settingsAccount', path: '/settings?tab=account' },
      { icon: Users, labelKey: 'settingsUsers', path: '/settings?tab=team', adminOnly: true },
      { icon: CreditCard, labelKey: 'settingsBilling', path: '/settings?tab=subscription', adminOnly: true },
      { icon: Plug, labelKey: 'settingsIntegrations', path: '/settings?tab=integrations' },
      { icon: Globe, labelKey: 'site', path: '/settings/site', adminOnly: true, module: 'site' },
    ],
  },
];

interface MobileSidebarProps {
  externalOpen?: boolean;
  onExternalOpenChange?: (open: boolean) => void;
}

export function MobileSidebar({ externalOpen, onExternalOpenChange }: MobileSidebarProps = {}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const { resolvedTheme } = useTheme();

  const isControlled = externalOpen !== undefined;
  const open = isControlled ? externalOpen : internalOpen;
  const setOpen = isControlled ? (v: boolean) => onExternalOpenChange?.(v) : setInternalOpen;
  const [openMenus, setOpenMenus] = useState<string[]>([]);
  const router = useRouter();
  const pathname = usePathname() || '';
  const searchParams = useSearchParams();
  const { profile, isSuperAdmin, organization, userOrganizations } = useAuth();
  const { t } = useLanguage();
  const { hasModule } = useOrganizationModules();
  const { hasPermission } = useUserPermissions();
  const { isTeamLeader } = useUserAccessScope();
  const activeOrganizationId = organization?.id || profile?.organization_id;
  const activeMemberRole = userOrganizations.find(org => org.organization_id === activeOrganizationId)?.member_role;
  const canAccessAdminItems =
    isSuperAdmin ||
    profile?.role === 'admin' ||
    activeMemberRole === 'admin' ||
    activeMemberRole === 'owner';

  const navItems = useMemo(() => {
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
  }, [hasModule, hasPermission, canAccessAdminItems, isTeamLeader, isSuperAdmin]);

  const computedBottomItems = useMemo(() => {
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
  }, [canAccessAdminItems, hasModule, hasPermission, isSuperAdmin, isTeamLeader]);

  const getLabel = (labelKey: string): string => {
    return (t.nav as Record<string, string>)[labelKey] || labelKey;
  };

  const toggleMenu = (path: string) => {
    setOpenMenus(prev =>
      prev.includes(path)
        ? prev.filter(p => p !== path)
        : [...prev, path]
    );
  };

  const isMenuOpen = (path: string) => openMenus.includes(path);

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

  const isActiveParent = (item: NavItem) => {
    if (item.children) {
      return isPathActive(item.path, { parent: true }) || item.children.some(child => isPathActive(child.path));
    }
    return isPathActive(item.path, { parent: true });
  };

  const handleNavigation = (path: string) => {
    router.push(path);
    setOpen(false);
  };
  const brandLogoUrl = resolvedTheme === 'dark' ? DEFAULT_BRAND_LOGO_DARK : DEFAULT_BRAND_LOGO_LIGHT;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      {!isControlled && (
        <SheetTrigger asChild>
          <Button variant="ghost" size="icon" className="lg:hidden text-[var(--app-text-tertiary)] hover:text-[var(--app-text-primary)] hover:bg-[var(--app-surface-hover)] rounded-[6px]">
            <Menu className="h-5 w-5" strokeWidth={SIDEBAR_CHEVRON_STROKE} />
          </Button>
        </SheetTrigger>
      )}
      <SheetContent
        side="left"
        className="w-[280px] border-0 border-r-0 p-0 flex flex-col text-[var(--app-text-primary)] data-[state=open]:duration-200 data-[state=closed]:duration-150"
        style={{ backgroundColor: SIDEBAR_BACKGROUND }}
      >
        <SheetTitle className="sr-only">Menu principal</SheetTitle>
        <SheetDescription className="sr-only">Navegação principal do Vimob CRM.</SheetDescription>

        {/* Logo header */}
        <div className="p-4 pr-12">
          <div className="relative h-7 w-[108px]">
            <NextImage
              src={brandLogoUrl}
              alt="Logo"
              fill
              sizes={`${MOBILE_LOGO_WIDTH}px`}
              className="object-contain object-left"
              priority
              unoptimized
            />
          </div>
        </div>

        {/* Navigation - main scrollable area */}
        <nav className="flex-1 py-4 px-3 overflow-y-auto scrollbar-thin">
          <ul className="space-y-1">
            {navItems.map((item) => {
              const isOpen = isMenuOpen(item.path) || isActiveParent(item);
              const Icon = item.icon;

              if (item.children) {
                return (
                  <li key={item.path}>
                    <button
                      onClick={() => toggleMenu(item.path)}
                      className={cn(
                        "w-full flex items-center justify-between px-3 py-3 rounded-[6px] text-sm font-extralight tracking-wide transition-colors",
                        isActiveParent(item)
                          ? "bg-[var(--app-surface-soft)] text-[#FF4529] font-normal"
                          : "text-[var(--app-text-secondary)] hover:bg-[var(--app-surface-hover)] hover:text-[var(--app-text-primary)]"
                      )}
                    >
                      <div className="flex items-center gap-3">
                        <Icon className="h-5 w-5" strokeWidth={SIDEBAR_ICON_STROKE} />
                        <span>{getLabel(item.labelKey)}</span>
                      </div>
                      {isOpen ? (
                        <ChevronDown className="h-4 w-4 opacity-50" strokeWidth={SIDEBAR_CHEVRON_STROKE} />
                      ) : (
                        <ChevronRight className="h-4 w-4 opacity-50" strokeWidth={SIDEBAR_CHEVRON_STROKE} />
                      )}
                    </button>
                    {isOpen && (
                      <ul className="ml-4 mt-1 space-y-1 pl-3">
                        {item.children.map((child) => {
                          const ChildIcon = child.icon;
                          return (
                            <li key={child.path}>
                              <button
                                onClick={() => handleNavigation(child.path)}
                                className={cn(
                                  "w-full flex items-center gap-3 px-3 py-2.5 rounded-[6px] text-xs font-extralight tracking-wide transition-colors",
                                  isPathActive(child.path)
                                    ? "bg-[var(--app-surface-soft)] text-[#FF4529] font-normal"
                                    : "text-[var(--app-text-tertiary)] hover:bg-[var(--app-surface-hover)] hover:text-[var(--app-text-primary)]"
                                )}
                              >
                                <ChildIcon className="h-4 w-4" strokeWidth={SIDEBAR_ICON_STROKE} />
                                <span>{getLabel(child.labelKey)}</span>
                              </button>
                            </li>
                          )
                        })}
                      </ul>
                    )}
                  </li>
                );
              }

              return (
                <li key={item.path}>
                  <button
                    onClick={() => handleNavigation(item.path)}
                    className={cn(
                      "w-full flex items-center gap-3 px-3 py-3 rounded-[6px] text-sm font-extralight tracking-wide transition-colors",
                      isActiveParent(item)
                        ? "bg-[var(--app-surface-soft)] text-[#FF4529] font-normal"
                        : "text-[var(--app-text-secondary)] hover:bg-[var(--app-surface-hover)] hover:text-[var(--app-text-primary)]"
                    )}
                  >
                    <Icon className="h-5 w-5" strokeWidth={SIDEBAR_ICON_STROKE} />
                    <span>{getLabel(item.labelKey)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* Bottom items */}
        <div className="py-3 px-3">
          <ul className="space-y-1">
            {computedBottomItems.map(item => {
              const Icon = item.icon;
              const isOpen = isMenuOpen(item.path) || isActiveParent(item);

              if (item.children) {
                return (
                  <li key={item.path}>
                    <button
                      onClick={() => toggleMenu(item.path)}
                      className={cn(
                        "w-full flex items-center justify-between px-3 py-3 rounded-[6px] text-sm font-extralight tracking-wide transition-colors",
                        isActiveParent(item)
                          ? "bg-[var(--app-surface-soft)] text-[#FF4529] font-normal"
                          : "text-[var(--app-text-secondary)] hover:bg-[var(--app-surface-hover)] hover:text-[var(--app-text-primary)]"
                      )}
                    >
                      <div className="flex items-center gap-3">
                        <Icon className="h-5 w-5" strokeWidth={SIDEBAR_ICON_STROKE} />
                        <span>{getLabel(item.labelKey)}</span>
                      </div>
                      {isOpen ? (
                        <ChevronDown className="h-4 w-4 opacity-50" strokeWidth={SIDEBAR_CHEVRON_STROKE} />
                      ) : (
                        <ChevronRight className="h-4 w-4 opacity-50" strokeWidth={SIDEBAR_CHEVRON_STROKE} />
                      )}
                    </button>
                    {isOpen && (
                      <ul className="ml-4 mt-1 space-y-1 pl-3">
                        {item.children.map((child) => {
                          const ChildIcon = child.icon;

                          return (
                            <li key={child.path}>
                              <button
                                onClick={() => handleNavigation(child.path)}
                                className={cn(
                                  "w-full flex items-center gap-3 px-3 py-2.5 rounded-[6px] text-xs font-extralight tracking-wide transition-colors",
                                  isPathActive(child.path)
                                    ? "bg-[var(--app-surface-soft)] text-[#FF4529] font-normal"
                                    : "text-[var(--app-text-tertiary)] hover:bg-[var(--app-surface-hover)] hover:text-[var(--app-text-primary)]"
                                )}
                              >
                                <ChildIcon className="h-4 w-4" strokeWidth={SIDEBAR_ICON_STROKE} />
                                <span>{getLabel(child.labelKey)}</span>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </li>
                );
              }

              return (
                <li key={item.path}>
                  <button
                    onClick={() => handleNavigation(item.path)}
                    className={cn(
                      "w-full flex items-center gap-3 px-3 py-3 rounded-[6px] text-sm font-extralight tracking-wide transition-colors",
                      pathname === item.path
                        ? "bg-[var(--app-surface-soft)] text-[#FF4529] font-normal"
                        : "text-[var(--app-text-secondary)] hover:bg-[var(--app-surface-hover)] hover:text-[var(--app-text-primary)]"
                    )}
                  >
                    <Icon className="h-5 w-5" strokeWidth={SIDEBAR_ICON_STROKE} />
                    <span>{getLabel(item.labelKey)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </SheetContent>
    </Sheet>
  );
}
