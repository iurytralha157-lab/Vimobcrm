import React, { useState } from 'react';
import Image from 'next/image';
import { Bell, Loader2, LogOut, ChevronDown, UserPlus, CheckSquare, FileText, DollarSign, Info, Settings, Shield, Building2, Check, Key } from 'lucide-react';
import { useOrganizationModules } from '@/hooks/use-organization-modules';
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

const notificationIcons: Record<string, typeof Bell> = {
  lead: UserPlus,
  task: CheckSquare,
  contract: FileText,
  commission: DollarSign,
  system: Bell,
  info: Info
};

interface AppHeaderProps {
  title?: string;
}

export const AppHeader = React.memo(function AppHeader({
  title
}: AppHeaderProps) {
  const {
    profile,
    signOut,
    isSuperAdmin,
    organization,
    switchOrganization,
    user,
    userOrganizations: rawUserOrganizations = [],
  } = useAuth();
  const [isSwitching, setIsSwitching] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const queryClient = useQueryClient();
  const { hasModule } = useOrganizationModules();
  const router = useRouter();
  const isMobile = useIsMobile();
  const {
    data: notifications = [],
    isLoading
  } = useNotifications();
  const {
    data: unreadCount = 0
  } = useUnreadNotificationsCount();
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

      // Navigate to dashboard to ensure we are on a clean state
      router.replace('/dashboard');
    } catch (error) {

      console.error('Error switching organization:', error);
      toast.error("Erro ao trocar de organização");
    } finally {
      setIsSwitching(false);
    }
  };

  const handleNotificationClick = (notification: AppNotification) => {
    markRead.mutate(notification.id);
    const route = getNotificationRoute(notification);
    if (route) router.push(route);
  };

  const handleSignOut = React.useCallback(async () => {
    if (isSigningOut) return;

    setIsSigningOut(true);
    try {
      await signOut();
    } catch (error) {
      console.error('Erro no logout:', error);
      toast.error('Erro ao sair. Redirecionando para o login...');
      window.location.replace('/login');
    }
  }, [isSigningOut, signOut]);

  const getInitials = (name: string) => {
    return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
  };

  const displayName = profile?.name?.trim() || 'Nome não informado';
  const displayEmail = profile?.email?.trim() || user?.email?.trim() || 'E-mail nao informado';

  return (
    <header className="sticky top-0 z-40 h-16 flex items-center px-4 md:px-6 bg-background/80 backdrop-blur-md border-b border-border/10">
      {/* Page title - aligned with content */}
      {title && <h1 className="ml-2 max-w-[140px] truncate text-base font-extralight text-foreground xs:max-w-[180px] sm:max-w-none sm:text-lg lg:ml-0">{title}</h1>}

      {/* Right side actions - Capsule style redesign */}
      <div className="flex items-center gap-3 ml-auto">

        {/* Org switcher - Only show if user has more than 1 organization */}
        {organization && hasMultipleOrgs && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                disabled={isSwitching}
                className="h-10 gap-2 px-3 rounded-full bg-[var(--app-surface-solid)] text-[var(--app-text-primary)] shadow-none transition-all duration-300 hover:bg-[var(--app-surface-hover)]"
              >
                {isSwitching ? (
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                ) : organization?.logo_url ? (
                  <div className="relative h-5 w-5 rounded-full overflow-hidden border border-border/20 flex items-center justify-center bg-white/5">
                    <Image
                      src={organization.logo_url}
                      alt=""
                      fill
                      sizes="20px"
                      className="object-contain p-0.5"
                      unoptimized
                    />
                  </div>
                ) : (
                  <Building2 className="h-4 w-4 text-primary" />
                )}
                {!isMobile && (
                  <span className="text-xs font-medium truncate max-w-[120px]">
                    {organization?.name || 'Organização'}
                  </span>
                )}
                <ChevronDown className="h-3 w-3 text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" sideOffset={12} className="w-64 bg-popover/95 backdrop-blur-md rounded-2xl p-1 border-border/50">
              <div className="px-3 py-2 border-b border-border/40">
                <p className="text-xs font-semibold text-muted-foreground">Trocar organização</p>
              </div>
              {userOrganizations.map((org) => (
                <DropdownMenuItem
                  key={org.organization_id}
                  onClick={() => handleSwitchOrg(org.organization_id)}
                  className="cursor-pointer rounded-xl m-1 px-3 py-2.5 gap-3"
                >
                  <Avatar className="h-8 w-8 rounded-lg border border-border/40">
                    {org.organization_logo ? (
                      <AvatarImage src={org.organization_logo} className="object-contain" />
                    ) : (
                      <AvatarImage src={undefined} />
                    )}
                    <AvatarFallback className="rounded-lg bg-primary/10 text-primary text-xs font-bold">
                      {org.organization_name?.charAt(0)?.toUpperCase() || 'O'}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{org.organization_name}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {org.member_role === 'admin' ? 'Administrador' : 'Usuário'}
                    </p>
                  </div>
                  {organization?.id === org.organization_id && (
                    <Check className="h-4 w-4 text-primary shrink-0" />
                  )}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {/* Notifications circle */}
        {user && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="relative h-10 w-10 rounded-full bg-[var(--app-surface-solid)] text-[var(--app-text-primary)] shadow-none transition-all duration-300 hover:bg-[var(--app-surface-hover)]"
              >
                <Bell className="h-5 w-5" />
                {unreadCount > 0 && (
                  <span className="absolute -top-1 -right-1 h-5 w-5 rounded-full bg-[#F97316] text-[10px] font-bold text-white flex items-center justify-center border-2 border-background">
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </span>
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" sideOffset={12} collisionPadding={16} className="w-[calc(100vw-2rem)] sm:w-80 max-w-[380px] bg-popover/95 backdrop-blur-md rounded-2xl p-1 border-border/50">
              <div className="px-4 py-3 border-b border-border/40">
                <p className="font-semibold text-sm">Notificações</p>
              </div>
              {isLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : notifications.length > 0 ? (
                <>
                  <div className="max-h-[70vh] overflow-y-auto scrollbar-thin">
                    {notifications.slice(0, 5).map(notification => {
                      const NotificationIcon = notificationIcons[notification.type] || Bell;
                      return (
                        <DropdownMenuItem key={notification.id} className="p-3 cursor-pointer rounded-xl m-1" onClick={() => handleNotificationClick(notification)}>
                          <div className={`flex items-start gap-3 w-full ${notification.is_read ? 'opacity-60' : ''}`}>
                            <div className={`h-9 w-9 rounded-full flex items-center justify-center shrink-0 ${notification.is_read ? 'bg-muted' : 'bg-primary/10'}`}>
                              <NotificationIcon className={`h-4 w-5 ${notification.is_read ? 'text-muted-foreground' : 'text-primary'}`} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <p className={`text-sm truncate ${!notification.is_read ? 'font-semibold' : ''}`}>
                                  {notification.title}
                                </p>
                                {!notification.is_read && <span className="h-2 w-2 rounded-full bg-primary shrink-0" />}
                              </div>
                              {notification.content && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{notification.content}</p>}
                              <p className="text-xs text-muted-foreground mt-1 tabular-nums">
                                {formatDistanceToNow(new Date(notification.created_at), { addSuffix: true, locale: ptBR })}
                              </p>
                            </div>
                          </div>
                        </DropdownMenuItem>
                      );
                    })}
                  </div>
                  <DropdownMenuSeparator className="my-1 border-border/40" />
                  <div className="p-2 flex gap-2">
                    {unreadCount > 0 && (
                      <Button variant="ghost" size="sm" className="flex-1 text-[11px] h-8 rounded-lg" onClick={() => markAllRead.mutate()}>
                        Marcar todas como lidas
                      </Button>
                    )}
                    <Button variant="ghost" size="sm" className="flex-1 text-[11px] h-8 rounded-lg" onClick={() => router.push('/notifications')}>
                      Ver todas
                    </Button>
                  </div>
                </>
              ) : (
                <div className="py-10 text-center text-sm text-muted-foreground">
                  Nenhuma notificação
                </div>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {/* User Capsule */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              className="h-12 gap-3 pl-1.5 pr-2 rounded-full bg-[var(--app-surface-solid)] text-[var(--app-text-primary)] shadow-none transition-all duration-300 group hover:bg-[var(--app-surface-hover)]"
            >
              <Avatar className="h-9 w-9 border border-[var(--app-border-strong)] ring-2 ring-primary/10 group-hover:ring-primary/20 transition-all">
                {profile?.avatar_url ? (
                  <AvatarImage src={profile.avatar_url} className="object-cover" />
                ) : organization?.logo_url ? (
                  <AvatarImage src={organization.logo_url} className="object-contain" />
                ) : (
                  <AvatarImage src={undefined} />
                )}
                <AvatarFallback className="bg-primary text-primary-foreground text-xs font-bold">
                  {getInitials(displayName)}
                </AvatarFallback>
              </Avatar>
              {!isMobile && (
                <div className="flex flex-col items-start gap-0.5 pr-1 text-left">
                  <span className="text-xs font-bold text-foreground tracking-tight leading-none truncate max-w-[130px]">
                    {displayName}
                  </span>
                  <span className="text-[10px] text-muted-foreground/80 leading-none truncate max-w-[130px]">
                    {displayEmail}
                  </span>
                </div>
              )}
              <div className="h-7 w-7 rounded-full bg-[var(--app-surface-soft)] flex items-center justify-center group-hover:bg-primary group-hover:text-primary-foreground transition-all duration-300 flex-shrink-0">
                <ChevronDown className="h-3 w-3" />
              </div>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" sideOffset={12} collisionPadding={16} className="w-56 bg-popover/95 backdrop-blur-md rounded-2xl p-1 border-border/50">
            <div className="px-3 py-3 border-b border-border/40">
              <p className="text-sm font-bold truncate">{displayName}</p>
              <p className="text-[10px] text-muted-foreground truncate">{displayEmail}</p>
            </div>
            <div className="mt-1">
              <DropdownMenuItem onClick={() => router.push('/settings')} className="cursor-pointer rounded-xl m-1 px-3 py-2 text-sm gap-2">
                <Settings className="h-4 w-4 text-muted-foreground" />
                Configurações
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => window.dispatchEvent(new Event('setup-guide:open'))} className="cursor-pointer rounded-xl m-1 px-3 py-2 text-sm gap-2">
                <CheckSquare className="h-4 w-4 text-muted-foreground" />
                Guia de configuração
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => router.push('/docs/api')} className="cursor-pointer rounded-xl m-1 px-3 py-2 text-sm gap-2">
                <FileText className="h-4 w-4 text-muted-foreground" />
                Documentação da API
              </DropdownMenuItem>
              {hasModule('api') && (
                  <DropdownMenuItem onClick={() => router.push('/settings?tab=api')} className="cursor-pointer rounded-xl m-1 px-3 py-2 text-sm gap-2">
                    <Key className="h-4 w-4 text-muted-foreground" />
                    Configuração da API
                  </DropdownMenuItem>
              )}
              {isSuperAdmin && (
                <DropdownMenuItem onClick={() => router.push('/admin')} className="cursor-pointer rounded-xl m-1 px-3 py-2 text-sm gap-2 border-t border-border/20 mt-1">
                  <Shield className="h-4 w-4 text-primary" />
                  Super Admin
                </DropdownMenuItem>
              )}

              <div className="px-4 py-2 mt-1 border-t border-border/20 flex items-center justify-between">
                <span className="text-[10px] text-muted-foreground/60">Versão</span>
                <span className="text-[10px] font-medium text-muted-foreground/80">v2.2.1</span>
              </div>
            </div>
            <DropdownMenuSeparator className="my-1 border-border/40" />
            <DropdownMenuItem
              disabled={isSigningOut}
              onClick={() => void handleSignOut()}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90 focus:bg-destructive/90 cursor-pointer rounded-xl m-1 px-3 py-2 text-sm gap-2 transition-colors"
            >
              {isSigningOut ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <LogOut className="h-4 w-4" />
              )}
              {isSigningOut ? 'Saindo...' : 'Sair'}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
});
