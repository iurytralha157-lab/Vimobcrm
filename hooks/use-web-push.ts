import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { settingsAPI } from '@/lib/api/settings';

// VAPID public key - must match the backend Web Push sender configuration.
const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim() || '';

const VAPID_STORAGE_KEY = 'vimob-web-push-vapid-key';
export const WEB_PUSH_PROMPT_DISMISS_KEY = 'web-push-prompt-dismissed';


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
  return localStorage.getItem(VAPID_STORAGE_KEY);
}

function storeCurrentVapidKey(currentKey: string | null) {
  if (typeof window === 'undefined' || !currentKey) return;
  localStorage.setItem(VAPID_STORAGE_KEY, currentKey);
}

function clearRotatedWebPushState() {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(VAPID_STORAGE_KEY);
  localStorage.removeItem(WEB_PUSH_PROMPT_DISMISS_KEY);
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
  if (existing) {
    return existing;
  }
  return navigator.serviceWorker.register('/sw.js', { scope: '/' });
}

async function getReadyServiceWorkerRegistration() {
  await getServiceWorkerRegistration();
  return navigator.serviceWorker.ready;
}

async function createOrReusePushSubscription(registration: ServiceWorkerRegistration) {
  const applicationServerKey = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);
  const currentKey = arrayBufferToBase64Url(applicationServerKey);
  const existingSubscription = await registration.pushManager.getSubscription();

  if (existingSubscription) {
    const shouldReplace = shouldReplaceSubscription(existingSubscription, currentKey);
    if (!shouldReplace) {
      storeCurrentVapidKey(currentKey);
      return existingSubscription;
    }

    clearRotatedWebPushState();
    await existingSubscription.unsubscribe();
  }

  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey,
  });
  storeCurrentVapidKey(currentKey);
  return subscription;
}

interface WebPushState {
  isSupported: boolean;
  isSubscribed: boolean;
  isLoading: boolean;
  permission: NotificationPermission | null;
  error: string | null;
}

export type WebPushSubscribeResult =
  | { ok: true }
  | {
      ok: false;
      reason: 'configuration' | 'permission_denied' | 'service_worker' | 'browser_push' | 'save_failed' | 'unknown';
      message: string;
    };

