import { useState, useEffect } from 'react';
import NextImage from 'next/image';
import { X, Bell, Share2 } from 'lucide-react';
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

  const title = showIosInstallPrompt ? 'Instale o Vimob no iPhone' : 'Ativar notificacoes';
  const description = showIosInstallPrompt
    ? 'No Safari, toque em compartilhar e depois em Adicionar a Tela de Inicio. Abra pelo icone para ativar push.'
    : 'Receba alertas de novos leads e mensagens';

  if (!user?.id || !showPrompt) {
    return null;
  }

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 p-4 bg-[var(--app-surface)] border-t border-white/[0.055] shadow-lg animate-in slide-in-from-bottom duration-300">
      <div className="max-w-lg mx-auto flex items-center gap-4">
        <div className="flex-shrink-0 w-12 h-12 bg-primary/10 rounded-xl flex items-center justify-center overflow-hidden">
          <NextImage src="/icons/apple-touch-icon.png" alt="App Icon" width={32} height={32} className="object-contain" />
        </div>

        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-foreground text-sm">
            {title}
          </h3>
          <p className="text-xs text-muted-foreground leading-snug">
            {description}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={handleDismiss}
            disabled={isSubscribing}
          >
            <X className="h-4 w-4" />
          </Button>
          <Button
            size="sm"
            className="gap-1.5"
            onClick={showIosInstallPrompt ? handleDismiss : handleEnable}
            disabled={!showIosInstallPrompt && isSubscribing}
          >
            {showIosInstallPrompt ? <Share2 className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
            {showIosInstallPrompt ? 'Entendi' : isSubscribing ? 'Ativando...' : 'Ativar'}
          </Button>
        </div>
      </div>
    </div>
  );
}
