"use client";

import Link from "next/link";
import NextImage from "next/image";
import { usePathname } from "next/navigation";
import { useMemo, useState, type ReactNode } from "react";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Loader2,
  LogOut,
  Menu,
  Moon,
  Settings,
  ShieldCheck,
  Sun,
  UserRound,
} from "lucide-react";
import { useTheme } from "next-themes";
import { toast } from "sonner";

import {
  ADMIN_MAIN_NAV_ITEMS,
  ADMIN_NAV_ITEMS,
  ADMIN_SETTINGS_NAV_ITEMS,
  type AdminNavItem,
} from "@/components/features/admin/admin-navigation";
import { VimobLoader } from "@/components/shared/loading";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { useAuth } from "@/contexts/AuthContext";
import { SidebarProvider, useSidebar } from "@/contexts/SidebarContext";
import { useSystemSettings } from "@/hooks/use-system-settings";
import { cn } from "@/lib/utils";
import { DEFAULT_AUTHENTICATED_ROUTE } from "@/config/constants";

const DEFAULT_BRAND_LOGO_DARK = "/images/logo-white.png";
const DEFAULT_BRAND_LOGO_LIGHT = "/images/logo-black.png";
const DEFAULT_BRAND_ICON = "/icons/favicon-laranja.png";
const SIDEBAR_BACKGROUND = "var(--app-sidebar)";
const SIDEBAR_ICON_STROKE = 1.6;
const SIDEBAR_CHEVRON_STROKE = 1.7;

type SidebarNavItem = AdminNavItem & {
  children?: AdminNavItem[];
};

