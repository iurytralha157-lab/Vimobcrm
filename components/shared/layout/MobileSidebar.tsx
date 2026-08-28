"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import NextImage from "next/image";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useTheme } from "next-themes";
import { isBillingAccessBlocked } from "@/lib/billing-access";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { useOrganizationModules } from "@/hooks/use-organization-modules";
import { useUserPermissions } from "@/hooks/use-user-permissions";
import { useLocationHash } from "@/hooks/use-location-hash";
import { canUseFinancialModule } from "@/lib/financial-access";
import { canManageOrganization } from "@/lib/access/organization";
import {
  filterNavigationItems,
  getNavigationLocationKey,
  isNavigationPathActive,
} from "@/lib/access/navigation";
import { ChevronDown, ChevronRight, Menu } from "lucide-react";
import {
  APP_BOTTOM_NAVIGATION_ITEMS,
  APP_NAVIGATION_ITEMS,
  BILLING_NAVIGATION_ITEM,
  type AppNavigationItem,
} from "@/config/navigation";
import { getNavigationIcon } from "./navigation-icons";

const DEFAULT_BRAND_LOGO_DARK = "/images/logo-white.png";
const DEFAULT_BRAND_LOGO_LIGHT = "/images/logo-black.png";
const MOBILE_LOGO_WIDTH = 120;
const MOBILE_LOGO_HEIGHT = 40;
const SIDEBAR_BACKGROUND = "var(--app-sidebar)";
const SIDEBAR_ICON_STROKE = 1.32;
const SIDEBAR_CHEVRON_STROKE = 1.4;
const SIDEBAR_NAV_RESET =
  "border-0 shadow-none outline-none ring-0 focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0";
const SIDEBAR_NAV_TEXT =
  "font-sans text-[12px] font-light leading-none";
const SIDEBAR_NAV_CHILD_TEXT =
  "font-sans text-[12px] font-light leading-none";

interface MobileSidebarProps {
  externalOpen?: boolean;
  onExternalOpenChange?: (open: boolean) => void;
}

