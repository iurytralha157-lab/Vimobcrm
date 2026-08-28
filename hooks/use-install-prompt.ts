import { useState, useEffect, useCallback } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

interface NavigatorWithStandalone extends Navigator {
  standalone?: boolean;
}

interface WindowWithMSStream extends Window {
  MSStream?: unknown;
}

interface InstallPromptState {
  isInstallable: boolean;
  isIOS: boolean;
  isStandalone: boolean;
  showPrompt: boolean;
  promptDismissed: boolean;
}

const STORAGE_KEY = 'pwa-install-prompt-dismissed';
const DISMISS_DURATION = 7 * 24 * 60 * 60 * 1000; // 7 days

function checkStandalone() {
  if (typeof window === 'undefined') return false;

  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as NavigatorWithStandalone).standalone === true ||
    document.referrer.includes('android-app://')
  );
}

function checkIOS() {
  if (typeof window === 'undefined') return false;

  const userAgent = window.navigator.userAgent.toLowerCase();
  return /iphone|ipad|ipod/.test(userAgent) && !(window as WindowWithMSStream).MSStream;
}

function checkDismissed() {
  if (typeof window === 'undefined') return false;

  try {
    const dismissed = localStorage.getItem(STORAGE_KEY);
    if (dismissed) {
      const dismissedAt = parseInt(dismissed, 10);
      if (Date.now() - dismissedAt < DISMISS_DURATION) {
        return true;
      }
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // localStorage not available
  }
  return false;
}

const INITIAL_INSTALL_PROMPT_STATE: InstallPromptState = {
  isInstallable: false,
  isIOS: false,
  isStandalone: false,
  showPrompt: false,
  promptDismissed: false,
};

export function useInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [state, setState] = useState<InstallPromptState>(INITIAL_INSTALL_PROMPT_STATE);

  useEffect(() => {
    let cancelled = false;
    const isStandalone = checkStandalone();
    const isIOS = checkIOS();
    const promptDismissed = checkDismissed();
    queueMicrotask(() => {
      if (cancelled) return;
      setState({
        isInstallable: isIOS && !isStandalone && !promptDismissed,
        isIOS,
        isStandalone,
        showPrompt: isIOS && !isStandalone && !promptDismissed,
        promptDismissed,
      });
    });

    // If already standalone, don't show anything
    if (isStandalone || isIOS) {
      return () => {
        cancelled = true;
      };
    }

    // For Android/Desktop, listen for beforeinstallprompt
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);

      if (!checkDismissed()) {
        setState(prev => ({
          ...prev,
          isInstallable: true,
          showPrompt: true,
        }));
      }
    };

    const handleAppInstalled = () => {
      setDeferredPrompt(null);
      setState(prev => ({
        ...prev,
        isInstallable: false,
        isStandalone: true,
        showPrompt: false,
      }));
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      cancelled = true;
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const install = useCallback(async () => {
    if (!deferredPrompt) {
      // For iOS, we can't trigger install programmatically
      return false;
    }

    try {
      await deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;

      if (outcome === 'accepted') {
        setDeferredPrompt(null);
        setState(prev => ({
          ...prev,
          isInstallable: false,
          showPrompt: false,
        }));
        return true;
      }

      if (outcome === 'dismissed') {
        try {
          localStorage.setItem(STORAGE_KEY, Date.now().toString());
        } catch {
          // localStorage not available
        }
        setState(prev => ({
          ...prev,
          showPrompt: false,
          promptDismissed: true,
        }));
      }
    } catch (error) {
      console.error('Install prompt error:', error);
    }

    return false;
  }, [deferredPrompt]);

  const dismiss = useCallback(() => {
    try {
      localStorage.setItem(STORAGE_KEY, Date.now().toString());
    } catch {
      // localStorage not available
    }

    setState(prev => ({
      ...prev,
      showPrompt: false,
      promptDismissed: true,
    }));
  }, []);

  const resetDismiss = useCallback(() => {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // localStorage not available
    }

    setState(prev => ({
      ...prev,
      promptDismissed: false,
      showPrompt: prev.isInstallable,
    }));
  }, []);

  return {
    ...state,
    install,
    dismiss,
    resetDismiss,
    canInstall: deferredPrompt !== null || state.isIOS,
  };
}
