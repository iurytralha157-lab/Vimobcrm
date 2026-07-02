import { useState, useEffect } from 'react';
import NextImage from 'next/image';
import { X, Bell } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useWebPush } from '@/hooks/use-web-push';
import { useAuth } from '@/contexts/AuthContext';
import { Capacitor } from '@capacitor/core';
import { toast } from 'sonner';

const DISMISS_KEY = 'web-push-prompt-dismissed';
const DISMISS_DURATION_DAYS = 7;

type StandaloneNavigator = Navigator & {
  standalone?: boolean;
};

function isIOSDevice() {
  if (typeof navigator === 'undefined') return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function isStandalonePwa() {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as StandaloneNavigator).standalone === true;
}

export function WebPushPrompt() {
  const { user } = useAuth();
  const {
    isSupported,
    isSubscribed,
    isLoading,
    permission,
    subscribe,
  } = useWebPush();

  const [showPrompt, setShowPrompt] = useState(false);
  const [isSubscribing, setIsSubscribing] = useState(false);
  const showIosInstallPrompt = isIOSDevice() && !isStandalonePwa();

  useEffect(() => {
    let cancelled = false;
    const hidePrompt = () => {
      queueMicrotask(() => {
        if (!cancelled) setShowPrompt(false);
      });
    };

    if (Capacitor.isNativePlatform()) {
      hidePrompt();
      return () => {
        cancelled = true;
      };
    }

    if (!user?.id) {
      hidePrompt();
      return () => {
        cancelled = true;
      };
    }

    if (showIosInstallPrompt) {
      hidePrompt();
      return () => {
        cancelled = true;
      };
    }

    if (!showIosInstallPrompt && !isSupported) {
      hidePrompt();
      return () => {
        cancelled = true;
      };
    }

    if (isSubscribed) {
      hidePrompt();
      return () => {
        cancelled = true;
      };
    }

    if (permission === 'denied') {
      hidePrompt();
      return () => {
        cancelled = true;
      };
    }

    if (!showIosInstallPrompt && isLoading) {
      return;
    }

    const dismissedAt = localStorage.getItem(DISMISS_KEY);
    if (dismissedAt) {
      const dismissedDate = new Date(parseInt(dismissedAt, 10));
      const now = new Date();
      const diffDays = (now.getTime() - dismissedDate.getTime()) / (1000 * 60 * 60 * 24);

      if (diffDays < DISMISS_DURATION_DAYS) {
        hidePrompt();
        return () => {
          cancelled = true;
        };
      }
    }

    const timer = setTimeout(() => {
      if (!cancelled) setShowPrompt(true);
    }, 3000);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [user?.id, isSupported, isSubscribed, isLoading, permission, showIosInstallPrompt]);

  const handleEnable = async () => {
    setIsSubscribing(true);

    const success = await subscribe();

    setIsSubscribing(false);

    if (success) {
      toast.success('Notificacoes ativadas com sucesso!');
      setShowPrompt(false);
    } else {
      toast.error('Nao foi possivel ativar as notificacoes. Verifique as permissoes do navegador.');
    }
  };

  const handleDismiss = () => {
    localStorage.setItem(DISMISS_KEY, Date.now().toString());
    setShowPrompt(false);
  };

  const title = 'Ativar notificacoes';
  const description = 'Receba alertas de novos leads e mensagens';

  if (!user?.id || !showPrompt) {
    return null;
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] animate-in slide-in-from-bottom duration-300 sm:p-4 sm:pb-4">
      <div className="mx-auto flex w-full max-w-lg items-center gap-3 rounded-[14px] border border-white/[0.055] bg-[var(--app-surface-solid)] p-3 shadow-[0_18px_44px_rgba(0,0,0,0.38)] backdrop-blur-xl">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-[10px] bg-primary/10 sm:h-12 sm:w-12">
          <NextImage src="/icons/apple-touch-icon.png" alt="App Icon" width={32} height={32} className="object-contain" />
        </div>

        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold text-foreground">
            {title}
          </h3>
          <p className="max-h-[2.35em] overflow-hidden text-xs leading-snug text-muted-foreground sm:max-h-none sm:truncate">
            {description}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 rounded-[8px]"
            onClick={handleDismiss}
            disabled={isSubscribing}
          >
            <X className="h-4 w-4" />
          </Button>
          <Button
            size="sm"
            className="h-10 gap-1.5 rounded-[8px] px-3 text-sm"
            onClick={handleEnable}
            disabled={isSubscribing}
          >
            <Bell className="h-4 w-4" />
            {isSubscribing ? 'Ativando...' : 'Ativar'}
          </Button>
        </div>
      </div>
    </div>
  );
}
