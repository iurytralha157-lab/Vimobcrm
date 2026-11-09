import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { settingsAPI } from '@/lib/api/settings';
import {
  forgetCurrentPushEndpoint,
  rememberCurrentPushEndpoint,
} from '@/lib/pwa/push-session';
import { useQueryClient } from '@tanstack/react-query';
import { usePushDeviceIntent } from '@/hooks/use-push-device-intent';
import type { PushDeviceIntent } from '@/hooks/use-push-device-intent';

const VAPID_STORAGE_KEY = 'vimob-web-push-vapid-key';
const WEB_PUSH_OPT_OUT_KEY_PREFIX = 'vimob-web-push-opt-out';
export const WEB_PUSH_PROMPT_DISMISS_KEY = 'web-push-prompt-dismissed';
const WEB_PUSH_STATE_EVENT = 'vimob:web-push-state';

type WebPushConfigurationStatus = 'unknown' | 'available' | 'unavailable';

type WebPushStateEventDetail = {
  userId: string;
  organizationId: string;
  isSubscribed: boolean;
  isOptedOut: boolean;
  endpoint: string | null;
};

let webPushOperationQueue: Promise<void> | null = null;

function serializeWebPushOperation<T>(operation: () => Promise<T>) {
  const result = webPushOperationQueue ? webPushOperationQueue.then(operation) : operation();
  const completion = result.then(() => undefined, () => undefined);
  webPushOperationQueue = completion;
  void completion.then(() => {
    if (webPushOperationQueue === completion) webPushOperationQueue = null;
  });
  return result;
}

function publishWebPushState(detail: WebPushStateEventDetail) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<WebPushStateEventDetail>(WEB_PUSH_STATE_EVENT, { detail }));
}

function webPushOptOutKey(userId: string) {
  return `${WEB_PUSH_OPT_OUT_KEY_PREFIX}:account:${userId}`;
}

function readWebPushOptOut(userId: string | null | undefined, organizationId: string | null | undefined) {
  if (typeof window === 'undefined' || !userId || !organizationId) return false;
  try {
    const accountDecision = localStorage.getItem(webPushOptOutKey(userId));
    if (accountDecision !== null) return accountDecision === '1';
    // Preserve the prior preference until this account makes an explicit new
    // decision. A decision in B also governs the same physical device in A.
    return localStorage.getItem(`${WEB_PUSH_OPT_OUT_KEY_PREFIX}:${userId}:${organizationId}`) === '1';
  } catch {
    return false;
  }
}

function writeWebPushOptOut(
  userId: string | null | undefined,
  organizationId: string | null | undefined,
  optedOut: boolean,
) {
  if (typeof window === 'undefined' || !userId || !organizationId) return;
  try {
    localStorage.setItem(webPushOptOutKey(userId), optedOut ? '1' : '0');
  } catch {
    // Browser storage is optional; the server-side token state remains canonical.
  }
}


// Converte base64 URL-safe para Uint8Array (necessário para applicationServerKey)
// Suporta tanto chaves raw (65 bytes) quanto SPKI/DER (91 bytes)
function urlBase64ToUint8Array(base64String: string): ArrayBuffer {
  // Adiciona padding se necessário
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding)
    .replace(/-/g, '+')
    .replace(/_/g, '/');

  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }

  console.log('[WebPush] VAPID key decoded, length:', outputArray.length, 'bytes');

  // Se a chave tem 91 bytes, é formato SPKI/DER
  // A chave pública EC P-256 raw (65 bytes começando com 0x04) está no offset 26
  if (outputArray.length === 91) {
    console.log('[WebPush] Detectado formato SPKI (91 bytes), extraindo chave raw P-256...');
    const rawKey = outputArray.slice(26);
    console.log('[WebPush] Chave raw extraída:', rawKey.length, 'bytes, primeiro byte:', '0x' + rawKey[0].toString(16));
    if (rawKey[0] !== 0x04 || rawKey.length !== 65) {
      console.warn('[WebPush] Aviso: chave extraída pode estar em formato incorreto');
    }
    return rawKey.buffer.slice(rawKey.byteOffset, rawKey.byteOffset + rawKey.byteLength);
  }

  // Chave já em formato raw (65 bytes)
  if (outputArray.length === 65) {
    console.log('[WebPush] Chave já em formato raw (65 bytes)');
  } else {
    console.warn('[WebPush] Tamanho de chave inesperado:', outputArray.length);
  }

  return outputArray.buffer.slice(0, outputArray.byteLength);
}

