"use client";

import React, { useEffect, useMemo, useState } from "react";
import NextImage from "next/image";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useOrganizationModules } from "@/hooks/use-organization-modules";
import { useUserPermissions } from "@/hooks/use-user-permissions";
import { useSidebar } from "@/contexts/SidebarContext";
import { useSystemSettings } from "@/hooks/use-system-settings";
import { useLocationHash } from "@/hooks/use-location-hash";
import { useTheme } from "next-themes";
import { isBillingAccessBlocked } from "@/lib/billing-access";
import { canUseFinancialModule } from "@/lib/financial-access";
import { Button } from "@/components/ui/button";
import { canManageOrganization } from "@/lib/access/organization";
import {
  filterNavigationItems,
  getNavigationLocationKey,
  isNavigationPathActive,
} from "@/lib/access/navigation";
import {
  APP_BOTTOM_NAVIGATION_ITEMS,
  APP_NAVIGATION_ITEMS,
  BILLING_NAVIGATION_ITEM,
  type AppNavigationItem,
} from "@/config/navigation";
import { getNavigationIcon } from "./navigation-icons";

const DEFAULT_BRAND_LOGO_DARK = "/images/logo-white.png";
const DEFAULT_BRAND_LOGO_LIGHT = "/images/logo-black.png";
const DEFAULT_BRAND_ICON = "/icons/favicon-laranja.png";
const SIDEBAR_BACKGROUND = "var(--app-sidebar)";
const SIDEBAR_ICON_STROKE = 1.32;
const SIDEBAR_CHEVRON_STROKE = 1.4;
const SIDEBAR_NAV_RESET =
  "border-0 shadow-none outline-none ring-0 focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0";
const SIDEBAR_NAV_TEXT =
  "font-sans text-[12px] font-light leading-none";
const SIDEBAR_NAV_CHILD_TEXT =
  "font-sans text-[14px] font-light leading-[21px]";