export function MobileSidebar({
  externalOpen,
  onExternalOpenChange,
}: MobileSidebarProps = {}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const { resolvedTheme } = useTheme();

  const isControlled = externalOpen !== undefined;
  const open = isControlled ? externalOpen : internalOpen;
  const setOpen = isControlled
    ? (v: boolean) => onExternalOpenChange?.(v)
    : setInternalOpen;
  const [menuOpenOverrides, setMenuOpenOverrides] = useState<
    Record<string, boolean>
  >({});
  const pathname = usePathname() || "";
  const searchParams = useSearchParams();
  const currentHash = useLocationHash();
  const locationKey = getNavigationLocationKey(
    pathname,
    searchParams,
    currentHash,
  );
  const previousLocationKeyRef = useRef(locationKey);
  const {
    profile,
    isSuperAdmin,
    organization,
    tenantContext,
    userOrganizations,
  } = useAuth();
  const { t } = useLanguage();
  const { hasModule } = useOrganizationModules();
  const { hasPermission } = useUserPermissions();
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
  const isBillingBlocked =
    !isSuperAdmin && isBillingAccessBlocked(organization);
  const canAccessFinancialModule = canUseFinancialModule({
    id: activeOrganizationId,
    name: organization?.name || activeOrganizationMembership?.organization_name,
  });
  const canAccessAdminItems = canManageOrganization({
    isSuperAdmin,
    memberRole: activeMemberRole,
  });

  const navItems = useMemo(() => {
    if (isBillingBlocked) return [BILLING_NAVIGATION_ITEM];

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
    if (previousLocationKeyRef.current === locationKey) return;
    previousLocationKeyRef.current = locationKey;

    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      setMenuOpenOverrides({});
      if (isControlled) {
        onExternalOpenChange?.(false);
      } else {
        setInternalOpen(false);
      }
    });

    return () => {
      active = false;
    };
  }, [isControlled, locationKey, onExternalOpenChange]);

  const toggleMenu = (path: string, defaultOpen: boolean) => {
    setMenuOpenOverrides((previous) => ({
      ...previous,
      [path]: !(previous[path] ?? defaultOpen),
    }));
  };

  const isMenuOpen = (path: string, defaultOpen: boolean) =>
    menuOpenOverrides[path] ?? defaultOpen;

  const isPathActive = (path: string, options?: { parent?: boolean }) =>
    isNavigationPathActive(path, pathname, searchParams, {
      ...options,
      currentHash,
    });

  const isActiveParent = (item: AppNavigationItem) => {
    if (item.children) {
      return (
        isPathActive(item.path, { parent: true }) ||
        item.children.some((child) =>
          isPathActive(
            child.path,
            child.matchSection ? { parent: true } : undefined,
          ),
        )
      );
    }
    return isPathActive(item.path, { parent: true });
  };

  const brandLogoUrl =
    resolvedTheme === "dark"
      ? DEFAULT_BRAND_LOGO_DARK
      : DEFAULT_BRAND_LOGO_LIGHT;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      {!isControlled && (
        <SheetTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden text-[var(--app-text-tertiary)] hover:text-[var(--app-text-primary)] hover:bg-[var(--app-surface-hover)] rounded-[6px]"
            aria-label="Abrir menu principal"
          >
            <Menu className="h-5 w-5" strokeWidth={SIDEBAR_CHEVRON_STROKE} />
          </Button>
        </SheetTrigger>
      )}
      <SheetContent
        side="left"
        className="app-sidebar w-[280px] border-0 border-r-0 p-0 flex flex-col text-[var(--app-text-primary)] data-[state=open]:duration-200 data-[state=closed]:duration-150"
        style={{ backgroundColor: SIDEBAR_BACKGROUND }}
      >
        <SheetTitle className="sr-only">Menu principal</SheetTitle>
        <SheetDescription className="sr-only">
          Navegação principal do Vimob CRM.
        </SheetDescription>

        {/* Logo header */}
        <div className="p-4 pr-12">
          <div className="flex h-7 w-[108px] items-center">
            <NextImage
              src={brandLogoUrl}
              alt="Logo"
              width={MOBILE_LOGO_WIDTH}
              height={MOBILE_LOGO_HEIGHT}
              style={{
                width: "auto",
                height: "auto",
                maxWidth: 108,
                maxHeight: 28,
              }}
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
              const isActive = isActiveParent(item);
              const isOpen = isMenuOpen(item.path, isActive);
              const Icon = getNavigationIcon(item.icon);

              if (item.children) {
                return (
                  <li key={item.path}>
                    <button
                      type="button"
                      onClick={() => toggleMenu(item.path, isActive)}
                      aria-expanded={isOpen}
                      aria-current={isActiveParent(item) ? "page" : undefined}
                      className={cn(
                        "w-full flex items-center justify-between px-3 py-3 rounded-[6px] transition-colors",
                        SIDEBAR_NAV_TEXT,
                        SIDEBAR_NAV_RESET,
                        isActiveParent(item)
                          ? "bg-[var(--app-surface-soft)] font-normal text-primary"
                          : "text-[var(--app-text-secondary)] hover:bg-[var(--app-surface-hover)] hover:text-[var(--app-text-primary)]",
                      )}
                    >
                      <div className="flex items-center gap-3">
                        <Icon
                          className="h-5 w-5"
                          strokeWidth={SIDEBAR_ICON_STROKE}
                        />
                        <span>{getLabel(item.labelKey)}</span>
                      </div>
                      {isOpen ? (
                        <ChevronDown
                          className="h-4 w-4 opacity-50"
                          strokeWidth={SIDEBAR_CHEVRON_STROKE}
                        />
                      ) : (
                        <ChevronRight
                          className="h-4 w-4 opacity-50"
                          strokeWidth={SIDEBAR_CHEVRON_STROKE}
                        />
                      )}
                    </button>
                    {isOpen && (
                      <ul className="ml-4 mt-1 space-y-1 pl-3">
                        {item.children.map((child) => {
                          const ChildIcon = getNavigationIcon(child.icon);
                          return (
                            <li key={child.path}>
                              <Link
                                href={child.path}
                                onClick={() => setOpen(false)}
                                aria-current={
                                  isPathActive(
                                    child.path,
                                    child.matchSection
                                      ? { parent: true }
                                      : undefined,
                                  )
                                    ? "page"
                                    : undefined
                                }
                                className={cn(
                                  "w-full flex items-center gap-3 px-3 py-2.5 rounded-[6px] transition-colors",
                                  SIDEBAR_NAV_CHILD_TEXT,
                                  SIDEBAR_NAV_RESET,
                                  isPathActive(
                                    child.path,
                                    child.matchSection
                                      ? { parent: true }
                                      : undefined,
                                  )
                                    ? "bg-[var(--app-surface-soft)] font-normal text-primary"
                                    : "text-[var(--app-text-tertiary)] hover:bg-[var(--app-surface-hover)] hover:text-[var(--app-text-primary)]",
                                )}
                              >
                                <ChildIcon
                                  className="h-4 w-4"
                                  strokeWidth={SIDEBAR_ICON_STROKE}
                                />
                                <span>{getLabel(child.labelKey)}</span>
                              </Link>
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
                  <Link
                    href={item.path}
                    onClick={() => setOpen(false)}
                    aria-current={isActiveParent(item) ? "page" : undefined}
                    className={cn(
                      "w-full flex items-center gap-3 px-3 py-3 rounded-[6px] transition-colors",
                      SIDEBAR_NAV_TEXT,
                      SIDEBAR_NAV_RESET,
                      isActiveParent(item)
                        ? "bg-[var(--app-surface-soft)] font-normal text-primary"
                        : "text-[var(--app-text-secondary)] hover:bg-[var(--app-surface-hover)] hover:text-[var(--app-text-primary)]",
                    )}
                  >
                    <Icon
                      className="h-5 w-5"
                      strokeWidth={SIDEBAR_ICON_STROKE}
                    />
                    <span>{getLabel(item.labelKey)}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* Bottom items */}
        <div className="py-3 px-3">
          <ul className="space-y-1">
            {computedBottomItems.map((item) => {
              const Icon = getNavigationIcon(item.icon);
              const isActive = isActiveParent(item);
              const isOpen = isMenuOpen(item.path, isActive);

              if (item.children) {
                return (
                  <li key={item.path}>
                    <button
                      type="button"
                      onClick={() => toggleMenu(item.path, isActive)}
                      aria-expanded={isOpen}
                      aria-current={isActiveParent(item) ? "page" : undefined}
                      className={cn(
                        "w-full flex items-center justify-between px-3 py-3 rounded-[6px] transition-colors",
                        SIDEBAR_NAV_TEXT,
                        SIDEBAR_NAV_RESET,
                        isActiveParent(item)
                          ? "bg-[var(--app-surface-soft)] font-normal text-primary"
                          : "text-[var(--app-text-secondary)] hover:bg-[var(--app-surface-hover)] hover:text-[var(--app-text-primary)]",
                      )}
                    >
                      <div className="flex items-center gap-3">
                        <Icon
                          className="h-5 w-5"
                          strokeWidth={SIDEBAR_ICON_STROKE}
                        />
                        <span>{getLabel(item.labelKey)}</span>
                      </div>
                      {isOpen ? (
                        <ChevronDown
                          className="h-4 w-4 opacity-50"
                          strokeWidth={SIDEBAR_CHEVRON_STROKE}
                        />
                      ) : (
                        <ChevronRight
                          className="h-4 w-4 opacity-50"
                          strokeWidth={SIDEBAR_CHEVRON_STROKE}
                        />
                      )}
                    </button>
                    {isOpen && (
                      <ul className="ml-4 mt-1 space-y-1 pl-3">
                        {item.children.map((child) => {
                          const ChildIcon = getNavigationIcon(child.icon);

                          return (
                            <li key={child.path}>
                              <Link
                                href={child.path}
                                onClick={() => setOpen(false)}
                                aria-current={
                                  isPathActive(
                                    child.path,
                                    child.matchSection
                                      ? { parent: true }
                                      : undefined,
                                  )
                                    ? "page"
                                    : undefined
                                }
                                className={cn(
                                  "w-full flex items-center gap-3 px-3 py-2.5 rounded-[6px] transition-colors",
                                  SIDEBAR_NAV_CHILD_TEXT,
                                  SIDEBAR_NAV_RESET,
                                  isPathActive(
                                    child.path,
                                    child.matchSection
                                      ? { parent: true }
                                      : undefined,
                                  )
                                    ? "bg-[var(--app-surface-soft)] font-normal text-primary"
                                    : "text-[var(--app-text-tertiary)] hover:bg-[var(--app-surface-hover)] hover:text-[var(--app-text-primary)]",
                                )}
                              >
                                <ChildIcon
                                  className="h-4 w-4"
                                  strokeWidth={SIDEBAR_ICON_STROKE}
                                />
                                <span>{getLabel(child.labelKey)}</span>
                              </Link>
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
                  <Link
                    href={item.path}
                    onClick={() => setOpen(false)}
                    aria-current={isActiveParent(item) ? "page" : undefined}
                    className={cn(
                      "w-full flex items-center gap-3 px-3 py-3 rounded-[6px] transition-colors",
                      SIDEBAR_NAV_TEXT,
                      SIDEBAR_NAV_RESET,
                      isActiveParent(item)
                        ? "bg-[var(--app-surface-soft)] font-normal text-primary"
                        : "text-[var(--app-text-secondary)] hover:bg-[var(--app-surface-hover)] hover:text-[var(--app-text-primary)]",
                    )}
                  >
                    <Icon
                      className="h-5 w-5"
                      strokeWidth={SIDEBAR_ICON_STROKE}
                    />
                    <span>{getLabel(item.labelKey)}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      </SheetContent>
    </Sheet>
  );
}
