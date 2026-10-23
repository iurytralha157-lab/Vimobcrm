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

let webPushOperationQueue: Promise<void> = Promise.resolve();

function serializeWebPushOperation<T>(operation: () => Promise<T>) {
  const result = webPushOperationQueue.then(operation, operation);
  webPushOperationQueue = result.then(() => undefined, () => undefined);
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

async function getReadyServiceWorkerRegistration() {
  await getServiceWorkerRegistration();
  return navigator.serviceWorker.ready;
}

async function loadVapidPublicKey() {
  const config = await settingsAPI.getPushConfig();
  const publicKey = config.publicKey.trim();
  if (!config.enabled || !publicKey) {
    throw new Error('Notificacoes push nao estao configuradas neste ambiente.');
  }
  return publicKey;
}

async function createOrReusePushSubscription(
  registration: ServiceWorkerRegistration,
  vapidPublicKey: string,
  intent: PushDeviceIntent,
) {
  const applicationServerKey = urlBase64ToUint8Array(vapidPublicKey);
  const currentKey = arrayBufferToBase64Url(applicationServerKey);
  const existingSubscription = await registration.pushManager.getSubscription();
  intent.assertCurrent();

  if (existingSubscription) {
    const shouldReplace = shouldReplaceSubscription(existingSubscription, currentKey);
    if (!shouldReplace) {
      storeCurrentVapidKey(currentKey);
      return existingSubscription;
    }

    clearRotatedWebPushState();
    await existingSubscription.unsubscribe();
    intent.assertCurrent();
  }

  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey,
  });
  intent.assertCurrent();
  storeCurrentVapidKey(currentKey);
  return subscription;
}

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

  // Verifica suporte a Web Push
  const checkSupport = useCallback(() => {
    const isSupported =
      'serviceWorker' in navigator &&
      'PushManager' in window &&
      'Notification' in window;

    return isSupported;
  }, []);

  // Verifica se já está inscrito
  const checkSubscription = useCallback(async (vapidPublicKey: string, intent: PushDeviceIntent): Promise<PushSubscription | null> => {
    try {
      await getServiceWorkerRegistration();
      intent.assertCurrent();
      const registration = await navigator.serviceWorker.ready;
      intent.assertCurrent();
      const subscription = await registration.pushManager.getSubscription();
      intent.assertCurrent();
      lastEndpointRef.current = subscription?.endpoint || null;

      if (subscription) {
        const currentKey = arrayBufferToBase64Url(urlBase64ToUint8Array(vapidPublicKey));

        if (shouldReplaceSubscription(subscription, currentKey)) {
          console.log('[WebPush] Subscription usa VAPID antigo/desconhecido; removendo para reinscrever.');
          clearRotatedWebPushState();
          await subscription.unsubscribe();
          intent.assertCurrent();
          return null;
        }
        storeCurrentVapidKey(currentKey);
      }

      return subscription;
    } catch (error) {
      if (!intent.isCurrent()) throw error;
      console.error('[WebPush] Erro ao verificar subscription:', error);
      return null;
    }
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

  // Solicita permissão e cria subscription
  const subscribe = useCallback((): Promise<WebPushSubscribeResult> => {
    const intent = captureIntent();
    return serializeWebPushOperation<WebPushSubscribeResult>(async () => {
    intent.assertCurrent();
    console.log('[WebPush] Iniciando subscription...');
    console.log('[WebPush] Configuracao VAPID sera carregada da API.');

    setState(prev => ({ ...prev, isLoading: true, error: null }));

    try {
      let vapidPublicKey: string;
      try {
        vapidPublicKey = await loadVapidPublicKey();
        intent.assertCurrent();
      } catch (error) {
        if (!intent.isCurrent()) throw error;
        const errorMessage = error instanceof Error
          ? error.message
          : 'Notificacoes push nao estao configuradas neste ambiente.';
        setState(prev => ({
          ...prev,
          isLoading: false,
          isReady: true,
          configurationStatus: 'unavailable',
          error: errorMessage,
        }));
        return {
          ok: false,
          reason: 'configuration',
          message: errorMessage,
        };
      }
      console.log('[WebPush] Configuracao VAPID carregada da API.');
      setState(prev => ({
        ...prev,
        configurationStatus: 'available',
      }));

      // Solicita permissão
      console.log('[WebPush] Solicitando permissão...');
      const permission = await Notification.requestPermission();
      intent.assertCurrent();
      console.log('[WebPush] Permissão:', permission);
      setState(prev => ({ ...prev, permission }));

      if (permission !== 'granted') {
        console.log('[WebPush] Permissão negada pelo usuário');
        setState(prev => ({
          ...prev,
          isLoading: false,
          error: 'Permissão negada para notificações'
        }));
        return {
          ok: false,
          reason: 'permission_denied',
          message: 'Permissão de notificação negada. Ative nas configurações do navegador.',
        };
      }

      // Aguarda o Service Worker estar pronto
      console.log('[WebPush] Aguardando Service Worker...');
      let registration: ServiceWorkerRegistration;
      try {
        registration = await getReadyServiceWorkerRegistration();
        intent.assertCurrent();
      } catch (error) {
        if (!intent.isCurrent()) throw error;
        const errorMessage = error instanceof Error ? error.message : 'Service Worker indisponível';
        setState(prev => ({
          ...prev,
          isLoading: false,
          error: errorMessage
        }));
        return {
          ok: false,
          reason: 'service_worker',
          message: 'Não foi possível preparar o dispositivo para notificações. Atualize a página e tente novamente.',
        };
      }
      console.log('[WebPush] Service Worker pronto:', registration.scope);

      // Cria subscription
      console.log('[WebPush] Criando subscription com PushManager...');
      let subscription: PushSubscription;
      try {
        subscription = await createOrReusePushSubscription(registration, vapidPublicKey, intent);
        intent.assertCurrent();
      } catch (error) {
        if (!intent.isCurrent()) throw error;
        const errorMessage = error instanceof Error ? error.message : 'Erro ao criar subscription';
        console.error('[WebPush] Erro ao criar subscription:', error);
        setState(prev => ({
          ...prev,
          isLoading: false,
          error: errorMessage
        }));
        return {
          ok: false,
          reason: 'browser_push',
          message: 'O navegador recusou a ativação das notificações neste dispositivo.',
        };
      }

      console.log('[WebPush] Subscription criada:', subscription.endpoint);
      lastEndpointRef.current = subscription.endpoint;

      // Salva no banco
      console.log('[WebPush] Salvando subscription no banco...');
      try {
        await saveSubscription(subscription, vapidPublicKey, {}, intent);
      } catch (error) {
        if (!intent.isCurrent()) throw error;
        const errorMessage = error instanceof Error ? error.message : 'Erro ao salvar subscription';
        console.error('[WebPush] Erro ao salvar subscription no servidor:', error);
        await subscription.unsubscribe().catch(() => undefined);
        intent.assertCurrent();
        clearRotatedWebPushState();
        setState(prev => ({
          ...prev,
          isSubscribed: false,
          isLoading: false,
          error: errorMessage
        }));
        return {
          ok: false,
          reason: 'save_failed',
          message: 'Não foi possível registrar este dispositivo no servidor. Tente novamente em instantes.',
        };
      }
      console.log('[WebPush] Subscription salva com sucesso!');
      writeWebPushOptOut(user?.id, organizationId, false);
      rememberCurrentPushEndpoint(subscription.endpoint);
      if (organizationId) {
        void queryClient.invalidateQueries({
          queryKey: ['settings', 'push-devices', organizationId],
        });
      }

      setState(prev => ({
        ...prev,
        isSubscribed: true,
        isOptedOut: false,
        isLoading: false,
        isReady: true,
        configurationStatus: 'available',
        error: null
      }));

      if (user?.id && organizationId) {
        publishWebPushState({
          userId: user.id,
          organizationId,
          isSubscribed: true,
          isOptedOut: false,
          endpoint: subscription.endpoint,
        });
      }

      return { ok: true };
    } catch (error) {
      if (!intent.isCurrent()) return { ok: false, reason: 'unknown', message: 'Ativação cancelada porque a sessão mudou.' };
      console.error('[WebPush] Erro ao inscrever:', error);
      const errorMessage = error instanceof Error ? error.message : 'Erro ao ativar notificações';
      console.error('[WebPush] Mensagem de erro:', errorMessage);
      setState(prev => ({
        ...prev,
        isLoading: false,
        error: errorMessage
      }));
      return {
        ok: false,
        reason: 'unknown',
        message: 'Não foi possível ativar as notificações agora. Tente novamente em instantes.',
      };
    }
    }).finally(intent.finish);
  }, [captureIntent, organizationId, queryClient, saveSubscription, user?.id]);

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
        };
      }

      const permission = Notification.permission;
      let existingSubscription: PushSubscription | null = null;
      try {
        const registration = await getServiceWorkerRegistration();
        intent.assertCurrent();
        existingSubscription = await registration.pushManager.getSubscription();
        intent.assertCurrent();
      } catch (error) {
        if (!intent.isCurrent()) throw error;
        // Configuration loading below provides the actionable setup error.
      }
      let syncError: string | null = null;
      let vapidPublicKey: string;
      try {
        vapidPublicKey = await loadVapidPublicKey();
        intent.assertCurrent();
      } catch (error) {
        if (!intent.isCurrent()) throw error;
        syncError = error instanceof Error
          ? error.message
          : 'Notificacoes push nao estao configuradas neste ambiente.';
        return {
          isSupported: true,
          isSubscribed: !!existingSubscription,
          isOptedOut: optedOut,
          isLoading: false,
          isReady: true,
          configurationStatus: 'unavailable',
          permission,
          error: syncError,
          endpoint: existingSubscription?.endpoint || null,
        };
      }
      let subscription = await checkSubscription(vapidPublicKey, intent);
      intent.assertCurrent();

      if (optedOut) {
        if (subscription) {
          try {
            await removeSubscription(subscription.endpoint, intent);
            const removedFromBrowser = await subscription.unsubscribe();
            intent.assertCurrent();
            if (!removedFromBrowser) {
              throw new Error('O navegador não removeu a inscrição local.');
            }
            subscription = null;
          } catch (error) {
            if (!intent.isCurrent()) throw error;
            syncError = error instanceof Error
              ? error.message
              : 'Não foi possível concluir a desativação neste navegador.';
          }
        }
      } else if (subscription && organizationId) {
        try {
          const syncResult = await saveSubscription(subscription, vapidPublicKey, { syncOnly: true }, intent);
          if (syncResult?.requiresResubscribe) {
            console.log('[WebPush] Servidor rejeitou subscription antiga; reinscrevendo dispositivo.');
            clearRotatedWebPushState();
            await subscription.unsubscribe().catch(() => undefined);
            intent.assertCurrent();
            const registration = await getReadyServiceWorkerRegistration();
            intent.assertCurrent();
            subscription = await createOrReusePushSubscription(registration, vapidPublicKey, intent);
            await saveSubscription(subscription, vapidPublicKey, {}, intent);
          }
        } catch (error) {
          if (!intent.isCurrent()) throw error;
          syncError = error instanceof Error
            ? error.message
            : 'Não foi possível sincronizar a subscription no servidor.';
        }
      }

      return {
        isSupported: true,
        isSubscribed: !!subscription,
        isOptedOut: optedOut,
        isLoading: false,
        isReady: true,
        configurationStatus: 'available',
        permission,
        error: syncError,
        endpoint: subscription?.endpoint || null,
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
      intent.cancel();
    };
  }, [
    user?.id,
    captureIntent,
    organizationId,
    checkSupport,
    checkSubscription,
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