export const AppSidebar = React.memo(function AppSidebar() {
  const pathname = usePathname() || "";
  const searchParams = useSearchParams();
  const currentHash = useLocationHash();
  const {
    profile,
    isSuperAdmin,
    organization,
    tenantContext,
    userOrganizations,
  } = useAuth();
  const { t } = useLanguage();
  const { hasModule, isLoading: modulesLoading } = useOrganizationModules();
  const { hasPermission, isLoading: permissionsLoading } = useUserPermissions();
  const { collapsed, setCollapsed, toggleCollapsed } = useSidebar();
  const { data: systemSettings } = useSystemSettings();
  const { resolvedTheme } = useTheme();
  const [pendingPath, setPendingPath] = useState<string | null>(null);
  const locationKey = getNavigationLocationKey(
    pathname,
    searchParams,
    currentHash,
  );

  const logoUrl = useMemo(() => {
    if (!systemSettings) return null;
    return resolvedTheme === "dark"
      ? systemSettings.logo_url_dark || systemSettings.logo_url_light
      : systemSettings.logo_url_light || systemSettings.logo_url_dark;
  }, [systemSettings, resolvedTheme]);

  const displayLogoUrl =
    logoUrl ||
    (resolvedTheme === "dark"
      ? DEFAULT_BRAND_LOGO_DARK
      : DEFAULT_BRAND_LOGO_LIGHT);
  const faviconUrl = useMemo(() => DEFAULT_BRAND_ICON, []);
  const logoWidth = Math.min(systemSettings?.logo_width || 120, 108);
  const logoHeight = Math.min(systemSettings?.logo_height || 32, 28);
  const isBillingBlocked =
    !isSuperAdmin && isBillingAccessBlocked(organization);
  const activeOrganizationId = organization?.id || profile?.organization_id;
  const activeOrganizationMembership = userOrganizations.find(
    (org) => org.organization_id === activeOrganizationId,
  );
  const fallbackMemberRole =
    tenantContext && tenantContext.organizationId === activeOrganizationId
      ? tenantContext.memberRole
      : undefined;
  const activeMemberRole =
    activeOrganizationMembership?.member_role || fallbackMemberRole;
  const isTeamLeader = Boolean(tenantContext?.isTeamLeader);
  const canAccessFinancialModule = canUseFinancialModule({
    id: activeOrganizationId,
    name: organization?.name || activeOrganizationMembership?.organization_name,
  });
  const canAccessAdminItems = canManageOrganization({
    isSuperAdmin,
    memberRole: activeMemberRole,
  });
  const navigationLoading = modulesLoading || permissionsLoading;

  const navItems = useMemo<AppNavigationItem[]>(() => {
    if (isBillingBlocked) {
      return [BILLING_NAVIGATION_ITEM];
    }

    return filterNavigationItems(APP_NAVIGATION_ITEMS, {
      canAccessAdminItems,
      canAccessFinancialModule,
      hasModule,
      hasPermission,
      isSuperAdmin,
      isTeamLeader,
    });
  }, [
    canAccessFinancialModule,
    hasModule,
    hasPermission,
    canAccessAdminItems,
    isBillingBlocked,
    isTeamLeader,
    isSuperAdmin,
  ]);

  const computedBottomItems = useMemo(() => {
    if (isBillingBlocked) return [];

    return filterNavigationItems(APP_BOTTOM_NAVIGATION_ITEMS, {
      canAccessAdminItems,
      canAccessFinancialModule,
      hasModule,
      hasPermission,
      isSuperAdmin,
      isTeamLeader,
    });
  }, [
    canAccessAdminItems,
    canAccessFinancialModule,
    hasModule,
    hasPermission,
    isBillingBlocked,
    isSuperAdmin,
    isTeamLeader,
  ]);

  const getLabel = (labelKey: string): string => {
    return (t.nav as Record<string, string>)[labelKey] || labelKey;
  };

  useEffect(() => {
    setPendingPath(null);
    setCollapsed(true);
  }, [locationKey, setCollapsed]);

  const parseNavPath = (path: string) => {
    const [withoutHash, hash] = path.split("#");
    const [basePath, queryString] = withoutHash.split("?");
    const params = new URLSearchParams(queryString || "");
    return {
      basePath,
      hash,
      tab: params.get("tab"),
    };
  };

  const isPathActive = (path: string, options?: { parent?: boolean }) =>
    isNavigationPathActive(path, pathname, searchParams, {
      ...options,
      currentHash,
    });

  const isPathPending = (path: string, options?: { parent?: boolean }) => {
    if (!pendingPath) return false;

    const target = parseNavPath(path);
    const pending = parseNavPath(pendingPath);

    if (
      pending.basePath !== target.basePath &&
      !pending.basePath.startsWith(`${target.basePath}/`)
    )
      return false;
    if (target.tab) return pending.tab === target.tab;
    if (target.hash) return pending.hash === target.hash;
    if (options?.parent) return true;
    return pending.basePath === target.basePath;
  };

  const isActiveParent = (item: AppNavigationItem) => {
    if (item.children) {
      return (
        isPathActive(item.path, { parent: true }) ||
        isPathPending(item.path, { parent: true }) ||
        item.children.some((child) => {
          const options = child.matchSection ? { parent: true } : undefined;
          return (
            isPathActive(child.path, options) ||
            isPathPending(child.path, options)
          );
        })
      );
    }
    return (
      isPathActive(item.path, { parent: true }) ||
      isPathPending(item.path, { parent: true })
    );
  };

  const handleDirectNavigation = (
    event: React.MouseEvent<HTMLAnchorElement>,
    path: string,
  ) => {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }

    setPendingPath(path);
  };

  const renderNavItem = (item: AppNavigationItem) => {
    const Icon = getNavigationIcon(item.icon);
    const isActive = item.children
      ? isActiveParent(item)
      : isPathActive(item.path, { parent: true }) ||
        isPathPending(item.path, { parent: true });
    const shouldLiftDropdown = item.path === "/settings";
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
                isActive &&
                  "bg-[var(--app-surface-soft)] font-normal text-primary",
                collapsed && "justify-center",
              )}
              aria-label={getLabel(item.labelKey)}
              aria-current={isActive ? "page" : undefined}
              title={collapsed ? getLabel(item.labelKey) : undefined}
            >
              <Icon
                className="h-5 w-5 flex-shrink-0"
                strokeWidth={SIDEBAR_ICON_STROKE}
              />
              {!collapsed && (
                <>
                  <span className="flex-1 text-left">
                    {getLabel(item.labelKey)}
                  </span>
                  <ChevronRight
                    className="h-4 w-4 text-[var(--app-text-tertiary)]"
                    strokeWidth={SIDEBAR_CHEVRON_STROKE}
                  />
                </>
              )}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            side="right"
            align="start"
            alignOffset={dropdownAlignOffset}
            sideOffset={8}
            className="app-sidebar-popover w-60 space-y-0.5 p-2"
          >
            {item.children.map((child) => {
              const ChildIcon = getNavigationIcon(child.icon);
              const childMatchOptions = child.matchSection
                ? { parent: true }
                : undefined;
              const childActive =
                isPathActive(child.path, childMatchOptions) ||
                isPathPending(child.path, childMatchOptions);

              return (
                <DropdownMenuItem
                  key={child.path}
                  className={cn(
                    "cursor-pointer gap-2 rounded-[4px] px-2.5 py-2 text-[14px] font-light leading-[21px] text-[var(--app-text-secondary)] hover:bg-[var(--app-surface-hover)] hover:text-[var(--app-text-primary)] focus:bg-[var(--app-surface-hover)] focus:text-[var(--app-text-primary)]",
                    SIDEBAR_NAV_RESET,
                    childActive &&
                      "bg-[var(--app-surface-soft)] text-primary",
                  )}
                  onSelect={(e) => {
                    if (
                      child.path.includes("#") &&
                      pathname === child.path.split("#")[0]
                    ) {
                      e.preventDefault();
                      const hash = child.path.split("#")[1];
                      setPendingPath(child.path);
                      window.location.hash = hash;
                    } else {
                      setPendingPath(child.path);
                    }
                  }}
                  asChild={
                    !child.path.includes("#") ||
                    pathname !== child.path.split("#")[0]
                  }
                >
                  {!child.path.includes("#") ||
                  pathname !== child.path.split("#")[0] ? (
                    <Link
                      href={child.path}
                      className={cn(
                        "flex w-full items-center gap-2",
                        SIDEBAR_NAV_CHILD_TEXT,
                        SIDEBAR_NAV_RESET,
                      )}
                    >
                      <ChildIcon
                        className="h-3.5 w-3.5 flex-shrink-0"
                        strokeWidth={SIDEBAR_ICON_STROKE}
                      />
                      <span>{getLabel(child.labelKey)}</span>
                    </Link>
                  ) : (
                    <button
                      className={cn(
                        "flex w-full items-center gap-2",
                        SIDEBAR_NAV_CHILD_TEXT,
                        SIDEBAR_NAV_RESET,
                      )}
                    >
                      <ChildIcon
                        className="h-3.5 w-3.5 flex-shrink-0"
                        strokeWidth={SIDEBAR_ICON_STROKE}
                      />
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
        onClick={(event) => handleDirectNavigation(event, item.path)}
        aria-label={getLabel(item.labelKey)}
        aria-current={isActive ? "page" : undefined}
        title={collapsed ? getLabel(item.labelKey) : undefined}
        className={cn(
          "flex items-center gap-3 rounded-[6px] px-3 py-2.5 transition-colors",
          SIDEBAR_NAV_TEXT,
          SIDEBAR_NAV_RESET,
          "text-[var(--app-text-secondary)] hover:bg-[var(--app-surface-hover)] hover:text-[var(--app-text-primary)]",
          isActive && "bg-[var(--app-surface-soft)] font-normal text-primary",
          collapsed && "justify-center",
        )}
      >
        <Icon
          className="h-5 w-5 flex-shrink-0"
          strokeWidth={SIDEBAR_ICON_STROKE}
        />
        {!collapsed && <span>{getLabel(item.labelKey)}</span>}
      </Link>
    );
  };

  return (
    <aside
      className={cn(
        "app-sidebar h-[calc(100%-16px)] rounded-[6px] relative flex flex-col transition-[width] duration-200 ease-out my-2 ml-2 mr-0 flex-shrink-0",
        collapsed ? "w-16" : "w-56",
      )}
      style={{ backgroundColor: SIDEBAR_BACKGROUND }}
    >
      {/* Header */}
      <div
        className={cn(
          "flex items-center px-3 pt-4 pb-4",
          collapsed ? "justify-center" : "justify-between",
        )}
      >
        {collapsed ? (
          <div className="flex h-8 w-8 items-center justify-center">
            {faviconUrl ? (
              <NextImage
                src={faviconUrl}
                alt="Icon"
                width={32}
                height={32}
                className="scale-[1.2] object-contain opacity-90"
                priority
                unoptimized
              />
            ) : (
              <div className="flex h-8 w-8 scale-[1.2] items-center justify-center rounded-[6px] bg-primary/50 text-[12px] font-light text-primary-foreground">
                V
              </div>
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
                  style={{
                    width: "auto",
                    height: "auto",
                    maxWidth: logoWidth,
                    maxHeight: logoHeight,
                  }}
                  className="object-contain"
                  priority
                  unoptimized
                />
              ) : (
                <div className="flex h-8 w-8 items-center justify-center rounded-[6px] bg-primary/50 text-[12px] font-light text-primary-foreground">
                  V
                </div>
              )}
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-[var(--app-text-tertiary)] hover:text-[var(--app-text-primary)] hover:bg-[var(--app-surface-hover)] rounded-[6px]"
              onClick={toggleCollapsed}
              aria-label="Recolher menu"
            >
              <ChevronLeft
                className="h-4 w-4"
                strokeWidth={SIDEBAR_CHEVRON_STROKE}
              />
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
          <ChevronRight
            className="h-3 w-3"
            strokeWidth={SIDEBAR_CHEVRON_STROKE}
          />
        </Button>
      )}

      {/* Navegação */}
      <nav
        className="flex-1 py-4 px-2 overflow-y-auto scrollbar-thin"
        aria-busy={navigationLoading}
      >
        <ul className="space-y-1">
          {navigationLoading
            ? Array.from({ length: 6 }, (_, index) => (
                <li key={`navigation-loading-${index}`} aria-hidden="true">
                  <div
                    className={cn(
                      "h-10 animate-pulse rounded-[6px] bg-[var(--app-surface-soft)]",
                      collapsed ? "mx-auto w-10" : "w-full",
                    )}
                  />
                </li>
              ))
            : navItems.map((item) => (
                <li key={item.path}>{renderNavItem(item)}</li>
              ))}
        </ul>
      </nav>

      {/* Bottom Itens */}
      <div className="py-3 px-2">
        <ul className="space-y-1">
          {navigationLoading ? (
            <li aria-hidden="true">
              <div
                className={cn(
                  "h-10 animate-pulse rounded-[6px] bg-[var(--app-surface-soft)]",
                  collapsed ? "mx-auto w-10" : "w-full",
                )}
              />
            </li>
          ) : (
            computedBottomItems.map((item) => (
              <li key={item.path}>{renderNavItem(item)}</li>
            ))
          )}
        </ul>
      </div>
    </aside>
  );
});