function arrayBufferToBase64Url(buffer: ArrayBuffer | null | undefined): string | null {
  if (!buffer) return null;

  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }

  return window.btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function storedVapidKey() {
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem(VAPID_STORAGE_KEY);
  } catch {
    return null;
  }
}

function storeCurrentVapidKey(currentKey: string | null) {
  if (typeof window === 'undefined' || !currentKey) return;
  try {
    localStorage.setItem(VAPID_STORAGE_KEY, currentKey);
  } catch {
    // Push remains usable when storage is blocked; key rotation is rechecked
    // against PushSubscription.options whenever the browser exposes it.
  }
}

function clearRotatedWebPushState() {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(VAPID_STORAGE_KEY);
    localStorage.removeItem(WEB_PUSH_PROMPT_DISMISS_KEY);
  } catch {
    // Restricted/private storage must not make subscription recovery fail.
  }
}

function shouldReplaceSubscription(subscription: PushSubscription, currentKey: string | null) {
  if (!currentKey) return false;
  const subscriptionKey = arrayBufferToBase64Url(subscription.options?.applicationServerKey);
  const savedKey = storedVapidKey();

  if (subscriptionKey) {
    return subscriptionKey !== currentKey;
  }

  // Safari/iOS may not expose applicationServerKey. Use the key stored when
  // this browser last subscribed; without it, force one clean resubscribe.
  return savedKey !== currentKey;
}

async function getServiceWorkerRegistration() {
  const existing = await navigator.serviceWorker.getRegistration('/');
  const existingScriptURL = existing?.active?.scriptURL
    || existing?.waiting?.scriptURL
    || existing?.installing?.scriptURL;
  if (existing && existingScriptURL && new URL(existingScriptURL).pathname === '/sw.js') {
    void existing.update().catch(() => undefined);
    return existing;
  }
  return navigator.serviceWorker.register('/sw.js', {
    scope: '/',
    updateViaCache: 'none',
  });
}

async function getReadyServiceWorkerRegistration(signal: AbortSignal) {
  const readiness = getServiceWorkerRegistration().then(async (registration) => {
    const ready = await navigator.serviceWorker.ready;
    if (ready.scope !== registration.scope || !ready.active || new URL(ready.active.scriptURL).pathname !== '/sw.js') {
      throw new Error('O Service Worker do Vimob não está ativo.');
    }
    return ready;
  });
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  try {
    return await new Promise<ServiceWorkerRegistration>((resolve, reject) => {
      abort = () => reject(new DOMException('Cancelled', 'AbortError'));
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
      timeout = setTimeout(() => reject(new Error('O Service Worker do Vimob demorou para ficar pronto.')), 8000);
      void readiness.then(resolve, reject);
    });
  } finally {
    clearTimeout(timeout);
    if (abort) signal.removeEventListener('abort', abort);
  }
}

async function loadVapidPublicKey() {
  const config = await settingsAPI.getPushConfig();
  const publicKey = config.publicKey.trim();
  if (!config.enabled || !publicKey) {
    throw new Error('Notificacoes push nao estao configuradas neste ambiente.');
  }
  return publicKey;
}

type PreparedWebPush = Pick<PushDeviceIntent, 'userId' | 'organizationId' | 'sessionId'> & {
  registration: ServiceWorkerRegistration;
  vapidPublicKey: string;
  applicationServerKey: ArrayBuffer;
};

interface WebPushState {
  isSupported: boolean;
  isSubscribed: boolean;
  isOptedOut: boolean;
  isLoading: boolean;
  isReady: boolean;
  configurationStatus: WebPushConfigurationStatus;
  permission: NotificationPermission | null;
  error: string | null;
}

