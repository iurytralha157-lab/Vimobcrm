import { ReactNode, useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { cn } from '@/lib/utils';
import { AppSidebar } from './AppSidebar';
import { AppHeader } from './AppHeader';
import { MobileBottomNav } from './MobileBottomNav';
import { useIsMobile } from '@/hooks/use-mobile';
import { FloatingChatProvider } from '@/contexts/FloatingChatContext';
import { FloatingChat } from '@/components/features/chat/FloatingChat';
import { FloatingChatButton } from '@/components/features/chat/FloatingChatButton';
import { WhatsAppRealtimeBus } from '@/contexts/WhatsAppRealtimeBus';
import { LeadRealtimeBus } from '@/contexts/LeadRealtimeBus';
import { WebPushPrompt } from '@/components/features/pwa/WebPushPrompt';
import { SetupGuideDialog, SetupGuideTour } from '@/components/features/setup-guide';
import { usePushNotifications } from '@/hooks/use-push-notifications';
import { usePhoneReminder } from '@/hooks/use-phone-reminder';
import { useWhatsAppSound } from '@/hooks/use-whatsapp-sound';
import { useAuditFeed } from '@/hooks/use-audit-feed';
import { useUserActivitySession } from '@/hooks/use-user-activity-session';
import { useSystemSettings } from '@/hooks/use-system-settings';
import { useOrganizationModules } from '@/hooks/use-organization-modules';
import { useUserPermissions } from '@/hooks/use-user-permissions';
import { useAuth } from '@/contexts/AuthContext';
import { VimobLoader } from '@/components/shared/loading';
import { Wrench } from 'lucide-react';
import { canManageOrganization } from '@/lib/access/organization';
import { DEFAULT_AUTHENTICATED_ROUTE } from '@/config/constants';

const INITIAL_SIDEBAR_BOOT_FALLBACK_MS = 1400;
let hasCompletedInitialAppShellBoot = false;

interface AppLayoutProps {
  children: ReactNode;
  title?: string;
  belowHeader?: ReactNode;
  disableMainScroll?: boolean;
  borderless?: boolean;
}

function MaintenanceBanner() {
  const { data: settings } = useSystemSettings();
  const { profile, organization, tenantContext, isSuperAdmin, userOrganizations } = useAuth();

  const activeOrganizationId = organization?.id || profile?.organization_id;
  const activeMemberRole = userOrganizations.find((org) => org.organization_id === activeOrganizationId)?.member_role;
  const fallbackMemberRole = tenantContext && tenantContext.organizationId === activeOrganizationId
    ? tenantContext.memberRole
    : undefined;
  const isAdmin = canManageOrganization({ isSuperAdmin, memberRole: activeMemberRole || fallbackMemberRole });

  if (!settings?.maintenance_mode || isAdmin) return null;

  const message = settings.maintenance_message || 'O sistema está em manutenção. Por favor, aguarde.';

  return (
    <div className="flex w-full flex-shrink-0 items-center justify-center gap-3 bg-amber-500 px-4 py-2.5 text-white shadow-none">
      <Wrench className="h-4 w-4 shrink-0" />
      <span className="text-sm font-medium text-center">{message}</span>
    </div>
  );
}

function AppLayoutContent({ children, title, belowHeader, disableMainScroll = false, borderless = false }: AppLayoutProps) {
  const isMobile = useIsMobile();

  // Initialize native push notifications (only in Capacitor)
  usePushNotifications();

  // Daily reminder for users without phone number
  usePhoneReminder();
  useWhatsAppSound();
  useUserActivitySession({ currentPageTitle: title });
  useAuditFeed();

  return (
    <div className={cn("app-shell h-screen flex flex-col w-full overflow-hidden pt-[env(safe-area-inset-top)]", borderless && "app-layout-borderless")}>
      {/* Maintenance Banner — non-dismissible, shown before header */}
      <MaintenanceBanner />

      {/* Body: sidebar + content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Desktop sidebar fixa */}
        {!isMobile && (
          <div className="flex-shrink-0">
            <AppSidebar />
          </div>
        )}

        {/* Main content area */}
        <div className="flex-1 flex flex-col overflow-hidden min-h-0">
          {/* Header com título e ações */}
          <AppHeader title={title} />

          {belowHeader}

          {/* Conteúdo da página */}
          <main className={cn(
            "flex-1 min-h-0",
            disableMainScroll ? "overflow-hidden relative px-5 md:px-6 pt-2 md:pt-3 pb-3" : "overflow-y-auto overflow-x-hidden px-5 md:px-6 pt-2 md:pt-3 pb-6",
            isMobile && "pb-20"
          )}>
            {children}
          </main>
        </div>
      </div>

      {/* Mobile Bottom Navigation */}
      {isMobile && <MobileBottomNav />}

      {/* Floating WhatsApp Chat + Unified Realtime Bus */}
      <LeadRealtimeBus />
      <WhatsAppRealtimeBus />
      <FloatingChatButton />
      <FloatingChat />

      <WebPushPrompt />
      <SetupGuideDialog />
      <SetupGuideTour />
    </div>
  );
}

export function AppLayout({ children, title, belowHeader, disableMainScroll = false, borderless = false }: AppLayoutProps) {
  const {
    organization,
    user,
    isSuperAdmin,
    impersonating,
    loading,
    authInitialized,
    organizationsLoaded,
    isInitializingOrg,
    profile,
    tenantContext,
    userOrganizations,
    switchOrganization,
  } = useAuth();
  const { isLoading: modulesLoading } = useOrganizationModules();
  const { isLoading: permissionsLoading } = useUserPermissions();
  const [initialShellReady, setInitialShellReady] = useState(hasCompletedInitialAppShellBoot);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const linkedOrganizationId = searchParams.get('organization');
  const activeOrganizationId = organization?.id || profile?.organization_id;
  const isResolvingLinkedOrganization = Boolean(
    linkedOrganizationId
      && organizationsLoaded
      && activeOrganizationId !== linkedOrganizationId,
  );
  const allowInitialShell = Boolean(
    user &&
      authInitialized &&
      !loading &&
      (!organizationsLoaded || isInitializingOrg) &&
      (pathname?.startsWith('/dashboard') || pathname === DEFAULT_AUTHENTICATED_ROUTE),
  );
  const allowRender = !!organization || isSuperAdmin || !!impersonating || allowInitialShell;
  const hasSidebarTenantContext = Boolean(
    isSuperAdmin ||
      impersonating ||
      (activeOrganizationId && tenantContext?.organizationId === activeOrganizationId),
  );
  const sidebarBootReady =
    allowRender &&
    hasSidebarTenantContext &&
    !modulesLoading &&
    !permissionsLoading;

  useEffect(() => {
    if (
      !linkedOrganizationId
      || !organizationsLoaded
      || loading
      || isInitializingOrg
      || activeOrganizationId === linkedOrganizationId
    ) {
      return;
    }

    const canOpenLinkedOrganization = userOrganizations.some((item) => (
      item.organization_id === linkedOrganizationId && item.is_active
    ));
    if (!canOpenLinkedOrganization) {
      router.replace(DEFAULT_AUTHENTICATED_ROUTE);
      return;
    }

    let cancelled = false;
    void switchOrganization(linkedOrganizationId).catch(() => {
      if (!cancelled) router.replace(DEFAULT_AUTHENTICATED_ROUTE);
    });

    return () => {
      cancelled = true;
    };
  }, [
    activeOrganizationId,
    isInitializingOrg,
    linkedOrganizationId,
    loading,
    organizationsLoaded,
    router,
    switchOrganization,
    userOrganizations,
  ]);

  useEffect(() => {
    if (allowRender || loading || !authInitialized || !organizationsLoaded || isInitializingOrg) return;

    const hasSelectableOrganization = userOrganizations.some((org) => org.is_active);
    const redirectTo = pathname || DEFAULT_AUTHENTICATED_ROUTE;
    if (!hasSelectableOrganization) {
      router.replace('/select-organization');
      return;
    }

    const params = new URLSearchParams({ redirectTo });
    router.replace(`/select-organization?${params.toString()}`);
  }, [
    allowRender,
    authInitialized,
    isInitializingOrg,
    loading,
    organizationsLoaded,
    pathname,
    router,
    userOrganizations,
  ]);

  useEffect(() => {
    if (initialShellReady || !allowRender) return;

    if (sidebarBootReady) {
      const readyTimer = window.setTimeout(() => {
        hasCompletedInitialAppShellBoot = true;
        setInitialShellReady(true);
      }, 0);
      return () => window.clearTimeout(readyTimer);
    }

    const fallbackTimer = window.setTimeout(() => {
      hasCompletedInitialAppShellBoot = true;
      setInitialShellReady(true);
    }, INITIAL_SIDEBAR_BOOT_FALLBACK_MS);

    return () => window.clearTimeout(fallbackTimer);
  }, [allowRender, initialShellReady, sidebarBootReady]);

  if (!allowRender || isResolvingLinkedOrganization) {
    return (
      <div className="h-screen flex items-center justify-center bg-background">
        <VimobLoader size="lg" label="Carregando ambiente..." />
      </div>
    );
  }

  if (!initialShellReady) {
    return (
      <div className="h-screen flex items-center justify-center bg-background">
        <VimobLoader size="lg" label="Preparando menu..." />
      </div>
    );
  }

  return (
    <FloatingChatProvider>
      <AppLayoutContent title={title} belowHeader={belowHeader} disableMainScroll={disableMainScroll} borderless={borderless}>
        {children}
      </AppLayoutContent>
    </FloatingChatProvider>
  );
}