function getInitials(name?: string | null) {
  if (!name) return "SA";
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function getPageTitle(pathname: string) {
  if (pathname.startsWith("/admin/organizations/")) {
    return "Organização";
  }

  const exactMatch = ADMIN_NAV_ITEMS.find((item) => item.href === pathname);
  if (exactMatch) return exactMatch.title;

  const nestedMatch = [...ADMIN_NAV_ITEMS]
    .sort((a, b) => b.href.length - a.href.length)
    .find((item) => item.href !== "/admin" && pathname.startsWith(`${item.href}/`));

  return nestedMatch?.title || "Dashboard Super Admin";
}

function isPathActive(pathname: string, item: SidebarNavItem, options?: { parent?: boolean }) {
  if (item.href === "/admin") return pathname === "/admin";
  if (pathname !== item.href && !pathname.startsWith(`${item.href}/`)) return false;
  return options?.parent ? true : pathname === item.href;
}

function SuperAdminSidebar({
  pathname,
  onNavigate,
}: {
  pathname: string;
  onNavigate?: () => void;
}) {
  const { collapsed, toggleCollapsed } = useSidebar();
  const { data: systemSettings } = useSystemSettings();
  const { resolvedTheme } = useTheme();
  const isCollapsed = collapsed;

  const logoUrl = useMemo(() => {
    if (!systemSettings) return null;
    return resolvedTheme === "dark"
      ? systemSettings.logo_url_dark || systemSettings.logo_url_light
      : systemSettings.logo_url_light || systemSettings.logo_url_dark;
  }, [systemSettings, resolvedTheme]);

  const displayLogoUrl = logoUrl || (resolvedTheme === "dark" ? DEFAULT_BRAND_LOGO_DARK : DEFAULT_BRAND_LOGO_LIGHT);
  const faviconUrl = DEFAULT_BRAND_ICON;
  const logoWidth = systemSettings?.logo_width || 120;
  const logoHeight = systemSettings?.logo_height || 32;
  const bottomItems: SidebarNavItem[] = [
    {
      section: "settings",
      title: "Configurações",
      shortTitle: "Configurações",
      description: "Configurações globais do painel superadmin.",
      href: "/admin/settings",
      icon: Settings,
      group: "settings",
      children: ADMIN_SETTINGS_NAV_ITEMS,
    },
  ];

  const isActiveParent = (item: SidebarNavItem) => {
    if (item.children) {
      return isPathActive(pathname, item, { parent: true }) || item.children.some((child) => isPathActive(pathname, child));
    }
    return isPathActive(pathname, item, { parent: true });
  };

  const renderNavItem = (item: SidebarNavItem) => {
    const Icon = item.icon;
    const isActive = item.children ? isActiveParent(item) : isPathActive(pathname, item, { parent: true });
    const label = item.shortTitle || item.title;

    if (item.children) {
      return (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className={cn(
                "flex w-full items-center gap-3 rounded-[6px] px-3 py-2.5 text-sm font-light transition-colors",
                "text-[var(--app-text-secondary)] hover:bg-[var(--app-surface-hover)] hover:text-[var(--app-text-primary)]",
                isActive && "bg-[var(--app-surface-soft)] text-primary font-normal",
                isCollapsed && "justify-center",
              )}
              aria-label={label}
            >
              <Icon className="h-5 w-5 flex-shrink-0" strokeWidth={SIDEBAR_ICON_STROKE} />
              {!isCollapsed && (
                <>
                  <span className="flex-1 text-left">{label}</span>
                  <ChevronRight className="h-4 w-4 text-[var(--app-text-tertiary)]" strokeWidth={SIDEBAR_CHEVRON_STROKE} />
                </>
              )}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            side="right"
            align="start"
            sideOffset={8}
            className="app-sidebar-popover w-60 rounded-[8px] border-0 p-1 text-[var(--app-text-primary)] shadow-none"
          >
            {item.children.map((child) => {
              const ChildIcon = child.icon;
              const childActive = isPathActive(pathname, child);

              return (
                <DropdownMenuItem
                  key={child.href}
                  asChild
                  className={cn(
                    "cursor-pointer rounded-[6px] p-0 text-[var(--app-text-secondary)] outline-none focus:bg-[var(--app-surface-hover)] focus:text-[var(--app-text-primary)]",
                    childActive && "bg-[var(--app-surface-soft)] text-primary",
                  )}
                >
                  <Link
                    href={child.href}
                    onClick={onNavigate}
                    aria-current={childActive ? "page" : undefined}
                    className="flex w-full items-center gap-3 px-3 py-2.5"
                  >
                    <ChildIcon className="h-4 w-4 flex-shrink-0" strokeWidth={SIDEBAR_ICON_STROKE} />
                    <span className="text-sm font-light">{child.shortTitle || child.title}</span>
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
        href={item.href}
        onClick={onNavigate}
        aria-current={pathname === item.href ? "page" : undefined}
        className={cn(
          "flex items-center gap-3 rounded-[6px] px-3 py-2.5 text-sm font-light transition-colors",
          "text-[var(--app-text-secondary)] hover:bg-[var(--app-surface-hover)] hover:text-[var(--app-text-primary)]",
          isActive && "bg-[var(--app-surface-soft)] text-primary font-normal",
          isCollapsed && "justify-center",
        )}
      >
        <Icon className="h-5 w-5 flex-shrink-0" strokeWidth={SIDEBAR_ICON_STROKE} />
        {!isCollapsed && <span>{label}</span>}
      </Link>
    );
  };

  return (
    <aside
      className={cn(
        "relative my-2 ml-2 mr-0 flex h-[calc(100%-16px)] flex-shrink-0 flex-col rounded-[6px] transition-[width] duration-200",
        isCollapsed ? "w-16" : "w-56",
      )}
      style={{ backgroundColor: SIDEBAR_BACKGROUND }}
    >
      <div className={cn("flex items-center px-3 pt-4 pb-4", isCollapsed ? "justify-center" : "justify-between")}>
        {isCollapsed ? (
          <div className="flex h-8 w-8 items-center justify-center">
            <NextImage src={faviconUrl} alt="Vimob" width={32} height={32} className="object-contain opacity-90" priority unoptimized />
          </div>
        ) : (
          <>
            <div className="flex items-center">
              <NextImage
                src={displayLogoUrl}
                alt="Vimob"
                width={logoWidth}
                height={logoHeight}
                style={{ maxWidth: logoWidth, maxHeight: logoHeight }}
                className="object-contain"
                priority
                unoptimized
              />
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-[var(--app-text-tertiary)] hover:text-[var(--app-text-primary)] hover:bg-[var(--app-surface-hover)] rounded-[6px]"
              onClick={toggleCollapsed}
              aria-label="Recolher menu"
            >
              <ChevronLeft className="h-4 w-4" strokeWidth={SIDEBAR_CHEVRON_STROKE} />
            </Button>
          </>
        )}
      </div>

      {isCollapsed && (
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

      <nav className="flex-1 overflow-y-auto px-2 py-4 scrollbar-thin">
        <ul className="space-y-1">
          {ADMIN_MAIN_NAV_ITEMS.map((item) => (
            <li key={item.href}>{renderNavItem(item)}</li>
          ))}
        </ul>
      </nav>

      <div className="py-3 px-2">
        <ul className="space-y-1">
          {bottomItems.map((item) => (
            <li key={item.href}>{renderNavItem(item)}</li>
          ))}
        </ul>
      </div>
    </aside>
  );
}

function SuperAdminMobileSidebar({
  pathname,
  onNavigate,
}: {
  pathname: string;
  onNavigate: () => void;
}) {
  const { data: systemSettings } = useSystemSettings();
  const { resolvedTheme } = useTheme();
  const [settingsOpen, setSettingsOpen] = useState(() =>
    ADMIN_SETTINGS_NAV_ITEMS.some((item) => isPathActive(pathname, item)),
  );

  const logoUrl = useMemo(() => {
    if (!systemSettings) return null;
    return resolvedTheme === "dark"
      ? systemSettings.logo_url_dark || systemSettings.logo_url_light
      : systemSettings.logo_url_light || systemSettings.logo_url_dark;
  }, [systemSettings, resolvedTheme]);

  const displayLogoUrl = logoUrl || (resolvedTheme === "dark" ? DEFAULT_BRAND_LOGO_DARK : DEFAULT_BRAND_LOGO_LIGHT);
  const logoWidth = systemSettings?.logo_width || 120;
  const logoHeight = systemSettings?.logo_height || 32;
  const settingsActive = ADMIN_SETTINGS_NAV_ITEMS.some((item) => isPathActive(pathname, item));

  const renderMobileLink = (item: AdminNavItem, compact = false) => {
    const Icon = item.icon;
    const active = isPathActive(pathname, item, { parent: true });

    return (
      <Link
        key={item.href}
        href={item.href}
        onClick={onNavigate}
        className={cn(
          "flex w-full items-center gap-3 rounded-[6px] px-3 text-sm font-light transition-colors",
          compact ? "py-2.5 text-[13px]" : "py-3",
          active
            ? "bg-[var(--app-surface-soft)] text-primary font-normal"
            : "text-[var(--app-text-secondary)] hover:bg-[var(--app-surface-hover)] hover:text-[var(--app-text-primary)]",
        )}
        aria-current={pathname === item.href ? "page" : undefined}
      >
        <Icon className={cn("shrink-0", compact ? "h-4 w-4" : "h-5 w-5")} strokeWidth={SIDEBAR_ICON_STROKE} />
        <span className="truncate">{item.shortTitle || item.title}</span>
      </Link>
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col text-[var(--app-text-primary)]">
      <div className="shrink-0 p-4 pr-12">
        <div className="relative h-8" style={{ width: logoWidth, maxWidth: 148 }}>
          <NextImage
            src={displayLogoUrl}
            alt="Vimob"
            width={logoWidth}
            height={logoHeight}
            style={{ maxWidth: Math.min(logoWidth, 148), maxHeight: logoHeight }}
            className="object-contain object-left"
            priority
            unoptimized
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3 scrollbar-thin touch-pan-y [-webkit-overflow-scrolling:touch]">
        <nav>
          <ul className="space-y-1">
            {ADMIN_MAIN_NAV_ITEMS.map((item) => (
              <li key={item.href}>{renderMobileLink(item)}</li>
            ))}
          </ul>
        </nav>

        <div className="mt-6 border-t border-white/[0.045] pt-3">
          <button
            type="button"
            onClick={() => setSettingsOpen((open) => !open)}
            className={cn(
              "flex w-full items-center justify-between rounded-[6px] px-3 py-3 text-sm font-light transition-colors",
              settingsActive
                ? "bg-[var(--app-surface-soft)] text-primary font-normal"
                : "text-[var(--app-text-secondary)] hover:bg-[var(--app-surface-hover)] hover:text-[var(--app-text-primary)]",
            )}
            aria-expanded={settingsOpen}
            aria-controls="superadmin-mobile-settings-nav"
          >
            <span className="flex min-w-0 items-center gap-3">
              <Settings className="h-5 w-5 shrink-0" strokeWidth={SIDEBAR_ICON_STROKE} />
              <span className="truncate">Configurações</span>
            </span>
            {settingsOpen ? (
              <ChevronDown className="h-4 w-4 opacity-60" strokeWidth={SIDEBAR_CHEVRON_STROKE} />
            ) : (
              <ChevronRight className="h-4 w-4 opacity-60" strokeWidth={SIDEBAR_CHEVRON_STROKE} />
            )}
          </button>

          {settingsOpen && (
            <ul id="superadmin-mobile-settings-nav" className="mt-1 space-y-1 pl-4">
              {ADMIN_SETTINGS_NAV_ITEMS.map((item) => (
                <li key={item.href}>{renderMobileLink(item, true)}</li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

export function SuperAdminLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname() || "";
  const { loading, isSuperAdmin, profile, signOut } = useAuth();
  const { resolvedTheme, setTheme } = useTheme();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);

  const accountLabel = profile?.name?.trim() || "Nome não informado";
  const accountEmail = profile?.email?.trim() || "E-mail não informado";
  const isDarkTheme = resolvedTheme === "dark";

  const pageTitle = useMemo(() => getPageTitle(pathname), [pathname]);

  const handleSignOut = async () => {
    if (isSigningOut) return;
    setIsSigningOut(true);
    try {
      await signOut();
    } catch (error) {
      console.error("Erro ao sair do painel superadmin:", error);
      toast.error("Não foi possível encerrar a sessão. Tente novamente.");
      setIsSigningOut(false);
    }
  };

  if (loading) {
    return (
      <div
        className="flex h-[100dvh] items-center justify-center bg-[var(--app-background)]"
        role="status"
        aria-live="polite"
      >
        <VimobLoader size="lg" label="Carregando painel super admin..." />
      </div>
    );
  }

  if (!isSuperAdmin) {
    return (
      <div className="app-shell flex min-h-[100dvh] items-center justify-center bg-[var(--app-background)] p-6">
        <section className="app-card max-w-xl p-6 text-center" aria-labelledby="superadmin-access-title">
          <ShieldCheck className="mx-auto mb-4 h-10 w-10 text-primary" />
          <h1 id="superadmin-access-title" className="app-page-title">Painel exclusivo para superadmin</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Esta área centraliza dados de plataforma e não fica disponível para usuários comuns ou admins de organização.
          </p>
          <Button asChild className="mt-5 bg-primary text-primary-foreground shadow-none hover:bg-primary/90">
            <Link href={DEFAULT_AUTHENTICATED_ROUTE}>Sair desta área</Link>
          </Button>
        </section>
      </div>
    );
  }

  return (
    <SidebarProvider>
      <div className="app-shell flex h-[100dvh] w-full flex-col overflow-hidden pt-[env(safe-area-inset-top)]">
        <div className="flex flex-1 overflow-hidden">
        <div className="hidden flex-shrink-0 lg:block">
          <SuperAdminSidebar pathname={pathname} />
        </div>

        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetContent
            id="superadmin-mobile-navigation"
            side="left"
            className="flex h-[100dvh] max-h-[100dvh] w-[292px] max-w-[86vw] flex-col overflow-hidden border-0 border-r-0 bg-[var(--app-sidebar)] p-0 text-[var(--app-text-primary)] data-[state=closed]:duration-150 data-[state=open]:duration-200"
          >
            <SheetTitle className="sr-only">Menu superadmin</SheetTitle>
            <SheetDescription className="sr-only">Navegação do painel superadmin.</SheetDescription>
            <SuperAdminMobileSidebar pathname={pathname} onNavigate={() => setMobileOpen(false)} />
          </SheetContent>
        </Sheet>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <header className="relative sticky top-0 z-40 flex h-16 shrink-0 items-center bg-[var(--app-background)] px-4 after:absolute after:bottom-0 after:left-4 after:right-4 after:h-px after:bg-[var(--app-border)] md:px-6 md:after:left-6 md:after:right-6">
            <Button
              variant="ghost"
              size="icon"
              className="mr-3 rounded-[6px] lg:hidden"
              onClick={() => setMobileOpen(true)}
              aria-label="Abrir menu superadmin"
              aria-expanded={mobileOpen}
              aria-controls="superadmin-mobile-navigation"
            >
              <Menu className="h-5 w-5" strokeWidth={SIDEBAR_CHEVRON_STROKE} />
            </Button>

            <h1 className="app-page-title max-w-[180px] truncate sm:max-w-none">
              {pageTitle}
            </h1>

            <div className="ml-auto flex items-center gap-3">
              <Button
                variant="ghost"
                size="icon"
                className="h-10 w-10 rounded-[6px] bg-[var(--app-surface-soft)] text-muted-foreground hover:bg-[var(--app-surface-hover)] hover:text-foreground"
                onClick={() => setTheme(isDarkTheme ? "light" : "dark")}
                aria-label={isDarkTheme ? "Ativar tema claro" : "Ativar tema escuro"}
                title={isDarkTheme ? "Ativar tema claro" : "Ativar tema escuro"}
              >
                {isDarkTheme ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    className="group h-11 gap-3 rounded-[6px] bg-[var(--app-surface-soft)] pl-1.5 pr-2 shadow-none transition-colors hover:bg-[var(--app-surface-hover)]"
                    aria-label={`Abrir menu da conta de ${accountLabel}`}
                  >
                    <Avatar className="h-8 w-8 border border-[var(--app-border)]">
                      {profile?.avatar_url ? (
                        <AvatarImage src={profile.avatar_url} alt="" className="object-cover" />
                      ) : (
                        <AvatarImage src={undefined} alt="" />
                      )}
                      <AvatarFallback className="bg-primary text-xs font-normal text-primary-foreground">
                        {getInitials(profile?.name)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="hidden flex-col items-start gap-0.5 pr-1 text-left sm:flex">
                      <span className="max-w-[130px] truncate text-xs font-normal leading-none text-foreground">
                        {accountLabel}
                      </span>
                      <span className="max-w-[130px] truncate text-[10px] leading-none text-muted-foreground/80">
                        {accountEmail}
                      </span>
                    </div>
                    <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-[6px] bg-[var(--app-surface-hover)] transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                      <ChevronDown className="h-3 w-3" />
                    </div>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  sideOffset={12}
                  collisionPadding={16}
                  className="app-header-popover w-56 rounded-[8px] border-0 p-1 shadow-none"
                >
                  <div className="border-b border-[var(--app-border)] px-3 py-3">
                    <p className="truncate text-sm font-normal">{accountLabel}</p>
                    <p className="truncate text-[10px] text-muted-foreground">{accountEmail}</p>
                  </div>
                  <div className="mt-1">
                    <DropdownMenuItem asChild className="m-1 cursor-pointer rounded-[4px] p-0 text-sm">
                      <Link href="/admin/settings" className="flex w-full items-center gap-2 px-3 py-2">
                        <UserRound className="h-4 w-4 text-muted-foreground" />
                        Conta
                      </Link>
                    </DropdownMenuItem>
                  </div>
                  <DropdownMenuSeparator className="my-1 bg-[var(--app-border)]" />
                  <DropdownMenuItem
                    onSelect={(event) => {
                      event.preventDefault();
                      void handleSignOut();
                    }}
                    disabled={isSigningOut}
                    aria-busy={isSigningOut}
                    className="m-1 cursor-pointer gap-2 rounded-[4px] bg-destructive px-3 py-2 text-sm text-destructive-foreground transition-colors hover:bg-destructive/90 focus:bg-destructive/90"
                  >
                    {isSigningOut ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
                    {isSigningOut ? "Saindo..." : "Sair"}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </header>

          <main className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain px-4 pb-6 pt-2 [-webkit-overflow-scrolling:touch] md:px-6 md:pt-3">
            {children}
          </main>
        </div>
      </div>
      </div>
    </SidebarProvider>
  );
}
