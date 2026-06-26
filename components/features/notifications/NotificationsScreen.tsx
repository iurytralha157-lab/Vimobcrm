'use client';

import { useState, useMemo } from 'react';
import { Bell, Check, CheckCheck, Loader2, UserPlus, CheckSquare, FileText, DollarSign, Info, MessageCircle, Settings, AlertTriangle, Zap, SlidersHorizontal } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useRouter } from 'next/navigation';
import { AppLayout } from '@/components/shared/layout/AppLayout';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { useNotifications, useMarkNotificationRead, useMarkAllNotificationsRead, Notification } from '@/hooks/use-notifications';
import { useAuth } from '@/contexts/AuthContext';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { useIsMobile } from '@/hooks/use-mobile';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Badge } from '@/components/ui/badge';
import { getNotificationRoute } from '@/lib/notification-routing';

const typeIcons: Record<string, typeof Bell> = {
  lead: UserPlus,
  new_lead: UserPlus,
  task: CheckSquare,
  contract: FileText,
  commission: DollarSign,
  system: Bell,
  info: Info,
  message: MessageCircle,
  whatsapp: MessageCircle,
  warning: AlertTriangle,
  automation: Zap,
};

const typeLabels: Record<string, string> = {
  lead: 'Novo Lead',
  new_lead: 'Novo Lead',
  task: 'Tarefa',
  contract: 'Contrato',
  commission: 'Comissão',
  system: 'Sistema',
  info: 'Informação',
  message: 'WhatsApp',
  whatsapp: 'WhatsApp',
  warning: 'Alerta',
  automation: 'Automação',
};

const notificationCategories = {
  all: { label: 'Todas', types: null as string[] | null, icon: Bell },
  leads: { label: 'Leads', types: ['lead', 'new_lead'], icon: UserPlus },
  whatsapp: { label: 'WhatsApp', types: ['message', 'whatsapp'], icon: MessageCircle },
  system: { label: 'Sistema', types: ['warning', 'automation', 'system', 'info'], icon: Settings },
  financial: { label: 'Financeiro', types: ['commission', 'contract'], icon: DollarSign },
  tasks: { label: 'Tarefas', types: ['task'], icon: CheckSquare },
};

type CategoryKey = keyof typeof notificationCategories;

