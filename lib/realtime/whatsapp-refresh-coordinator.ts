export type WhatsAppRealtimeRefreshRequest<TScope> = {
  scopeKey: string;
  scope: TScope;
  refreshConversations?: boolean;
  refreshMessages?: boolean;
  refreshLeadMessages?: boolean;
  allMessages?: boolean;
  allLeadMessages?: boolean;
  conversationIds?: readonly string[];
  leadIds?: readonly string[];
};

// A newly joined private channel can briefly precede the Realtime replication
// slot. Recheck the canonical API for one minute so an early missed hint does
// not leave the open inbox waiting for its regular 90 s / 5 min fallback.
export const WHATSAPP_INBOX_CATCH_UP_DELAYS_MS = [0, 1_000, 10_000, 20_000, 30_000, 40_000, 50_000, 60_000] as const;
const WHATSAPP_INBOX_BASELINE_DELAYS_MS = [0, 1_000] as const;

type CatchUpTimer = ReturnType<typeof setTimeout>;

export function createWhatsAppInboxSubscriptionCatchUp(
  refresh: () => void,
  timers: {
    set: (callback: () => void, delayMs: number) => CatchUpTimer;
    clear: (timer: CatchUpTimer) => void;
  } = {
    // Browser timer methods require Window as their receiver. Wrapping the
    // calls avoids invoking a detached native method through this object.
    set: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
    clear: (timer) => globalThis.clearTimeout(timer),
  },
) {
  let pending: CatchUpTimer[] = [];
  let disposed = false;

  const stop = () => {
    pending.forEach((timer) => timers.clear(timer));
    pending = [];
  };

  return {
    start(activeInbox = false) {
      if (disposed) return;
      stop();
      const delays = activeInbox
        ? WHATSAPP_INBOX_CATCH_UP_DELAYS_MS
        : WHATSAPP_INBOX_BASELINE_DELAYS_MS;
      // Schedule independently before the first read. A transient failed read
      // cannot cancel the later reconciliation attempts.
      pending = delays.slice(1).map((delayMs) =>
        timers.set(refresh, delayMs),
      );
      refresh();
    },
    hint() {
      // A valid broadcast is only a wake-up, not proof the following GET
      // succeeded. Keep the bounded catch-up sequence for transient failures.
      if (!disposed) refresh();
    },
    dispose() {
      disposed = true;
      stop();
    },
  };
}

export type WhatsAppRealtimeRefreshBatch<TScope> = {
  scopeKey: string;
  scope: TScope;
  refreshConversations: boolean;
  refreshMessages: boolean;
  refreshLeadMessages: boolean;
  allMessages: boolean;
  allLeadMessages: boolean;
  conversationIds: readonly string[];
  leadIds: readonly string[];
};

type PendingWhatsAppRealtimeRefresh<TScope> = Omit<
  WhatsAppRealtimeRefreshBatch<TScope>,
  "conversationIds" | "leadIds"
> & {
  conversationIds: Set<string>;
  leadIds: Set<string>;
};

/**
 * Coalesces equivalent wake-up hints from the backend stream and Supabase
 * Broadcast. The data remains canonical in React Query/API; this only avoids
 * restarting the same active HTTP reads when multiple transports report the
 * same change close together.
 */
export class WhatsAppRealtimeRefreshCoordinator<TScope> {
  private readonly pending = new Map<string, PendingWhatsAppRealtimeRefresh<TScope>>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly onFlush: (batch: WhatsAppRealtimeRefreshBatch<TScope>) => void;
  private readonly delayMs: number;

  constructor(
    onFlush: (batch: WhatsAppRealtimeRefreshBatch<TScope>) => void,
    delayMs = 75,
  ) {
    this.onFlush = onFlush;
    this.delayMs = delayMs;
  }

  schedule(request: WhatsAppRealtimeRefreshRequest<TScope>) {
    const current = this.pending.get(request.scopeKey) ?? {
      scopeKey: request.scopeKey,
      scope: request.scope,
      refreshConversations: false,
      refreshMessages: false,
      refreshLeadMessages: false,
      allMessages: false,
      allLeadMessages: false,
      conversationIds: new Set<string>(),
      leadIds: new Set<string>(),
    };

    current.scope = request.scope;
    current.refreshConversations ||= request.refreshConversations === true;
    current.refreshMessages ||= request.refreshMessages === true;
    current.refreshLeadMessages ||= request.refreshLeadMessages === true;
    current.allMessages ||= request.allMessages === true;
    current.allLeadMessages ||= request.allLeadMessages === true;
    request.conversationIds?.filter(Boolean).forEach((id) => current.conversationIds.add(id));
    request.leadIds?.filter(Boolean).forEach((id) => current.leadIds.add(id));
    this.pending.set(request.scopeKey, current);

    if (this.timers.has(request.scopeKey)) return;
    const timer = setTimeout(() => this.flush(request.scopeKey), Math.max(0, this.delayMs));
    this.timers.set(request.scopeKey, timer);
  }

  flush(scopeKey: string) {
    const timer = this.timers.get(scopeKey);
    if (timer) clearTimeout(timer);
    this.timers.delete(scopeKey);

    const batch = this.pending.get(scopeKey);
    if (!batch) return false;
    this.pending.delete(scopeKey);

    this.onFlush({
      ...batch,
      conversationIds: [...batch.conversationIds],
      leadIds: [...batch.leadIds],
    });
    return true;
  }

  clear(scopeKey?: string) {
    if (scopeKey) {
      const timer = this.timers.get(scopeKey);
      if (timer) clearTimeout(timer);
      this.timers.delete(scopeKey);
      this.pending.delete(scopeKey);
      return;
    }

    this.timers.forEach((timer) => clearTimeout(timer));
    this.timers.clear();
    this.pending.clear();
  }
}
