import { useState, useEffect } from "react";
import { Bell } from "lucide-react";
import { WEB_PUSH_PROMPT_DISMISS_KEY, useWebPush } from "@/hooks/use-web-push";
import { useAuth } from "@/contexts/AuthContext";
import { Capacitor } from "@capacitor/core";
import { toast } from "sonner";
import {
  PWA_INSTALL_PROMPT_VISIBILITY_EVENT,
  PwaActionPrompt,
} from "./PwaActionPrompt";

const DISMISS_DURATION_DAYS = 7;

type StandaloneNavigator = Navigator & {
  standalone?: boolean;
};

type InstallPromptVisibilityEvent = CustomEvent<{
  visible?: boolean;
}>;

function isIOSDevice() {
  if (typeof navigator === "undefined") return false;
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

function isStandalonePwa() {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as StandaloneNavigator).standalone === true
  );
}

export function WebPushPrompt() {
  const { user } = useAuth();
  const {
    isSupported,
    isSubscribed,
    isOptedOut,
    isLoading,
    isReady,
    configurationStatus,
    permission,
    subscribe,
  } = useWebPush();

  const [showPrompt, setShowPrompt] = useState(false);
  const [isSubscribing, setIsSubscribing] = useState(false);
  const [installPromptVisible, setInstallPromptVisible] = useState(false);
  const showIosInstallPrompt = isIOSDevice() && !isStandalonePwa();

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) {
        setInstallPromptVisible(
          Boolean(document.querySelector('[data-pwa-prompt="install"]')),
        );
      }
    });

    const handleVisibility = (event: Event) => {
      const detail = (event as InstallPromptVisibilityEvent).detail;
      setInstallPromptVisible(Boolean(detail?.visible));
    };

    window.addEventListener(
      PWA_INSTALL_PROMPT_VISIBILITY_EVENT,
      handleVisibility,
    );
    return () => {
      cancelled = true;
      window.removeEventListener(
        PWA_INSTALL_PROMPT_VISIBILITY_EVENT,
        handleVisibility,
      );
    };
  }, []);

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

    if (installPromptVisible) {
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

    if (!isReady || configurationStatus !== "available" || isOptedOut) {
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

    if (permission === "denied") {
      hidePrompt();
      return () => {
        cancelled = true;
      };
    }

    if (!showIosInstallPrompt && isLoading) {
      return;
    }

    let dismissedAt: string | null = null;
    try {
      dismissedAt = localStorage.getItem(WEB_PUSH_PROMPT_DISMISS_KEY);
    } catch {
      // Storage is optional; showing the prompt remains safe.
    }
    if (dismissedAt) {
      const dismissedTimestamp = Number.parseInt(dismissedAt, 10);
      if (!Number.isFinite(dismissedTimestamp)) {
        try {
          localStorage.removeItem(WEB_PUSH_PROMPT_DISMISS_KEY);
        } catch {
          // Ignore restricted storage.
        }
      }
      if (Number.isFinite(dismissedTimestamp)) {
        const dismissedDate = new Date(dismissedTimestamp);
        const now = new Date();
        const diffDays =
          (now.getTime() - dismissedDate.getTime()) / (1000 * 60 * 60 * 24);

        if (diffDays < DISMISS_DURATION_DAYS) {
          hidePrompt();
          return () => {
            cancelled = true;
          };
        }
      }
    }

    const timer = setTimeout(() => {
      if (!cancelled) setShowPrompt(true);
    }, 3000);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    user?.id,
    isSupported,
    isSubscribed,
    isOptedOut,
    isLoading,
    isReady,
    configurationStatus,
    permission,
    showIosInstallPrompt,
    installPromptVisible,
  ]);

  const handleEnable = async () => {
    setIsSubscribing(true);
    try {
      const result = await subscribe();

      if (result.ok) {
        toast.success("Notificações ativadas com sucesso!");
        setShowPrompt(false);
      } else {
        toast.error(result.message);
      }
    } finally {
      setIsSubscribing(false);
    }
  };

  const handleDismiss = () => {
    try {
      localStorage.setItem(WEB_PUSH_PROMPT_DISMISS_KEY, Date.now().toString());
    } catch {
      // Restricted storage must not trap the user in the prompt.
    }
    setShowPrompt(false);
  };

  const title = "Ativar notificações";
  const description = "Receba alertas de novos leads e mensagens";

  if (!user?.id || !showPrompt) {
    return null;
  }

  return (
    <PwaActionPrompt
      title={title}
      description={description}
      actionLabel={isSubscribing ? "Ativando..." : "Ativar"}
      actionIcon={Bell}
      onAction={handleEnable}
      onDismiss={handleDismiss}
      actionDisabled={isSubscribing}
      dismissDisabled={isSubscribing}
      ariaLabel="Aviso para ativar notificações"
      promptKind="notifications"
    />
  );
}
