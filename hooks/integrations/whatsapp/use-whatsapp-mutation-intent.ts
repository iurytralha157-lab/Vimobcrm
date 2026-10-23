import { useCallback, useLayoutEffect, useRef } from "react";
import {
  useMutation,
  type MutateOptions,
  type UseMutationResult,
  type UseMutateFunction,
  type UseMutateAsyncFunction,
} from "@tanstack/react-query";

import { useAuth } from "@/contexts/AuthContext";
import { useWhatsAppQueryScope } from "@/hooks/use-whatsapp-query-scope";
import type { WhatsAppRequestIntent } from "@/lib/api/whatsapp";
import { VimobAPIError } from "@/lib/api/vimob-error";
import type { WhatsAppQueryScope } from "@/lib/whatsapp-query-cache";
import { abortWhatsAppRequestIntents, runWhatsAppRequestIntent } from "@/lib/whatsapp-request-intent";

export type CapturedWhatsAppMutationIntent = WhatsAppRequestIntent & {
  scope: WhatsAppQueryScope;
  assertCurrent: () => void;
  isCurrent: () => boolean;
  release: () => void;
  run: <T>(request: (intent: CapturedWhatsAppMutationIntent) => Promise<T>) => Promise<T>;
};

const contextChanged = () => new VimobAPIError("O contexto do WhatsApp mudou. Inicie a ação novamente.", {
  code: "whatsapp_send_context_changed",
  status: 409,
});

/** Capture at the gesture, not after React Query's asynchronous onMutate. */
export function useWhatsAppMutationIntent() {
  const scope = useWhatsAppQueryScope();
  const { profile } = useAuth();
  const { organizationId, userId, accessScope } = scope;
  const fingerprint = JSON.stringify([organizationId, userId, accessScope, profile?.organization_id ?? null]);
  const identity = useRef({ fingerprint, generation: 0, mounted: false });
  const pending = useRef(new Set<AbortController>());

  useLayoutEffect(() => {
    const currentIdentity = identity.current;
    const controllers = pending.current;
    currentIdentity.mounted = true;
    return () => {
      currentIdentity.mounted = false;
      currentIdentity.generation += 1;
      abortWhatsAppRequestIntents(controllers);
    };
  }, []);
  useLayoutEffect(() => {
    if (identity.current.fingerprint !== fingerprint) {
      identity.current.generation += 1;
      abortWhatsAppRequestIntents(pending.current);
    }
    identity.current.fingerprint = fingerprint;
  }, [fingerprint]);

  const capture = useCallback((): CapturedWhatsAppMutationIntent => {
    const generation = identity.current.generation;
    const controller = new AbortController();
    let started = false;
    const isCurrent = () => identity.current.mounted
      && identity.current.generation === generation
      && identity.current.fingerprint === fingerprint
      && !controller.signal.aborted;
    const assertCurrent = () => {
      if (!isCurrent()) throw started
        ? controller.signal.reason ?? new DOMException("A confirmação da ação foi interrompida.", "AbortError")
        : contextChanged();
    };
    // Once HTTP begins, abort cannot prove that a server effect did not happen.
    pending.current.add(controller);
    const intent: CapturedWhatsAppMutationIntent = {
      scope: { organizationId, userId, accessScope },
      expectedUserId: userId,
      signal: controller.signal,
      assertCurrent,
      isCurrent,
      release: () => pending.current.delete(controller),
      onRequestStart: () => {
        assertCurrent();
        started = true;
      },
      run: (request) => runWhatsAppRequestIntent(intent.scope, pending.current, (transport) => request({
        ...intent,
        ...transport,
        onRequestStart: () => {
          intent.onRequestStart?.();
          transport.onRequestStart?.();
        },
      })),
    };
    if (!organizationId || !userId || !isCurrent()) controller.abort(contextChanged());
    return intent;
  }, [accessScope, fingerprint, organizationId, userId]);
  return { capture };
}