export function useWebPush() {
  const { user, profile } = useAuth();
  const [state, setState] = useState<WebPushState>({
    isSupported: false,
    isSubscribed: false,
    isLoading: true,
    permission: null,
    error: null,
  });

  // Verifica suporte a Web Push
  const checkSupport = useCallback(() => {
    const isSupported =
      'serviceWorker' in navigator &&
      'PushManager' in window &&
      'Notification' in window &&
      !!VAPID_PUBLIC_KEY;

    return isSupported;
  }, []);

  // Verifica se já está inscrito
  const checkSubscription = useCallback(async (): Promise<PushSubscription | null> => {
    try {
      if (!VAPID_PUBLIC_KEY) return null;
      await getServiceWorkerRegistration();
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();

      if (subscription) {
        const currentKey = arrayBufferToBase64Url(urlBase64ToUint8Array(VAPID_PUBLIC_KEY));

        if (shouldReplaceSubscription(subscription, currentKey)) {
          console.log('[WebPush] Subscription usa VAPID antigo/desconhecido; removendo para reinscrever.');
          clearRotatedWebPushState();
          await subscription.unsubscribe();
          return null;
        }
        storeCurrentVapidKey(currentKey);
      }

      return subscription;
    } catch (error) {
      console.error('[WebPush] Erro ao verificar subscription:', error);
      return null;
    }
  }, []);

  // Salva subscription no Supabase
  const saveSubscription = useCallback(async (subscription: PushSubscription) => {
    if (!user?.id || !profile?.organization_id) return;

    try {
      const subscriptionJson = subscription.toJSON() as {
        endpoint?: string;
        keys?: { p256dh?: string; auth?: string };
      };
      if (!subscriptionJson.endpoint) {
        throw new Error('Subscription sem endpoint');
      }
      await settingsAPI.savePushToken({
        endpoint: subscriptionJson.endpoint,
        p256dh: subscriptionJson.keys?.p256dh ?? null,
        auth: subscriptionJson.keys?.auth ?? null,
        userAgent: navigator.userAgent,
      }, profile.organization_id);
      console.log('[WebPush] Subscription salva');
    } catch (error) {
      console.error('[WebPush] Erro ao salvar subscription:', error);
      throw error;
    }
  }, [user?.id, profile?.organization_id]);

  // Remove subscription do Supabase
  const removeSubscription = useCallback(async (endpoint?: string | null) => {
    if (!user?.id) return;

    try {
      await settingsAPI.deactivatePushToken(endpoint);

      console.log('[WebPush] Subscription desativada');
    } catch (error) {
      console.error('[WebPush] Erro ao remover subscription:', error);
    }
  }, [user?.id]);

  // Solicita permissão e cria subscription
  const subscribe = useCallback(async (): Promise<WebPushSubscribeResult> => {
    console.log('[WebPush] Iniciando subscription...');
    console.log('[WebPush] VAPID key configurada:', VAPID_PUBLIC_KEY ? `${VAPID_PUBLIC_KEY.length} chars` : 'NÃO CONFIGURADA');

    setState(prev => ({ ...prev, isLoading: true, error: null }));

    try {
      if (!VAPID_PUBLIC_KEY) {
        const errorMessage = 'Notificações push não estão configuradas neste ambiente.';
        setState(prev => ({
          ...prev,
          isLoading: false,
          error: errorMessage,
        }));
        return {
          ok: false,
          reason: 'configuration',
          message: errorMessage,
        };
      }

      // Solicita permissão
      console.log('[WebPush] Solicitando permissão...');
      const permission = await Notification.requestPermission();
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
      } catch (error) {
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
        subscription = await createOrReusePushSubscription(registration);
      } catch (error) {
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

      // Salva no banco
      console.log('[WebPush] Salvando subscription no banco...');
      try {
        await saveSubscription(subscription);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Erro ao salvar subscription';
        console.error('[WebPush] Erro ao salvar subscription no servidor:', error);
        await subscription.unsubscribe().catch(() => undefined);
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

      setState(prev => ({
        ...prev,
        isSubscribed: true,
        isLoading: false,
        error: null
      }));

      return { ok: true };
    } catch (error) {
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
  }, [saveSubscription]);

  // Cancela subscription
  const unsubscribe = useCallback(async (): Promise<boolean> => {
    setState(prev => ({ ...prev, isLoading: true }));

    try {
      const subscription = await checkSubscription();
      const endpoint = subscription?.endpoint;

      if (subscription) {
        await subscription.unsubscribe();
      }

      await removeSubscription(endpoint);

      setState(prev => ({
        ...prev,
        isSubscribed: false,
        isLoading: false
      }));

      return true;
    } catch (error) {
      console.error('[WebPush] Erro ao desinscrever:', error);
      setState(prev => ({
        ...prev,
        isLoading: false,
        error: error instanceof Error ? error.message : 'Erro ao desativar notificações'
      }));
      return false;
    }
  }, [checkSubscription, removeSubscription]);

  // Inicialização
  useEffect(() => {
    const init = async () => {
      const isSupported = checkSupport();

      if (!isSupported) {
        setState(prev => ({
          ...prev,
          isSupported: false,
          isLoading: false
        }));
        return;
      }

      const permission = Notification.permission;
      let subscription = await checkSubscription();
      let syncError: string | null = null;

      if (!subscription && permission === 'granted' && profile?.organization_id) {
        try {
          const registration = await getReadyServiceWorkerRegistration();
          subscription = await createOrReusePushSubscription(registration);
          await saveSubscription(subscription);
        } catch (error) {
          syncError = error instanceof Error
            ? error.message
            : 'Não foi possível reinscrever este dispositivo para notificações.';
        }
      } else if (subscription && profile?.organization_id) {
        try {
          await saveSubscription(subscription);
        } catch (error) {
          syncError = error instanceof Error
            ? error.message
            : 'Não foi possível sincronizar a subscription no servidor.';
        }
      }

      setState({
        isSupported: true,
        isSubscribed: !!subscription && !syncError,
        isLoading: false,
        permission,
        error: syncError,
      });
    };

    if (user?.id) {
      init();
    }
  }, [user?.id, profile?.organization_id, checkSupport, checkSubscription, saveSubscription]);

  return {
    ...state,
    subscribe,
    unsubscribe,
  };
}
