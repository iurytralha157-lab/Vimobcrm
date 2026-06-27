import { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { AppSidebar } from './AppSidebar';
import { AppHeader } from './AppHeader';
import { MobileBottomNav } from './MobileBottomNav';
import { AnnouncementBanner } from '@/components/features/announcements/AnnouncementBanner';
import { useIsMobile } from '@/hooks/use-mobile';
import { FloatingChatProvider } from '@/contexts/FloatingChatContext';
import { FloatingChat } from '@/components/features/chat/FloatingChat';
import { FloatingChatButton } from '@/components/features/chat/FloatingChatButton';
import { WhatsAppRealtimeBus } from '@/contexts/WhatsAppRealtimeBus';
import { LeadRealtimeBus } from '@/contexts/LeadRealtimeBus';
import { BackendRealtimeBus } from '@/contexts/BackendRealtimeBus';
import { InstallPrompt } from '@/components/features/pwa/InstallPrompt';
import { WebPushPrompt } from '@/components/features/pwa/WebPushPrompt';
import { useWhatsAppHealthMonitor } from '@/hooks/use-whatsapp-health-monitor';
import { usePushNotifications } from '@/hooks/use-push-notifications';
import { usePhoneReminder } from '@/hooks/use-phone-reminder';
import { useWhatsAppSound } from '@/hooks/use-whatsapp-sound';
import { useSystemSettings } from '@/hooks/use-system-settings';
import { useAuth } from '@/contexts/AuthContext';
import { VimobLoader } from '@/components/shared/loading';
import { Wrench } from 'lucide-react';

interface AppLayoutProps {
  children: ReactNode;
  title?: string;
  disableMainScroll?: boolean;
  borderless?: boolean;
}

function MaintenanceBanner() {
  const { data: settings } = useSystemSettings();
  const { profile, isSuperAdmin } = useAuth();

  const isAdmin = profile?.role === 'admin' || profile?.role === 'super_admin' || isSuperAdmin;

  if (!settings?.maintenance_mode || isAdmin) return null;

  const message = settings.maintenance_message || 'O sistema está em manutenção. Por favor, aguarde.';

  return (
    <div className="w-full bg-amber-500 text-white py-2.5 px-4 flex items-center justify-center gap-3 shadow-md flex-shrink-0">
      <Wrench className="h-4 w-4 shrink-0" />
      <span className="text-sm font-medium text-center">{message}</span>
    </div>
  );
}

function AppLayoutContent({ children, title, disableMainScroll = false, borderless = false }: AppLayoutProps) {
  const isMobile = useIsMobile();

  // Start WhatsApp session health monitoring
  useWhatsAppHealthMonitor();

  // Initialize native push notifications (only in Capacitor)
  usePushNotifications();

  // Daily reminder for users without phone number
  usePhoneReminder();
  useWhatsAppSound();

  return (
    <div className={cn("app-shell h-screen flex flex-col w-full overflow-hidden pt-[env(safe-area-inset-top)]", borderless && "app-layout-borderless")}>
      {/* Maintenance Banner — non-dismissible, shown before header */}
      <MaintenanceBanner />
      <AnnouncementBanner />

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
      <BackendRealtimeBus />
      <LeadRealtimeBus />
      <WhatsAppRealtimeBus />
      <FloatingChatButton />
      <FloatingChat />

      <InstallPrompt />
      <WebPushPrompt />
    </div>
  );
}

export function AppLayout({ children, title, disableMainScroll = false, borderless = false }: AppLayoutProps) {
  const { organization, isSuperAdmin, impersonating } = useAuth();
  const allowRender = !!organization || isSuperAdmin || !!impersonating;

  if (!allowRender) {
    return (
      <div className="h-screen flex items-center justify-center bg-background">
        <VimobLoader size="lg" label="Carregando ambiente..." />
      </div>
    );
  }

  return (
    <FloatingChatProvider>
      <AppLayoutContent title={title} disableMainScroll={disableMainScroll} borderless={borderless}>
        {children}
      </AppLayoutContent>
    </FloatingChatProvider>
  );
}