type IntentMutationOptions<TData, TVariables, TContext> = {
  mutationFn: (variables: TVariables, intent: CapturedWhatsAppMutationIntent) => Promise<TData>;
  onMutate?: (variables: TVariables, intent: CapturedWhatsAppMutationIntent) => TContext | Promise<TContext>;
  onSuccess?: (data: TData, variables: TVariables, context: TContext | undefined, intent: CapturedWhatsAppMutationIntent) => unknown;
  onError?: (error: Error, variables: TVariables, context: TContext | undefined, intent: CapturedWhatsAppMutationIntent) => unknown;
  onSettled?: (data: TData | undefined, error: Error | null, variables: TVariables, context: TContext | undefined, intent: CapturedWhatsAppMutationIntent) => unknown;
};
type Invocation<TData, TVariables, TContext> = {
  variables: TVariables;
  intent: CapturedWhatsAppMutationIntent;
  options: IntentMutationOptions<TData, TVariables, TContext>;
};
type IntentMutationResult<TData, TVariables, TContext> = Omit<
  UseMutationResult<TData, Error, Invocation<TData, TVariables, TContext>, TContext>,
  "mutate" | "mutateAsync" | "variables"
> & {
  mutate: UseMutateFunction<TData, Error, TVariables, TContext>;
  mutateAsync: UseMutateAsyncFunction<TData, Error, TVariables, TContext>;
  variables: TVariables | undefined;
};

/** Keep API, optimistic writes and callbacks on the exact original invocation. */
export function useWhatsAppIntentMutation<TData, TVariables, TContext = unknown>(
  options: IntentMutationOptions<TData, TVariables, TContext>,
): IntentMutationResult<TData, TVariables, TContext> {
  const { capture } = useWhatsAppMutationIntent();
  const optionsRef = useRef(options);
  useLayoutEffect(() => { optionsRef.current = options; }, [options]);
  const mutation = useMutation<TData, Error, Invocation<TData, TVariables, TContext>, TContext>({
    mutationFn: async ({ variables, intent, options: original }) => {
      intent.assertCurrent();
      const result = await intent.run((transport) => original.mutationFn(variables, transport));
      intent.assertCurrent();
      return result;
    },
    onMutate: async ({ variables, intent, options: original }) => {
      intent.assertCurrent();
      const context = original.onMutate ? await original.onMutate(variables, intent) : undefined;
      intent.assertCurrent();
      return context as TContext;
    },
    onSuccess: (data, { variables, intent, options: original }, context) => {
      if (intent.isCurrent()) return original.onSuccess?.(data, variables, context, intent);
    },
    onError: (error, { variables, intent, options: original }, context) => {
      if (intent.isCurrent()) return original.onError?.(error, variables, context, intent);
    },
    onSettled: async (data, error, { variables, intent, options: original }, context) => {
      try {
        if (intent.isCurrent()) await original.onSettled?.(data, error, variables, context, intent);
      } finally {
        intent.release();
      }
    },
  });
  const callbacks = useCallback((intent: CapturedWhatsAppMutationIntent, options?: MutateOptions<TData, Error, TVariables, TContext>): MutateOptions<TData, Error, Invocation<TData, TVariables, TContext>, TContext> => ({
    onSuccess: (data, invocation, context, mutationContext) => {
      if (intent.isCurrent()) options?.onSuccess?.(data, invocation.variables, context, mutationContext);
    },
    onError: (error, invocation, context, mutationContext) => {
      if (intent.isCurrent()) options?.onError?.(error, invocation.variables, context, mutationContext);
    },
    onSettled: (data, error, invocation, context, mutationContext) => {
      if (intent.isCurrent()) options?.onSettled?.(data, error, invocation.variables, context, mutationContext);
    },
  }), []);
  const { mutate: runMutation, mutateAsync: runMutationAsync } = mutation;
  const mutate = useCallback<UseMutateFunction<TData, Error, TVariables, TContext>>((variables, callbackOptions) => {
    const intent = capture();
    runMutation({ variables, intent, options: optionsRef.current }, callbacks(intent, callbackOptions));
  }, [callbacks, capture, runMutation]);
  const mutateAsync = useCallback<UseMutateAsyncFunction<TData, Error, TVariables, TContext>>((variables, callbackOptions) => {
    const intent = capture();
    return runMutationAsync({ variables, intent, options: optionsRef.current }, callbacks(intent, callbackOptions));
  }, [callbacks, capture, runMutationAsync]);
  return {
    ...mutation,
    variables: mutation.variables?.variables,
    mutate,
    mutateAsync,
  };
}
