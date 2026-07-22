'use client';

import { useState, useMemo } from 'react';
import { Bell, Check, CheckCheck, Loader2, UserPlus, CheckSquare, Info, MessageCircle, Settings, AlertTriangle, Zap } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useRouter } from 'next/navigation';
import { AppLayout } from '@/components/shared/layout/AppLayout';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { useNotifications, useMarkNotificationRead, useMarkAllNotificationsRead, Notification } from '@/hooks/use-notifications';
import { useAuth } from '@/contexts/AuthContext';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { useIsMobile } from '@/hooks/use-mobile';
import { Badge } from '@/components/ui/badge';
import { getNotificationRoute } from '@/lib/notification-routing';

const typeIcons: Record<string, typeof Bell> = {
  lead: UserPlus,
  new_lead: UserPlus,
  task: CheckSquare,
  schedule: CheckSquare,
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
  schedule: 'Agenda',
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
  tasks: { label: 'Tarefas', types: ['task', 'schedule'], icon: CheckSquare },
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
    <AppLayout title="Notificações">
      <div className="space-y-6">
        <ScrollArea className="w-full whitespace-nowrap">
          <div className="flex w-max min-w-full items-center gap-2 pb-2">
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
                      "flex h-8 shrink-0 items-center gap-1.5 rounded-[6px] border-0 px-3 text-[11px] font-medium shadow-none transition-colors",
                      isActive
                        ? "bg-primary text-primary-foreground"
                        : "bg-[var(--app-surface)] text-[var(--app-text-secondary)] hover:bg-[var(--app-surface-hover)] hover:text-[var(--app-text-primary)]"
                    )}
                  >
                    <CategoryIcon className="h-3.5 w-3.5" />
                    <span>{category.label}</span>
                    {count > 0 && (
                      <span className={cn(
                        "min-w-[18px] rounded-[4px] px-1 text-center text-[10px]",
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
            <div className="mx-0.5 h-5 w-px shrink-0 bg-[var(--app-border)]" />
            <Tabs value={filter} onValueChange={(value) => setFilter(value as 'all' | 'unread')}>
              <TabsList className="h-8 shrink-0 rounded-[6px] border-0 bg-[var(--app-surface)] p-0.5 shadow-none">
                <TabsTrigger value="all" className="h-7 rounded-[5px] px-2.5 text-[11px] font-medium shadow-none data-[state=active]:bg-[var(--app-surface-hover)] data-[state=active]:shadow-none">Todas</TabsTrigger>
                <TabsTrigger value="unread" className="h-7 gap-1 rounded-[5px] px-2.5 text-[11px] font-medium shadow-none data-[state=active]:bg-[var(--app-surface-hover)] data-[state=active]:shadow-none">
                  Não lidas
                  {unreadCount > 0 && <span className="rounded-[4px] bg-primary px-1 text-[10px] text-primary-foreground">{unreadCount}</span>}
                </TabsTrigger>
              </TabsList>
            </Tabs>
            {unreadCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 shrink-0 gap-1.5 rounded-[6px] border-0 bg-[var(--app-surface)] px-3 text-[11px] font-medium shadow-none hover:bg-[var(--app-surface-hover)]"
                onClick={handleMarkAllAsRead}
                disabled={markAllAsRead.isPending}
              >
                {markAllAsRead.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCheck className="h-3.5 w-3.5" />}
                Marcar lidas
              </Button>
            )}
          </div>
          <ScrollBar orientation="horizontal" />
        </ScrollArea>

        <Card className="app-card">
          <CardContent className={cn("px-4 pb-4 pt-4 md:px-6", isMobile && "px-3 pt-3")}>
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
