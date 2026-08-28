'use client';

import { useState, useMemo } from 'react';
import { Bell, Check, CheckCheck, Loader2, UserPlus, CheckSquare, CalendarDays, Info, MessageCircle, Settings, AlertTriangle, Zap, SlidersHorizontal, ArrowRight, ReceiptText } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { AppLayout } from '@/components/shared/layout/AppLayout';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import {
  useNotifications,
  useUnreadNotificationsCount,
  useMarkNotificationRead,
  useMarkAllNotificationsRead,
  Notification,
} from '@/hooks/use-notifications';
import { useAuth } from '@/contexts/AuthContext';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { getNotificationRoute } from '@/lib/notification-routing';
import { toast } from 'sonner';

const typeIcons: Record<string, typeof Bell> = {
  lead: UserPlus,
  new_lead: UserPlus,
  task: CheckSquare,
  schedule: CalendarDays,
  system: Bell,
  info: Info,
  message: MessageCircle,
  whatsapp: MessageCircle,
  warning: AlertTriangle,
  automation: Zap,
  billing: ReceiptText,
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
  billing: 'Cobrança',
};

const notificationCategories = {
  leads: { label: 'Leads', icon: UserPlus },
  whatsapp: { label: 'WhatsApp', icon: MessageCircle },
  system: { label: 'Sistema', icon: Settings },
  tasks: { label: 'Tarefas', icon: CheckSquare },
};

type CategoryKey = keyof typeof notificationCategories;

function getNotificationCategory(type: string): CategoryKey {
  const normalizedType = type.toLowerCase();

  if (normalizedType === 'message' || normalizedType.includes('whatsapp')) {
    return 'whatsapp';
  }

  if (
    normalizedType === 'task' ||
    normalizedType === 'schedule' ||
    normalizedType === 'reminder' ||
    normalizedType === 'lead_attention' ||
    normalizedType.includes('task') ||
    normalizedType.includes('schedule') ||
    normalizedType.includes('reminder') ||
    normalizedType.includes('cadence') ||
    normalizedType.includes('cadencia') ||
    normalizedType.includes('agenda')
  ) {
    return 'tasks';
  }

  if (normalizedType.includes('lead') || normalizedType.includes('deal')) {
    return 'leads';
  }

  return 'system';
}

function formatNotificationDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Data não informada';

  const now = new Date();
  const time = date.toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  });

  if (date.toDateString() === now.toDateString()) {
    return `Hoje, ${time}`;
  }

  return date.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function NotificationRow({
  notification,
  route,
  onActivate,
}: {
  notification: Notification;
  route: string | null;
  onActivate: () => void;
}) {
  const notificationCategory = getNotificationCategory(notification.type);
  const normalizedType = notification.type.toLowerCase();
  const NotificationIcon = typeIcons[normalizedType] || notificationCategories[notificationCategory].icon;
  const notificationLabel = typeLabels[normalizedType] || notificationCategories[notificationCategory].label;
  const notificationDate = formatNotificationDate(notification.created_at);
  const isActionable = Boolean(route) || !notification.is_read;
  const ActionIcon = route ? ArrowRight : Check;

  const content = (
    <>
      <span
        aria-hidden="true"
        className={cn(
          "flex h-9 w-9 items-center justify-center rounded-[6px] transition-colors sm:h-10 sm:w-10",
          isActionable
            ? "bg-primary/50 text-primary-foreground group-hover:bg-primary group-active:bg-primary group-focus-visible:bg-primary"
            : "bg-[var(--app-surface-soft)] text-[var(--app-text-secondary)]",
        )}
      >
        <NotificationIcon className="h-4 w-4" />
      </span>

      <span className="min-w-0">
        <span className="flex items-center gap-1.5 text-[10px] font-light text-[var(--app-text-tertiary)]">
          {notification.is_read ? 'Notificação' : 'Nova notificação'}
          {!notification.is_read && (
            <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden="true" />
          )}
        </span>
        <span className="notification-title mt-0.5 block break-words text-[var(--app-text-primary)]">
          {notification.title}
        </span>
        {notification.content && (
          <span className="mt-0.5 line-clamp-2 break-words text-[12px] font-light leading-5 text-[var(--app-text-tertiary)] sm:mt-1">
            {notification.content}
          </span>
        )}
        <span className="mt-1 flex flex-wrap items-center gap-1.5 sm:hidden">
          <span className="inline-flex h-5 items-center rounded-[4px] bg-[var(--app-surface-soft)] px-1.5 text-[9px] font-light text-[var(--app-text-secondary)]">
            {notificationLabel}
          </span>
          <time
            dateTime={notification.created_at}
            className="text-[11px] font-light text-[var(--app-text-secondary)]"
          >
            {notificationDate}
          </time>
        </span>
      </span>

      <span className="flex items-center gap-3 pl-0.5 sm:pl-3">
        <span className="hidden h-6 items-center rounded-[4px] bg-[var(--app-surface-soft)] px-2 text-[10px] font-light text-[var(--app-text-secondary)] sm:inline-flex">
          {notificationLabel}
        </span>
        <time
          dateTime={notification.created_at}
          className="hidden whitespace-nowrap text-xs font-light text-[var(--app-text-secondary)] sm:block"
        >
          {notificationDate}
        </time>
        <span
          aria-hidden="true"
          className={cn(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] transition-colors",
            isActionable
              ? "bg-primary/50 text-primary-foreground group-hover:bg-primary group-active:bg-primary group-focus-visible:bg-primary"
              : "bg-[var(--app-surface-soft)] text-[var(--app-text-secondary)]",
          )}
        >
          <ActionIcon className="h-3.5 w-3.5" />
        </span>
      </span>
    </>
  );

  const rowClassName = cn(
    "grid w-full grid-cols-[36px_minmax(0,1fr)_32px] items-center gap-2.5 rounded-[6px] border-0 px-2 py-2.5 text-left sm:grid-cols-[40px_minmax(0,1fr)_auto] sm:gap-3 sm:px-3 sm:py-3",
    isActionable && "group cursor-pointer transition-colors hover:bg-[var(--app-surface-hover)] focus-visible:bg-[var(--app-surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30",
  );

  if (!isActionable) {
    return <div className={rowClassName}>{content}</div>;
  }

  return (
    <button
      type="button"
      aria-label={route
        ? `Abrir ${notification.title}`
        : `Marcar ${notification.title} como lida`}
      onClick={onActivate}
      className={rowClassName}
    >
      {content}
    </button>
  );
}

