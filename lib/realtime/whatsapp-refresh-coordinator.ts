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
