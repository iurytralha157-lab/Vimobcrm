import React, { useState } from 'react';
import { Bell, Loader2, LogOut, ChevronDown, UserPlus, CheckSquare, FileText, DollarSign, Info, Settings, Check, AlertTriangle, Sparkles, LifeBuoy, CalendarDays, MessageCircle, Zap, ReceiptText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { useNotifications, useUnreadNotificationsCount, useMarkNotificationRead, useMarkAllNotificationsRead } from '@/hooks/use-notifications';
import type { Notification as AppNotification } from '@/hooks/use-notifications';
// removed useUserOrganizations import
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useRouter } from 'next/navigation';
import { useIsMobile } from '@/hooks/use-mobile';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { getNotificationRoute } from '@/lib/notification-routing';
import { ProductUpdatesDialog } from '@/components/features/news';
import { DEFAULT_AUTHENTICATED_ROUTE } from '@/config/constants';

const notificationIcons: Record<string, typeof Bell> = {
  lead: UserPlus,
  new_lead: UserPlus,
  task: CheckSquare,
  schedule: CalendarDays,
  contract: FileText,
  commission: DollarSign,
  message: MessageCircle,
  whatsapp: MessageCircle,
  automation: Zap,
  billing: ReceiptText,
  system: Bell,
  info: Info,
  warning: AlertTriangle
};

function formatNotificationDistance(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Data não informada';

  return formatDistanceToNow(date, { addSuffix: true, locale: ptBR });
}

interface AppHeaderProps {
  title?: string;
}