export default function Notifications() {
  const { profile, tenantContext, loading: authLoading } = useAuth();
  const router = useRouter();
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [categoryFilters, setCategoryFilters] = useState<CategoryKey[]>([]);

  const {
    data: notifications = [],
    isFetched: notificationsFetched,
    isError: notificationsError,
    isFetching: notificationsFetching,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isFetchNextPageError,
    refetch: refetchNotifications,
  } = useNotifications();
  const {
    data: unreadCountFromAPI,
    isError: unreadCountError,
  } = useUnreadNotificationsCount();
  const markAsRead = useMarkNotificationRead();
  const markAllAsRead = useMarkAllNotificationsRead();

  // Combined filtering: status + category
  const filteredNotifications = useMemo(() => {
    return notifications.filter(n => {
      // Status filter
      if (filter === 'unread' && n.is_read) return false;

      // Category filter
      if (
        categoryFilters.length > 0 &&
        !categoryFilters.includes(getNotificationCategory(n.type))
      ) {
        return false;
      }

      return true;
    });
  }, [notifications, filter, categoryFilters]);

  const activeFilterCount = categoryFilters.length;
  const showInitialLoading = !notificationsFetched && notifications.length === 0;
  const loadedUnreadCount = notifications.filter((notification) => !notification.is_read).length;
  const unreadCount = unreadCountError ? loadedUnreadCount : unreadCountFromAPI ?? 0;
  const canViewWhatsApp = Boolean(
    tenantContext?.enabledModules.includes('whatsapp') &&
    tenantContext.permissions.includes('whatsapp_view'),
  );

  const toggleCategoryFilter = (category: CategoryKey) => {
    setCategoryFilters((current) => (
      current.includes(category)
        ? current.filter((item) => item !== category)
        : [...current, category]
    ));
  };

  if (authLoading) return null;
  if (!profile) return null;

  const handleNotificationClick = (notification: Notification) => {
    if (!notification.is_read) {
      markAsRead.mutate(notification.id, {
        onError: () => toast.error('Não foi possível marcar a notificação como lida.'),
      });
    }

    const route = getNotificationRoute(notification, { canViewWhatsApp });
    if (route) router.push(route);
  };

  const handleMarkAllAsRead = async () => {
    try {
      await markAllAsRead.mutateAsync();
    } catch {
      toast.error('Não foi possível marcar todas as notificações como lidas.');
    }
  };

  return (
    <AppLayout title="Notificações" disableMainScroll>
      <div className="flex h-full min-h-0 flex-col gap-3">
        <div className="flex w-full shrink-0 flex-wrap items-center justify-start gap-2 sm:justify-end">
          <Popover open={filtersOpen} onOpenChange={setFiltersOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                aria-expanded={filtersOpen}
                className={cn(
                  "h-8 shrink-0 gap-2 rounded-[6px] border-0 bg-[var(--app-surface)] px-3 text-[12px] font-light text-[var(--app-text-primary)] shadow-none transition-colors hover:bg-[var(--app-surface-hover)] hover:text-[var(--app-text-primary)] focus-visible:ring-1 focus-visible:ring-primary/30 [&_svg]:size-3.5",
                  activeFilterCount > 0 && "bg-[var(--app-surface-hover)] text-primary hover:text-primary"
                )}
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
                Filtros
                {activeFilterCount > 0 && (
                  <span className="flex h-4 min-w-4 items-center justify-center rounded-[4px] bg-primary px-1 text-[9px] text-primary-foreground">
                    {activeFilterCount}
                  </span>
                )}
              </Button>
            </PopoverTrigger>

            <PopoverContent
              align="end"
              sideOffset={8}
              className="notification-popover w-[min(240px,calc(100vw-1.5rem))] p-1.5"
            >
              <div className="flex items-center justify-between border-b border-border/30 px-1.5 pb-1.5">
                <p className="notification-title text-[var(--app-text-primary)]">
                  Filtros
                </p>
                {activeFilterCount > 0 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setCategoryFilters([])}
                    className="h-7 rounded-[6px] px-2 text-[12px] font-light text-primary hover:bg-[var(--app-surface-hover)] hover:text-primary"
                  >
                    Limpar
                  </Button>
                )}
              </div>

              <div className="mt-1 space-y-0.5">
                {(Object.keys(notificationCategories) as CategoryKey[]).map((key) => {
                  const category = notificationCategories[key];
                  const CategoryIcon = category.icon;
                  const isSelected = categoryFilters.includes(key);

                  return (
                    <button
                      key={key}
                      type="button"
                      aria-pressed={isSelected}
                      onClick={() => toggleCategoryFilter(key)}
                      className={cn(
                        "group flex w-full items-center gap-2 rounded-[6px] px-1.5 py-1.5 text-left text-[12px] font-light text-[var(--app-text-primary)] transition-colors hover:bg-[var(--app-surface-hover)] focus-visible:bg-[var(--app-surface-hover)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/30",
                        isSelected && "bg-[var(--app-surface-hover)]"
                      )}
                    >
                      <span className={cn(
                        "flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] bg-primary/50 text-primary-foreground transition-colors group-hover:bg-primary group-focus-visible:bg-primary",
                        isSelected && "bg-primary"
                      )}>
                        <CategoryIcon className="h-3 w-3" />
                      </span>
                      <span className="min-w-0 flex-1 truncate">{category.label}</span>
                      <span
                        aria-hidden="true"
                        className={cn(
                          "flex h-5 w-5 shrink-0 items-center justify-center rounded-[4px] bg-[var(--app-surface-soft)] text-transparent transition-colors",
                          isSelected && "bg-primary text-primary-foreground"
                        )}
                      >
                        <Check className="h-3 w-3" />
                      </span>
                    </button>
                  );
                })}
              </div>
            </PopoverContent>
          </Popover>

          <Tabs value={filter} onValueChange={(value) => setFilter(value as 'all' | 'unread')}>
            <TabsList className="h-8 shrink-0 rounded-[6px] border-0 bg-[var(--app-surface)] p-0.5 shadow-none">
              <TabsTrigger
                value="all"
                className="mx-0 h-7 rounded-[6px] px-2.5 text-[12px] font-light shadow-none transition-colors hover:bg-[var(--app-surface-hover)] data-[state=active]:bg-[var(--app-surface-hover)] data-[state=active]:text-[var(--app-text-primary)] data-[state=active]:shadow-none focus-visible:ring-1 focus-visible:ring-primary/30 focus-visible:ring-offset-0"
              >
                Todas
              </TabsTrigger>
              <TabsTrigger
                value="unread"
                className="mx-0 h-7 gap-1 rounded-[6px] px-2.5 text-[12px] font-light shadow-none transition-colors hover:bg-[var(--app-surface-hover)] data-[state=active]:bg-[var(--app-surface-hover)] data-[state=active]:text-[var(--app-text-primary)] data-[state=active]:shadow-none focus-visible:ring-1 focus-visible:ring-primary/30 focus-visible:ring-offset-0"
              >
                Não lidas
                {unreadCount > 0 && (
                  <span className="flex h-4 min-w-4 items-center justify-center rounded-[4px] bg-primary px-1 text-[9px] text-primary-foreground">
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </span>
                )}
              </TabsTrigger>
            </TabsList>
          </Tabs>

          {unreadCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 shrink-0 gap-1.5 rounded-[6px] border-0 bg-[var(--app-surface)] px-3 text-[12px] font-light shadow-none hover:bg-[var(--app-surface-hover)] [&_svg]:size-3.5"
              onClick={handleMarkAllAsRead}
              disabled={markAllAsRead.isPending}
              aria-label="Marcar todas as notificações como lidas"
            >
              {markAllAsRead.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCheck className="h-3.5 w-3.5" />}
              Marcar todas
            </Button>
          )}
        </div>

        <div
          aria-busy={showInitialLoading || notificationsFetching}
          className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[8px] border-0 bg-[var(--app-surface-solid)] p-1.5 shadow-none sm:p-2"
        >
          <p role="status" aria-live="polite" className="sr-only">
            {showInitialLoading
              ? 'Carregando notificações.'
              : isFetchingNextPage
                ? 'Carregando mais notificações.'
                : isFetchNextPageError
                  ? 'Não foi possível carregar mais notificações.'
                  : notificationsError
                    ? 'Não foi possível atualizar as notificações.'
                    : filteredNotifications.length === 0
                      ? 'Nenhuma notificação encontrada.'
                      : `${filteredNotifications.length} notificações exibidas.`}
          </p>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain scrollbar-thin">
            {showInitialLoading ? (
            <div>
              {[...Array(5)].map((_, index) => (
                <div
                  key={index}
                  className="grid grid-cols-[36px_minmax(0,1fr)_32px] items-center gap-2.5 rounded-[6px] px-2 py-2.5 sm:grid-cols-[40px_minmax(0,1fr)_auto] sm:gap-3 sm:px-3 sm:py-3"
                >
                  <Skeleton className="h-9 w-9 rounded-[6px] sm:h-10 sm:w-10" />
                  <div>
                    <Skeleton className="h-3 w-20" />
                    <Skeleton className="mt-2 h-4 w-1/2" />
                    <Skeleton className="mt-2 h-3 w-2/3" />
                  </div>
                  <div className="flex items-center gap-3">
                    <Skeleton className="hidden h-5 w-14 rounded-[4px] sm:block" />
                    <Skeleton className="hidden h-3 w-20 sm:block" />
                    <Skeleton className="h-8 w-8 rounded-[6px] sm:h-9 sm:w-9" />
                  </div>
                </div>
              ))}
            </div>
          ) : notificationsError && notifications.length === 0 ? (
            <div className="flex min-h-[176px] flex-col items-center justify-center px-6 py-8 text-center">
              <span className="flex h-10 w-10 items-center justify-center rounded-[6px] bg-[var(--app-surface-soft)] text-primary">
                <AlertTriangle className="h-4 w-4" aria-hidden="true" />
              </span>
              <p className="notification-title mt-3 text-[var(--app-text-primary)]">
                Não foi possível carregar as notificações
              </p>
              <p className="mt-1 max-w-md text-[12px] font-light leading-5 text-[var(--app-text-tertiary)]">
                Verifique sua conexão e tente novamente.
              </p>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => void refetchNotifications()}
                disabled={notificationsFetching}
                className="mt-4 h-8 rounded-[6px] bg-[var(--app-surface-soft)] px-3 text-[12px] font-light shadow-none hover:bg-[var(--app-surface-hover)]"
              >
                {notificationsFetching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                Tentar novamente
              </Button>
            </div>
          ) : filteredNotifications.length === 0 ? (
            <div className="flex min-h-[176px] flex-col items-center justify-center px-6 py-8 text-center">
              <span className="flex h-10 w-10 items-center justify-center rounded-[6px] bg-primary/50 text-primary-foreground">
                <Bell className="h-4 w-4" aria-hidden="true" />
              </span>
              <p className="notification-title mt-3 text-[var(--app-text-primary)]">
                Nenhuma notificação
              </p>
              <p className="mt-1 max-w-md text-[12px] font-light leading-5 text-[var(--app-text-tertiary)]">
                {activeFilterCount > 0
                  ? 'Nenhuma notificação corresponde aos filtros selecionados.'
                  : filter === 'unread'
                    ? unreadCount > 0
                      ? 'Carregue mais notificações para consultar itens não lidos mais antigos.'
                      : 'Você leu todas as notificações.'
                    : 'Você ainda não recebeu notificações.'}
              </p>
            </div>
          ) : (
            <div className="space-y-1">
              {filteredNotifications.map((notification) => {
                const notificationRoute = getNotificationRoute(notification, { canViewWhatsApp });

                return (
                  <div
                    key={notification.id}
                    className="border-b border-border/30 last:border-b-0"
                  >
                    <NotificationRow
                      notification={notification}
                      route={notificationRoute}
                      onActivate={() => handleNotificationClick(notification)}
                    />
                  </div>
                );
              })}
            </div>
            )}

            {hasNextPage ? (
              <div className="flex justify-center px-2 py-3">
                <Button
                  type="button"
                  size="sm"
                  onClick={() => void fetchNextPage()}
                  disabled={isFetchingNextPage}
                  aria-label={isFetchNextPageError ? 'Tentar carregar mais notificações' : 'Carregar mais notificações'}
                  className="h-8 rounded-[6px] bg-primary px-3 text-[12px] font-light text-primary-foreground shadow-none hover:bg-primary/90 hover:text-primary-foreground"
                >
                  {isFetchingNextPage ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : null}
                  {isFetchingNextPage
                    ? 'Carregando...'
                    : isFetchNextPageError
                      ? 'Tentar carregar mais'
                      : 'Carregar mais'}
                </Button>
              </div>
            ) : null}

            {notificationsError && !isFetchNextPageError && notifications.length > 0 ? (
              <div className="mt-1 flex items-center justify-between gap-3 rounded-[6px] bg-[var(--app-surface-soft)] px-3 py-2.5 text-[12px] font-light text-[var(--app-text-secondary)]">
                <span className="flex min-w-0 items-center gap-2">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
                  <span className="truncate">Não foi possível atualizar a lista.</span>
                </span>
                <button
                  type="button"
                  onClick={() => void refetchNotifications()}
                  disabled={notificationsFetching}
                  className="shrink-0 rounded-[6px] px-2 py-1 text-primary transition-colors hover:bg-[var(--app-surface-hover)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/30 disabled:opacity-50"
                >
                  Tentar novamente
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