type WebPushInitializationResult = WebPushState & {
  endpoint: string | null;
  prepared: PreparedWebPush | null;
};

export type WebPushSubscribeResult =
  | { ok: true }
  | {
      ok: false;
      reason: 'configuration' | 'permission_denied' | 'service_worker' | 'browser_push' | 'save_failed' | 'unknown';
      message: string;
    };

type SaveSubscriptionOptions = {
  syncOnly?: boolean;
};

export function useWebPush() {
  const { activeOrganization, user } = useAuth();
  const queryClient = useQueryClient();
  const organizationId = activeOrganization.organizationId;
  const captureIntent = usePushDeviceIntent(user?.id, organizationId);
  const [state, setState] = useState<WebPushState>({
    isSupported: false,
    isSubscribed: false,
    isOptedOut: false,
    isLoading: true,
    isReady: false,
    configurationStatus: 'unknown',
    permission: null,
    error: null,
  });
  const lastEndpointRef = useRef<string | null>(null);
  const preparedRef = useRef<PreparedWebPush | null>(null);

  // Verifica suporte a Web Push
  const checkSupport = useCallback(() => {
    const isSupported =
      'serviceWorker' in navigator &&
      'PushManager' in window &&
      'Notification' in window;

    return isSupported;
  }, []);

  // Salva subscription no Supabase
  const saveSubscription = useCallback(async (
    subscription: PushSubscription,
    vapidPublicKey: string,
    options: SaveSubscriptionOptions = {},
    existingIntent?: PushDeviceIntent,
  ) => {
    const intent = existingIntent || captureIntent();
    try {
      const subscriptionJson = subscription.toJSON() as {
        endpoint?: string;
        keys?: { p256dh?: string; auth?: string };
      };
      if (!subscriptionJson.endpoint) {
        throw new Error('Subscription sem endpoint');
      }
      if (!subscriptionJson.keys?.p256dh || !subscriptionJson.keys?.auth) {
        throw new Error('Subscription sem chaves de criptografia');
      }
      const response = await settingsAPI.savePushToken({
        endpoint: subscriptionJson.endpoint,
        p256dh: subscriptionJson.keys.p256dh,
        auth: subscriptionJson.keys.auth,
        userAgent: navigator.userAgent,
        vapidPublicKey,
        syncOnly: options.syncOnly,
      }, intent.organizationId, { expectedUserId: intent.userId, expectedSessionId: intent.sessionId, signal: intent.signal });
      intent.assertCurrent();
      console.log('[WebPush] Subscription salva');
      return response;
    } catch (error) {
      if (!intent.isCurrent()) throw error;
      console.error('[WebPush] Erro ao salvar subscription:', error);
      throw error;
    } finally {
      if (!existingIntent) intent.finish();
    }
  }, [captureIntent]);

  // Remove subscription do Supabase
  const removeSubscription = useCallback(async (endpoint?: string | null, existingIntent?: PushDeviceIntent) => {
    if (!endpoint) return;
    const intent = existingIntent || captureIntent();

    try {
      await settingsAPI.deactivatePushToken(endpoint, intent.organizationId, { expectedUserId: intent.userId, expectedSessionId: intent.sessionId, signal: intent.signal });
      intent.assertCurrent();

      console.log('[WebPush] Subscription desativada');
    } catch (error) {
      if (!intent.isCurrent()) throw error;
      console.error('[WebPush] Erro ao remover subscription:', error);
      throw error;
    } finally {
      if (!existingIntent) intent.finish();
    }
  }, [captureIntent]);

  const subscribe = useCallback((): Promise<WebPushSubscribeResult> => {
    const cancelled: WebPushSubscribeResult = {
      ok: false, reason: 'unknown', message: 'Ativação cancelada porque a sessão mudou.',
    };
    let intent: PushDeviceIntent;
    try {
      intent = captureIntent();
    } catch {
      return Promise.resolve(cancelled);
    }

    const prepared = preparedRef.current;
    if (!prepared || prepared.userId !== intent.userId || prepared.organizationId !== intent.organizationId ||
        prepared.sessionId !== intent.sessionId || webPushOperationQueue) {
      intent.finish();
      return Promise.resolve({
        ok: false, reason: 'service_worker',
        message: 'Este dispositivo ainda está sendo preparado. Aguarde e toque em Ativar novamente.',
      });
    }

    // Safari requires subscribe itself to run in the tap handler. Preparation
    // and key rotation happen during initialization, before enabling the button.
    return serializeWebPushOperation<WebPushSubscribeResult>(async () => {
      try {
        intent.assertCurrent();
        setState(prev => ({ ...prev, isLoading: true, error: null }));

        let subscription: PushSubscription;
        try {
          subscription = await prepared.registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: prepared.applicationServerKey,
          });
          intent.assertCurrent();
        } catch (error) {
          if (!intent.isCurrent()) return cancelled;
          const permission = Notification.permission;
          const denied = permission === 'denied';
          const message = denied
            ? 'Permissão de notificação negada. Ative nas configurações do aparelho.'
            : 'O navegador recusou a ativação das notificações neste dispositivo.';
          setState(prev => ({ ...prev, isLoading: false, permission, error: message }));
          return { ok: false, reason: denied ? 'permission_denied' : 'browser_push', message };
        }

        lastEndpointRef.current = subscription.endpoint;
        storeCurrentVapidKey(arrayBufferToBase64Url(prepared.applicationServerKey));
        rememberCurrentPushEndpoint(subscription.endpoint);
        try {
          const result = await saveSubscription(subscription, prepared.vapidPublicKey, {}, intent);
          if (!result.ok || result.active !== true) throw new Error('O servidor não confirmou o cadastro.');
        } catch {
          if (!intent.isCurrent()) return cancelled;
          // Preserve the local endpoint for an explicit retry after a temporary
          // server failure. A browser subscription alone is not active delivery.
          const message = 'Não foi possível registrar este dispositivo no servidor. Tente ativar novamente.';
          setState(prev => ({ ...prev, isSubscribed: false, isLoading: false, permission: Notification.permission, error: message }));
          return { ok: false, reason: 'save_failed', message };
        }

        writeWebPushOptOut(intent.userId, intent.organizationId, false);
        void queryClient.invalidateQueries({ queryKey: ['settings', 'push-devices', intent.organizationId] });
        setState(prev => ({
          ...prev, isSubscribed: true, isOptedOut: false, isLoading: false,
          isReady: true, configurationStatus: 'available', permission: Notification.permission, error: null,
        }));
        publishWebPushState({
          userId: intent.userId, organizationId: intent.organizationId,
          isSubscribed: true, isOptedOut: false, endpoint: subscription.endpoint,
        });
        return { ok: true };
      } finally {
        intent.finish();
      }
    });
  }, [captureIntent, queryClient, saveSubscription]);

  // Cancela subscription
  const unsubscribe = useCallback((): Promise<boolean> => {
    const intent = captureIntent();
    return serializeWebPushOperation(async () => {
    intent.assertCurrent();
    setState(prev => ({ ...prev, isLoading: true }));
    writeWebPushOptOut(user?.id, organizationId, true);
    let serverDeactivated = false;

    try {
      const registration = await getServiceWorkerRegistration();
      intent.assertCurrent();
      const subscription = await registration.pushManager.getSubscription();
      intent.assertCurrent();
      const endpoint = subscription?.endpoint || lastEndpointRef.current;

      if (endpoint) {
        await removeSubscription(endpoint, intent);
        serverDeactivated = true;
      }

      if (subscription) {
        const removedFromBrowser = await subscription.unsubscribe();
        intent.assertCurrent();
        if (!removedFromBrowser) {
          throw new Error('O navegador não removeu a inscrição local.');
        }
      }

      lastEndpointRef.current = null;
      forgetCurrentPushEndpoint(endpoint);
      if (organizationId) {
        void queryClient.invalidateQueries({
          queryKey: ['settings', 'push-devices', organizationId],
        });
      }

      setState(prev => ({
        ...prev,
        isSubscribed: false,
        isOptedOut: true,
        isLoading: false,
        error: null,
      }));

      if (user?.id && organizationId) {
        publishWebPushState({
          userId: user.id,
          organizationId,
          isSubscribed: false,
          isOptedOut: true,
          endpoint: null,
        });
      }

      return true;
    } catch (error) {
      if (!intent.isCurrent()) return false;
      console.error('[WebPush] Erro ao desinscrever:', error);

      // Once the server token is inactive, delivery has been disabled even if
      // the browser could not discard its local PushSubscription. The opt-out
      // marker makes the next initialization retry local cleanup without
      // silently subscribing again.
      if (serverDeactivated) {
        lastEndpointRef.current = null;
        forgetCurrentPushEndpoint();
        setState(prev => ({
          ...prev,
          isSubscribed: false,
          isOptedOut: true,
          isLoading: false,
          error: null,
        }));
        if (user?.id && organizationId) {
          publishWebPushState({
            userId: user.id,
            organizationId,
            isSubscribed: false,
            isOptedOut: true,
            endpoint: null,
          });
          void queryClient.invalidateQueries({
            queryKey: ['settings', 'push-devices', organizationId],
          });
        }
        return true;
      }

      writeWebPushOptOut(user?.id, organizationId, false);
      setState(prev => ({
        ...prev,
        isLoading: false,
        error: error instanceof Error ? error.message : 'Erro ao desativar notificações'
      }));
      return false;
    }
    }).finally(intent.finish);
  }, [captureIntent, organizationId, queryClient, removeSubscription, user?.id]);

  // Inicialização
  useEffect(() => {
    let cancelled = false;
    const intent = user?.id && organizationId ? captureIntent() : null;
    const optedOut = readWebPushOptOut(user?.id, organizationId);

    const init = async (): Promise<WebPushInitializationResult> => {
      if (!intent) throw new DOMException('Cancelled', 'AbortError');
      intent.assertCurrent();
      const isSupported = checkSupport();

      if (!isSupported) {
        return {
          isSupported: false,
          isSubscribed: false,
          isOptedOut: optedOut,
          isLoading: false,
          isReady: true,
          configurationStatus: 'unknown',
          permission: null,
          error: null,
          endpoint: null,
          prepared: null,
        };
      }

      const permission = Notification.permission;
      let registration: ServiceWorkerRegistration;
      let subscription: PushSubscription | null;
      try {
        registration = await getReadyServiceWorkerRegistration(intent.signal);
        intent.assertCurrent();
        subscription = await registration.pushManager.getSubscription();
        intent.assertCurrent();
      } catch (error) {
        if (!intent.isCurrent()) throw error;
        return {
          isSupported: true, isSubscribed: false, isOptedOut: optedOut,
          isLoading: false, isReady: true, configurationStatus: 'unavailable',
          permission, error: 'Não foi possível preparar as notificações. Reabra o aplicativo e tente novamente.',
          endpoint: null, prepared: null,
        };
      }

      let prepared: PreparedWebPush;
      try {
        const vapidPublicKey = await loadVapidPublicKey();
        intent.assertCurrent();
        prepared = {
          userId: intent.userId, organizationId: intent.organizationId, sessionId: intent.sessionId,
          registration, vapidPublicKey, applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
        };
      } catch (error) {
        if (!intent.isCurrent()) throw error;
        return {
          isSupported: true, isSubscribed: false, isOptedOut: optedOut,
          isLoading: false, isReady: true, configurationStatus: 'unavailable',
          permission, error: 'A configuração de notificações não está disponível agora.',
          endpoint: subscription?.endpoint || null, prepared: null,
        };
      }

      let confirmed = false;
      let syncError: string | null = null;
      if (subscription) {
        try {
          const currentKey = arrayBufferToBase64Url(prepared.applicationServerKey);
          if (optedOut) {
            await removeSubscription(subscription.endpoint, intent);
            intent.assertCurrent();
            const removed = await subscription.unsubscribe();
            intent.assertCurrent();
            if (!removed) throw new Error('O navegador não removeu a inscrição local.');
            subscription = null;
          } else if (shouldReplaceSubscription(subscription, currentKey)) {
            await subscription.unsubscribe();
            intent.assertCurrent();
            clearRotatedWebPushState();
            subscription = null;
          } else if (permission === 'granted') {
            const result = await saveSubscription(subscription, prepared.vapidPublicKey, { syncOnly: true }, intent);
            if (result.requiresResubscribe) {
              await subscription.unsubscribe();
              intent.assertCurrent();
              clearRotatedWebPushState();
              subscription = null;
            } else if (result.ok && result.active === true) {
              storeCurrentVapidKey(currentKey);
              confirmed = true;
            } else {
              syncError = 'O cadastro deste dispositivo não está ativo. Toque em Ativar para tentar novamente.';
            }
          }
        } catch (error) {
          if (!intent.isCurrent()) throw error;
          syncError = optedOut
            ? 'Não foi possível concluir a desativação neste navegador.'
            : 'Não foi possível sincronizar este dispositivo. Toque em Ativar para tentar novamente.';
        }
      }

      return {
        isSupported: true, isSubscribed: confirmed, isOptedOut: optedOut,
        isLoading: false, isReady: true, configurationStatus: 'available',
        permission, error: syncError, endpoint: subscription?.endpoint || null, prepared,
      };
    };

    if (!intent) {
      queueMicrotask(() => {
        if (!cancelled) {
          setState({
            isSupported: false,
            isSubscribed: false,
            isOptedOut: false,
            isLoading: false,
            isReady: true,
            configurationStatus: 'unknown',
            permission: null,
            error: null,
          });
        }
      });
      return () => {
        cancelled = true;
      };
    }

    queueMicrotask(() => {
      if (!cancelled) {
        setState(prev => ({
          ...prev,
          isLoading: true,
          isReady: false,
          isSubscribed: false,
          isOptedOut: optedOut,
          error: null,
        }));
      }
    });

    // Keep browser mutations serialized, but never share an aborted login's
    // initialization promise with a later visit or another hook instance.
    const initialization = serializeWebPushOperation(init);

    void initialization.then((result) => {
      if (cancelled || !intent.isCurrent()) return;
      preparedRef.current = result.prepared;
      lastEndpointRef.current = result.endpoint;
      if (result.endpoint) rememberCurrentPushEndpoint(result.endpoint);
      else if (result.isOptedOut) forgetCurrentPushEndpoint();
      setState({
        isSupported: result.isSupported,
        isSubscribed: result.isSubscribed,
        isOptedOut: result.isOptedOut,
        isLoading: result.isLoading,
        isReady: result.isReady,
        configurationStatus: result.configurationStatus,
        permission: result.permission,
        error: result.error,
      });
    }).catch((error) => {
      if (cancelled || !intent.isCurrent()) return;
      setState(prev => ({
        ...prev,
        isLoading: false,
        isReady: true,
        error: error instanceof Error
          ? error.message
          : 'Não foi possível verificar as notificações deste dispositivo.',
      }));
    }).finally(intent.finish);

    return () => {
      cancelled = true;
      preparedRef.current = null;
      intent.cancel();
    };
  }, [
    user?.id,
    captureIntent,
    organizationId,
    checkSupport,
    removeSubscription,
    saveSubscription,
  ]);

  useEffect(() => {
    const handleSharedState = (event: Event) => {
      const detail = (event as CustomEvent<WebPushStateEventDetail>).detail;
      if (
        !detail
        || detail.userId !== user?.id
        || detail.organizationId !== organizationId
      ) return;

      lastEndpointRef.current = detail.endpoint;
      if (detail.endpoint) rememberCurrentPushEndpoint(detail.endpoint);
      else forgetCurrentPushEndpoint();
      setState(prev => ({
        ...prev,
        isSubscribed: detail.isSubscribed,
        isOptedOut: detail.isOptedOut,
        isLoading: false,
        isReady: true,
        error: null,
      }));
    };

    window.addEventListener(WEB_PUSH_STATE_EVENT, handleSharedState);
    return () => window.removeEventListener(WEB_PUSH_STATE_EVENT, handleSharedState);
  }, [organizationId, user?.id]);

  return {
    ...state,
    subscribe,
    unsubscribe,
  };
}