export default function Notifications() {
  const { profile, loading: authLoading } = useAuth();
  const router = useRouter();
  const isMobile = useIsMobile();
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const [categoryFilter, setCategoryFilter] = useState<CategoryKey>('all');

  const { data: notifications = [], isLoading } = useNotifications();
  const markAsRead = useMarkNotificationRead();
  const markAllAsRead = useMarkAllNotificationsRead();

  // Count notifications per category (unread only)
  const categoryCounts = useMemo(() => {
    const counts: Record<CategoryKey, number> = {
      all: 0,
      leads: 0,
      whatsapp: 0,
      system: 0,
      financial: 0,
      tasks: 0,
    };

    notifications.forEach(n => {
      if (!n.is_read) {
        counts.all++;
        (Object.keys(notificationCategories) as CategoryKey[]).forEach(key => {
          if (key !== 'all') {
            const category = notificationCategories[key];
            if (category.types?.includes(n.type)) {
              counts[key]++;
            }
          }
        });
      }
    });

    return counts;
  }, [notifications]);

  // Combined filtering: status + category
  const filteredNotifications = useMemo(() => {
    return notifications.filter(n => {
      // Status filter
      if (filter === 'unread' && n.is_read) return false;

      // Category filter
      const category = notificationCategories[categoryFilter];
      if (category.types && !category.types.includes(n.type)) return false;

      return true;
    });
  }, [notifications, filter, categoryFilter]);

  const unreadCount = notifications.filter(n => !n.is_read).length;

  if (authLoading) return null;
  if (!profile) return null;

  const handleNotificationClick = async (notification: Notification) => {
    if (!notification.is_read) {
      await markAsRead.mutateAsync(notification.id);
    }

    const route = getNotificationRoute(notification);
    if (route) router.push(route);
  };

  const handleMarkAllAsRead = async () => {
    await markAllAsRead.mutateAsync();
  };

  return (
    <AppLayout title={isMobile ? 'Notificações' : undefined}>
      <div className="space-y-6">
        {/* Desktop: título inline como antes */}
        {!isMobile && (
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold flex items-center gap-2">
                <Bell className="h-8 w-8" />
                Notificações
              </h1>
              <p className="text-muted-foreground mt-1">
                {unreadCount > 0
                  ? `Você tem ${unreadCount} notificação${unreadCount > 1 ? 'ões' : ''} não lida${unreadCount > 1 ? 's' : ''}`
                  : 'Todas as notificações lidas'}
              </p>
            </div>
            {unreadCount > 0 && (
              <Button
                variant="outline"
                onClick={handleMarkAllAsRead}
                disabled={markAllAsRead.isPending}
              >
                {markAllAsRead.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <CheckCheck className="h-4 w-4 mr-2" />
                )}
                Marcar todas como lidas
              </Button>
            )}
          </div>
        )}

        {/* Mobile: actions row with filter popover + mark all */}
        {isMobile && (
          <div className="flex items-center justify-between gap-2">
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1.5">
                  <SlidersHorizontal className="h-3.5 w-3.5" />
                  Filtros
                  {categoryFilter !== 'all' && (
                    <Badge variant="default" className="h-4 w-4 p-0 flex items-center justify-center text-[10px] rounded-full">
                      •
                    </Badge>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-56 p-2">
                <div className="space-y-1">
                  {(Object.keys(notificationCategories) as CategoryKey[]).map((key) => {
                    const category = notificationCategories[key];
                    const CategoryIcon = category.icon;
                    const count = categoryCounts[key];
                    const isActive = categoryFilter === key;
                    return (
                      <button
                        key={key}
                        onClick={() => setCategoryFilter(key)}
                        className={cn(
                          "flex items-center gap-2 w-full px-3 py-2 rounded-md text-sm transition-colors",
                          isActive
                            ? "bg-primary text-primary-foreground"
                            : "hover:bg-white/[0.055]"
                        )}
                      >
                        <CategoryIcon className="h-4 w-4" />
                        <span className="flex-1 text-left">{category.label}</span>
                        {count > 0 && (
                          <span className={cn(
                            "text-xs rounded-full px-1.5 min-w-[20px] text-center",
                            isActive
                              ? "bg-primary-foreground/20 text-primary-foreground"
                              : "bg-primary/10 text-primary"
                          )}>
                            {count}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </PopoverContent>
            </Popover>

            {unreadCount > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleMarkAllAsRead}
                disabled={markAllAsRead.isPending}
              >
                {markAllAsRead.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                ) : (
                  <CheckCheck className="h-3.5 w-3.5 mr-1.5" />
                )}
                Marcar lidas
              </Button>
            )}
          </div>
        )}

        {/* Desktop: Category Filter inline */}
        {!isMobile && (
          <ScrollArea className="w-full whitespace-nowrap pb-2">
            <div className="flex gap-2">
              {(Object.keys(notificationCategories) as CategoryKey[]).map((key) => {
                const category = notificationCategories[key];
                const CategoryIcon = category.icon;
                const count = categoryCounts[key];
                const isActive = categoryFilter === key;

                return (
                  <button
                    key={key}
                    onClick={() => setCategoryFilter(key)}
                    className={cn(
                      "flex items-center gap-2 px-4 py-2 rounded-lg transition-all shrink-0",
                      isActive
                        ? "bg-primary text-primary-foreground"
                        : "bg-white/[0.045] hover:bg-white/[0.07]"
                    )}
                  >
                    <CategoryIcon className="h-4 w-4" />
                    <span className="text-sm font-medium">{category.label}</span>
                    {count > 0 && (
                      <span className={cn(
                        "text-xs rounded-full px-1.5 min-w-[20px] text-center",
                        isActive
                          ? "bg-primary-foreground/20 text-primary-foreground"
                          : "bg-primary/10 text-primary"
                      )}>
                        {count}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            <ScrollBar orientation="horizontal" />
          </ScrollArea>
        )}

        <Card className="app-card">
          <CardHeader className={cn(isMobile && "px-3 py-3")}>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className={cn(isMobile && "text-base")}>{isMobile ? 'Notificações' : 'Suas Notificações'}</CardTitle>
                {!isMobile && (
                  <CardDescription>
                    {filteredNotifications.length} notificações
                  </CardDescription>
                )}
              </div>
              <Tabs value={filter} onValueChange={(v) => setFilter(v as 'all' | 'unread')}>
                <TabsList>
                  <TabsTrigger value="all">Todas</TabsTrigger>
                  <TabsTrigger value="unread" className="gap-1">
                    Não lidas
                    {unreadCount > 0 && (
                      <span className="ml-1 bg-primary text-primary-foreground text-xs rounded-full px-1.5">
                        {unreadCount}
                      </span>
                    )}
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
          </CardHeader>
          <CardContent className={cn("px-4 md:px-6 pb-4", isMobile && "px-3")}>
            {isLoading ? (
              <div className="space-y-3">
                {[...Array(5)].map((_, i) => (
                  <Skeleton key={i} className="h-20 w-full" />
                ))}
              </div>
            ) : filteredNotifications.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Bell className="h-12 w-12 text-muted-foreground mb-4" />
                <h3 className="text-lg font-semibold">Nenhuma notificação</h3>
                <p className="text-muted-foreground">
                  {filter === 'unread'
                    ? 'Você leu todas as notificações'
                    : 'Você ainda não recebeu notificações'}
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {filteredNotifications.map((notification) => {
                  const NotificationIcon = typeIcons[notification.type] || Bell;
                  return (
                    <div
                      key={notification.id}
                      onClick={() => handleNotificationClick(notification)}
                      className={cn(
                        "flex items-start rounded-lg cursor-pointer transition-colors",
                        isMobile ? "gap-3 p-3" : "gap-4 p-4",
                        notification.is_read
                          ? "bg-white/[0.04] hover:bg-white/[0.06]"
                          : "bg-primary/[0.08] hover:bg-primary/[0.12] border-l-2 border-primary"
                      )}
                    >
                      <div className={cn(
                        "rounded-full flex items-center justify-center shrink-0",
                        isMobile ? "h-8 w-8" : "h-10 w-10",
                        notification.is_read ? "bg-white/[0.06]" : "bg-primary/10"
                      )}>
                        <NotificationIcon className={cn(
                          isMobile ? "h-4 w-4" : "h-5 w-5",
                          notification.is_read ? "text-muted-foreground" : "text-primary"
                        )} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <h4 className={cn(
                            "text-sm",
                            !notification.is_read && "font-semibold"
                          )}>
                            {notification.title}
                          </h4>
                          {!notification.is_read && (
                            <Badge variant="default" className="text-[10px] px-1.5 py-0 h-4">
                              NEW
                            </Badge>
                          )}
                        </div>
                        {notification.content && (
                          <p className="text-sm text-muted-foreground line-clamp-2">
                            {notification.content}
                          </p>
                        )}
                        <div className="flex items-center gap-2 mt-1.5">
                          <span className="text-xs text-muted-foreground">
                            {formatDistanceToNow(new Date(notification.created_at), {
                              addSuffix: true,
                              locale: ptBR,
                            })}
                          </span>
                          <span className="text-xs px-2 py-0.5 rounded-full bg-white/[0.06]">
                            {typeLabels[notification.type] || notification.type}
                          </span>
                        </div>
                      </div>
                      {!isMobile && !notification.is_read && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="shrink-0"
                          onClick={(e) => {
                            e.stopPropagation();
                            markAsRead.mutate(notification.id);
                          }}
                        >
                          <Check className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