export const AppHeader = React.memo(function AppHeader({
  title
}: AppHeaderProps) {
  const {
    profile,
    signOut,
    organization,
    tenantContext,
    switchOrganization,
    user,
    userOrganizations: rawUserOrganizations = [],
  } = useAuth();
  const [isSwitching, setIsSwitching] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [updatesOpen, setUpdatesOpen] = useState(false);
  const queryClient = useQueryClient();
  const router = useRouter();
  const isMobile = useIsMobile();
  const {
    data: notifications = [],
    isFetched: notificationsFetched,
    isError: notificationsError,
    isFetching: notificationsFetching,
    refetch: refetchNotifications,
  } = useNotifications();
  const {
    data: unreadCountFromAPI,
    isError: unreadCountError,
  } = useUnreadNotificationsCount();
  const loadedUnreadCount = notifications.filter((notification) => !notification.is_read).length;
  const unreadCount = unreadCountError ? loadedUnreadCount : unreadCountFromAPI ?? 0;
  const canViewWhatsApp = Boolean(
    tenantContext?.enabledModules.includes('whatsapp') &&
    tenantContext.permissions.includes('whatsapp_view'),
  );
  const markRead = useMarkNotificationRead();
  const markAllRead = useMarkAllNotificationsRead();
  // removed duplicate useUserOrganizations fetch
  
  const userOrganizations = React.useMemo(() => {
    const map = new Map();
    rawUserOrganizations.forEach(org => {
      if (!map.has(org.organization_id)) {
        map.set(org.organization_id, org);
      }
    });
    return Array.from(map.values());
  }, [rawUserOrganizations]);

  const hasMultipleOrgs = userOrganizations.length > 1;

  const handleSwitchOrg = async (orgId: string) => {
    if (orgId === organization?.id) return;
    
    setIsSwitching(true);
    try {
      // Iniciar a troca de organização

      
      await switchOrganization(orgId);
      
      // Invalidate all queries to refresh data for the new organization
      await queryClient.invalidateQueries();
      
      toast.success("Organização alterada com sucesso");
      
      // Navigate to the authenticated landing page to ensure a clean organization state.
      router.replace(DEFAULT_AUTHENTICATED_ROUTE);
    } catch (error) {

      console.error('Error switching organization:', error);
      toast.error("Erro ao trocar de organização");
    } finally {
      setIsSwitching(false);
    }
  };

  const handleNotificationClick = (notification: AppNotification) => {
    if (!notification.is_read) {
      markRead.mutate(notification.id, {
        onError: () => toast.error('Não foi possível marcar a notificação como lida.'),
      });
    }

    const route = getNotificationRoute(notification, { canViewWhatsApp });
    if (route) router.push(route);
  };

  const handleMarkAllNotificationsRead = () => {
    markAllRead.mutate(undefined, {
      onError: () => toast.error('Não foi possível marcar todas as notificações como lidas.'),
    });
  };

  const handleOpenAllNotifications = () => {
    setNotificationsOpen(false);
    router.push('/notifications');
  };

  const getInitials = (name: string) => {
    return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
  };

  return (
    <header className="sticky top-0 z-40 flex h-16 items-center border-0 bg-transparent px-5 shadow-none md:px-8">
      {/* Page title - aligned with content */}
      {title && <h1 className="app-page-title ml-2 max-w-[140px] truncate xs:max-w-[180px] sm:max-w-none lg:ml-0">{title}</h1>}

      {/* Right side actions */}
      <div className="flex items-center gap-3 ml-auto">

        {/* Org switcher - Only show if user has more than 1 organization */}
        {organization && hasMultipleOrgs && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                disabled={isSwitching}
                className="h-10 gap-2 rounded-[6px] border-0 bg-card pl-1.5 pr-2 shadow-none transition-colors hover:bg-[var(--app-surface-hover)]"
              >
                {isSwitching ? (
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                ) : (
                  <Avatar className="h-6 w-6 rounded-[4px] border-0 bg-transparent">
                    <AvatarImage
                      src={organization.logo_url || undefined}
                      alt=""
                      className="object-contain p-0.5"
                    />
                    <AvatarFallback className="grid place-items-center rounded-[4px] bg-primary text-center text-[10px] font-light leading-none text-primary-foreground">
                      {organization?.name?.charAt(0)?.toUpperCase() || 'O'}
                    </AvatarFallback>
                  </Avatar>
                )}
                {!isMobile && (
                  <span className="max-w-[120px] truncate text-[12px] font-light">
                    {organization?.name || 'Organização'}
                  </span>
                )}
                <ChevronDown className="h-3 w-3 text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" sideOffset={12} className="app-header-popover w-64 p-1">
              <div className="px-3 py-2 border-b border-border/40">
                <p className="text-[12px] font-light text-muted-foreground">Trocar organização</p>
              </div>
              {userOrganizations.map((org) => (
                <DropdownMenuItem
                  key={org.organization_id}
                  onClick={() => handleSwitchOrg(org.organization_id)}
                  className="m-1 cursor-pointer gap-3 rounded-[6px] px-3 py-2.5"
                >
                  <Avatar className="h-8 w-8 rounded-[6px] border-0">
                    {org.organization_logo ? (
                      <AvatarImage src={org.organization_logo} className="object-contain" />
                    ) : (
                      <AvatarImage src={undefined} />
                    )}
                    <AvatarFallback
                      className={`grid place-items-center rounded-[6px] bg-primary/50 text-center text-[12px] font-light leading-none text-primary-foreground transition-opacity ${
                        organization?.id === org.organization_id ? 'opacity-100' : 'opacity-50'
                      }`}
                    >
                      {org.organization_name?.charAt(0)?.toUpperCase() || 'O'}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <p className="truncate text-[14px] font-light">{org.organization_name}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {org.member_role === 'admin' ? 'Administrador' : 'Usuário'}
                    </p>
                  </div>
                  {organization?.id === org.organization_id && (
                    <span
                      aria-hidden="true"
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] bg-primary text-primary-foreground"
                    >
                      <Check className="h-3.5 w-3.5" />
                    </span>
                  )}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {/* Notifications circle */}
        {user && (
          <DropdownMenu open={notificationsOpen} onOpenChange={setNotificationsOpen}>
            <DropdownMenuTrigger asChild>
              <Button 
                type="button"
                variant="ghost" 
                size="icon" 
                aria-label={`Notificações${unreadCount > 0 ? `, ${unreadCount} não lidas` : ''}`}
                className="relative h-10 w-10 rounded-[6px] border-0 bg-card shadow-none transition-colors hover:bg-[var(--app-surface-hover)]"
              >
                <Bell className="h-5 w-5" aria-hidden="true" />
                {unreadCount > 0 && (
                  <span aria-hidden="true" className="absolute -right-1.5 -top-1.5 flex h-[22px] w-[22px] items-center justify-center rounded-full border-0 bg-primary text-[10px] font-normal leading-none text-primary-foreground">
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </span>
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" sideOffset={12} collisionPadding={12} className="app-header-popover notification-popover flex max-h-[min(520px,calc(100dvh-8rem))] w-[min(340px,calc(100vw-1.25rem))] flex-col overflow-hidden p-1 sm:max-h-[min(580px,calc(100dvh-5rem))] sm:w-[340px]">
              <div className="shrink-0 border-b border-border/30 px-3 py-2.5">
                <p className="notification-title">Notificações</p>
              </div>
              {!notificationsFetched && notifications.length === 0 ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-primary" aria-label="Carregando notificações" />
                </div>
              ) : notificationsError && notifications.length === 0 ? (
                <div className="flex flex-col items-center px-4 py-8 text-center">
                  <span className="flex h-9 w-9 items-center justify-center rounded-[6px] bg-[var(--app-surface-soft)] text-primary">
                    <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <p className="notification-title mt-3 text-[var(--app-text-primary)]">
                    Não foi possível carregar
                  </p>
                  <p className="mt-1 text-[12px] font-light text-muted-foreground">
                    Tente novamente em instantes.
                  </p>
                  <DropdownMenuItem
                    onSelect={(event) => {
                      event.preventDefault();
                      void refetchNotifications();
                    }}
                    disabled={notificationsFetching}
                    className="mt-3 h-8 cursor-pointer justify-center rounded-[6px] bg-[var(--app-surface-soft)] px-3 text-[12px] font-light shadow-none hover:bg-[var(--app-surface-hover)] focus:bg-[var(--app-surface-hover)]"
                  >
                    {notificationsFetching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                    Tentar novamente
                  </DropdownMenuItem>
                </div>
              ) : notifications.length > 0 ? (
                <>
                  <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
                    {notifications.slice(0, 5).map(notification => {
                      const NotificationIcon = notificationIcons[notification.type.toLowerCase()] || Bell;
                      const notificationRoute = getNotificationRoute(notification, { canViewWhatsApp });
                      const isActionable = Boolean(notificationRoute) || !notification.is_read;
                      const content = (
                          <div className="flex w-full items-start gap-2.5">
                            <div
                              aria-hidden="true"
                              className={isActionable
                                ? "flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] bg-primary/50 text-primary-foreground transition-colors group-hover:bg-primary group-focus:bg-primary group-data-[highlighted]:bg-primary sm:h-9 sm:w-9"
                                : "flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] bg-[var(--app-surface-soft)] text-[var(--app-text-secondary)] sm:h-9 sm:w-9"}
                            >
                              <NotificationIcon className="h-4 w-4" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <p className="notification-title truncate">
                                  {notification.title}
                                </p>
                                {!notification.is_read && <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />}
                              </div>
                              {notification.content && <p className="mt-0.5 line-clamp-2 text-[12px] font-light leading-[15px] text-muted-foreground">{notification.content}</p>}
                              <p className="mt-1 text-[11px] font-light tabular-nums text-muted-foreground">
                                {formatNotificationDistance(notification.created_at)}
                              </p>
                            </div>
                          </div>
                      );

                      if (!isActionable) {
                        return (
                          <div key={notification.id} className="m-1 rounded-[6px] px-2.5 py-2.5 sm:px-3">
                            {content}
                          </div>
                        );
                      }

                      return (
                        <DropdownMenuItem
                          key={notification.id}
                          aria-label={notificationRoute
                            ? `Abrir ${notification.title}`
                            : `Marcar ${notification.title} como lida`}
                          className="group m-1 cursor-pointer rounded-[6px] px-2.5 py-2.5 sm:px-3"
                          onSelect={() => handleNotificationClick(notification)}
                        >
                          {content}
                        </DropdownMenuItem>
                      );
                    })}
                  </div>
                  {notificationsError ? (
                    <div className="mx-2 mt-1 flex items-center justify-between gap-2 rounded-[6px] bg-[var(--app-surface-soft)] px-2.5 py-2 text-[12px] font-light text-[var(--app-text-secondary)]">
                      <span className="truncate">Não foi possível atualizar.</span>
                      <DropdownMenuItem
                        onSelect={(event) => {
                          event.preventDefault();
                          void refetchNotifications();
                        }}
                        disabled={notificationsFetching}
                        className="shrink-0 cursor-pointer rounded-[6px] px-1.5 py-1 text-primary transition-colors hover:bg-[var(--app-surface-hover)] focus:bg-[var(--app-surface-hover)] data-[disabled]:opacity-50"
                      >
                        Tentar novamente
                      </DropdownMenuItem>
                    </div>
                  ) : null}
                  <DropdownMenuSeparator className="mx-2 my-1 bg-border/30" />
                  <div className="flex shrink-0 flex-col gap-2 p-2 min-[360px]:flex-row">
                    {unreadCount > 0 && (
                      <DropdownMenuItem
                        className="h-9 flex-1 cursor-pointer justify-center rounded-[6px] bg-[var(--app-surface-soft)] px-2 text-center text-[12px] font-light hover:bg-[var(--app-surface-hover)] focus:bg-[var(--app-surface-hover)]"
                        onSelect={handleMarkAllNotificationsRead}
                        disabled={markAllRead.isPending}
                      >
                        {markAllRead.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                        Marcar todas como lidas
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem
                      className="h-9 flex-1 cursor-pointer justify-center rounded-[6px] bg-primary px-2 text-center text-[12px] font-light text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground focus:bg-primary/90 focus:text-primary-foreground data-[highlighted]:bg-primary/90 data-[highlighted]:text-primary-foreground"
                      onSelect={handleOpenAllNotifications}
                    >
                      Ver todas
                    </DropdownMenuItem>
                  </div>
                </>
              ) : (
                <div className="flex flex-col items-center px-4 py-9 text-center">
                  <span className="flex h-9 w-9 items-center justify-center rounded-[6px] bg-primary/50 text-primary-foreground">
                    <Bell className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <p className="mt-3 text-[12px] font-light text-muted-foreground">
                    Nenhuma notificação
                  </p>
                </div>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {/* User Capsule */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button 
              type="button"
              variant="ghost" 
              aria-label="Abrir menu do usuário"
              className="group h-10 gap-3 rounded-[6px] border-0 bg-card pl-1.5 pr-2 shadow-none transition-colors hover:bg-[var(--app-surface-hover)]"
            >
              <Avatar className="h-8 w-8 border-0">
                {profile?.avatar_url ? (
                  <AvatarImage src={profile.avatar_url} alt="" className="object-cover" />
                ) : organization?.logo_url ? (
                  <AvatarImage src={organization.logo_url} alt="" className="object-contain" />
                ) : (
                  <AvatarImage src={undefined} />
                )}
                <AvatarFallback className="bg-primary text-[12px] font-light text-primary-foreground">
                  {profile?.name ? getInitials(profile.name) : organization?.name ? getInitials(organization.name) : 'U'}
                </AvatarFallback>
              </Avatar>
              {!isMobile && (
                <div className="flex flex-col items-start gap-0.5 pr-1 text-left">
                  <span className="max-w-[130px] truncate text-[12px] font-normal leading-none text-foreground">
                    {profile?.name || 'Usuário'}
                  </span>
                  <span className="text-[10px] text-muted-foreground/80 leading-none truncate max-w-[130px]">
                    {profile?.email || 'email@exemplo.com'}
                  </span>
                </div>
              )}
              <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-[4px] bg-primary text-primary-foreground transition-colors group-hover:bg-primary/90">
                <ChevronDown className="h-3 w-3" aria-hidden="true" />
              </div>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" sideOffset={12} collisionPadding={16} className="app-header-popover w-56 p-2">
            <div className="border-b border-border/30 px-2.5 pb-2 pt-1.5">
              <p className="truncate text-[14px] font-normal">{profile?.name}</p>
              <p className="text-[10px] text-muted-foreground truncate">{profile?.email}</p>
            </div>
            <div className="mt-1 space-y-0.5">
              <DropdownMenuItem onClick={() => router.push('/settings')} className="cursor-pointer gap-2 rounded-[4px] px-2.5 py-2 text-[14px] font-light transition-colors hover:bg-[var(--app-surface-hover)] focus:bg-[var(--app-surface-hover)]">
                <Settings className="h-3.5 w-3.5 text-muted-foreground" />
                Configurações
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => window.dispatchEvent(new Event('setup-guide:open'))} className="cursor-pointer gap-2 rounded-[4px] px-2.5 py-2 text-[14px] font-light transition-colors hover:bg-[var(--app-surface-hover)] focus:bg-[var(--app-surface-hover)]">
                <CheckSquare className="h-3.5 w-3.5 text-muted-foreground" />
                Guia de configuração
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => router.push('/suporte')} className="cursor-pointer gap-2 rounded-[4px] px-2.5 py-2 text-[14px] font-light transition-colors hover:bg-[var(--app-surface-hover)] focus:bg-[var(--app-surface-hover)]">
                <LifeBuoy className="h-3.5 w-3.5 text-muted-foreground" />
                Central de ajuda
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setUpdatesOpen(true)} className="cursor-pointer gap-2 rounded-[4px] px-2.5 py-2 text-[14px] font-light transition-colors hover:bg-[var(--app-surface-hover)] focus:bg-[var(--app-surface-hover)]">
                <Sparkles className="h-3.5 w-3.5 text-muted-foreground" />
                Novidades
              </DropdownMenuItem>
              <div className="flex items-center justify-between px-2.5 pb-0.5 pt-1">
                <span className="text-[10px] text-muted-foreground/60">Versão</span>
                <span className="text-[10px] font-medium text-muted-foreground/80">v2.2.1</span>
              </div>
            </div>
            <DropdownMenuItem
              onClick={async () => {
                try {
                  await signOut();
                } catch (error) {
                  console.error('Erro no logout:', error);
                }
                window.location.href = '/login';
              }}
              className="app-header-logout mt-1 cursor-pointer gap-2 rounded-[4px] bg-primary px-2.5 py-2 text-[14px] font-light text-primary-foreground transition-colors hover:bg-primary/90 hover:text-primary-foreground focus:bg-primary/90 focus:text-primary-foreground data-[highlighted]:bg-primary/90 data-[highlighted]:text-primary-foreground"
            >
              <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
              Sair
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <ProductUpdatesDialog open={updatesOpen} onOpenChange={setUpdatesOpen} />
    </header>
  );
});
