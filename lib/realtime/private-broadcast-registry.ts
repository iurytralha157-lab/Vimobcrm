export type PrivateBroadcastStatus =
  | "SUBSCRIBED"
  | "CHANNEL_ERROR"
  | "TIMED_OUT"
  | "CLOSED";

export type PrivateBroadcastDiagnosticKind =
  | "auth_error"
  | "channel_error"
  | "timed_out"
  | "unexpected_closed"
  | "open_error"
  | "remove_error"
  | "listener_error";

export type PrivateBroadcastDiagnostic = {
  kind: PrivateBroadcastDiagnosticKind;
  topic: string;
  event: string;
  status?: PrivateBroadcastStatus;
  error?: unknown;
};

export type PrivateBroadcastPhysicalChannel = {
  close: () => Promise<void>;
};

export type PrivateBroadcastTransport = {
  setAuth: () => Promise<void>;
  open: (input: {
    topic: string;
    event: string;
    onPayload: (payload: unknown) => void;
    onStatus: (status: PrivateBroadcastStatus, error?: Error) => void;
  }) => PrivateBroadcastPhysicalChannel;
};

export type PrivateBroadcastLease = {
  release: () => void;
};

export type PrivateBroadcastSubscription = {
  topic: string;
  event: string;
  onPayload: (payload: unknown) => void;
  onStatus?: (status: PrivateBroadcastStatus, error?: Error) => void;
};

type LogicalSubscriber = {
  onPayload: (payload: unknown) => void;
  onStatus?: (status: PrivateBroadcastStatus, error?: Error) => void;
};

type RegistryEntry = {
  topic: string;
  event: string;
  subscribers: Map<symbol, LogicalSubscriber>;
  channel: PrivateBroadcastPhysicalChannel | null;
  starting: boolean;
  expectedClose: boolean;
  closeTimer: ReturnType<typeof setTimeout> | null;
  retryTimer: ReturnType<typeof setTimeout> | null;
};

export type PrivateBroadcastRegistryOptions = {
  closeGraceMs?: number;
  retryDelayMs?: number;
  onDiagnostic?: (diagnostic: PrivateBroadcastDiagnostic) => void;
};

const DEFAULT_CLOSE_GRACE_MS = 200;
const DEFAULT_RETRY_DELAY_MS = 1_000;

/**
 * Owns physical private Broadcast channels and fans them out to logical users.
 *
 * Supabase returns the same channel object for duplicate topics. Ref-counting
 * here prevents one component cleanup from tearing down another component's
 * live subscription.
 */
export class PrivateBroadcastRegistry {
  private readonly entries = new Map<string, RegistryEntry>();
  private readonly closingByTopic = new Map<string, Promise<void>>();
  private readonly closeGraceMs: number;
  private readonly retryDelayMs: number;
  private authReady = false;
  private authPromise: Promise<void> | null = null;
  private onDiagnostic?: (diagnostic: PrivateBroadcastDiagnostic) => void;

  constructor(
    private readonly transport: PrivateBroadcastTransport,
    options: PrivateBroadcastRegistryOptions = {},
  ) {
    this.closeGraceMs = Math.max(0, options.closeGraceMs ?? DEFAULT_CLOSE_GRACE_MS);
    this.retryDelayMs = Math.max(0, options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS);
    this.onDiagnostic = options.onDiagnostic;
  }

  setDiagnosticReporter(reporter?: (diagnostic: PrivateBroadcastDiagnostic) => void) {
    this.onDiagnostic = reporter;
  }

  acquire(subscription: PrivateBroadcastSubscription): PrivateBroadcastLease {
    const topic = subscription.topic.trim();
    const event = subscription.event.trim();
    if (!topic || !event) {
      throw new Error("Private Broadcast topic and event are required");
    }

    let entry = this.entries.get(topic);
    if (entry && entry.event !== event) {
      throw new Error(`Private Broadcast topic "${topic}" is already bound to "${entry.event}"`);
    }

    if (!entry) {
      entry = {
        topic,
        event,
        subscribers: new Map(),
        channel: null,
        starting: false,
        expectedClose: false,
        closeTimer: null,
        retryTimer: null,
      };
      this.entries.set(topic, entry);
    } else if (entry.closeTimer) {
      clearTimeout(entry.closeTimer);
      entry.closeTimer = null;
    }

    const leaseId = Symbol(topic);
    entry.subscribers.set(leaseId, {
      onPayload: subscription.onPayload,
      onStatus: subscription.onStatus,
    });
    this.start(entry);

    let released = false;
    return {
      release: () => {
        if (released) return;
        released = true;
        this.release(topic, leaseId);
      },
    };
  }

  private release(topic: string, leaseId: symbol) {
    const entry = this.entries.get(topic);
    if (!entry) return;

    entry.subscribers.delete(leaseId);
    if (entry.subscribers.size > 0 || entry.closeTimer) return;

    entry.closeTimer = setTimeout(() => {
      entry.closeTimer = null;
      if (entry.subscribers.size === 0 && this.entries.get(topic) === entry) {
        this.close(entry);
      }
    }, this.closeGraceMs);
  }

  private start(entry: RegistryEntry) {
    if (
      entry.starting ||
      entry.channel ||
      entry.subscribers.size === 0 ||
      this.entries.get(entry.topic) !== entry
    ) {
      return;
    }

    entry.starting = true;
    void this.startAsync(entry);
  }

  private async startAsync(entry: RegistryEntry) {
    try {
      const closing = this.closingByTopic.get(entry.topic);
      if (closing) await closing;
      if (!this.isActive(entry)) return;

      try {
        await this.ensureAuth();
      } catch (error) {
        this.report({
          kind: "auth_error",
          topic: entry.topic,
          event: entry.event,
          error,
        });
        this.scheduleRetry(entry);
        return;
      }

      if (!this.isActive(entry)) return;

      try {
        entry.channel = this.transport.open({
          topic: entry.topic,
          event: entry.event,
          onPayload: (payload) => {
            if (!this.isActive(entry)) return;
            for (const subscriber of entry.subscribers.values()) {
              try {
                subscriber.onPayload(payload);
              } catch (error) {
                this.report({
                  kind: "listener_error",
                  topic: entry.topic,
                  event: entry.event,
                  error,
                });
              }
            }
          },
          onStatus: (status, error) => this.handleStatus(entry, status, error),
        });
      } catch (error) {
        this.report({
          kind: "open_error",
          topic: entry.topic,
          event: entry.event,
          error,
        });
        this.scheduleRetry(entry);
      }
    } finally {
      entry.starting = false;
    }
  }

  private isActive(entry: RegistryEntry) {
    return (
      this.entries.get(entry.topic) === entry &&
      !entry.expectedClose &&
      entry.subscribers.size > 0
    );
  }

  private async ensureAuth() {
    if (this.authReady) return;
    if (!this.authPromise) {
      this.authPromise = this.transport
        .setAuth()
        .then(() => {
          this.authReady = true;
        })
        .finally(() => {
          this.authPromise = null;
        });
    }
    await this.authPromise;
  }

  private handleStatus(
    entry: RegistryEntry,
    status: PrivateBroadcastStatus,
    error?: Error,
  ) {
    if (!this.isActive(entry)) return;

    for (const subscriber of entry.subscribers.values()) {
      try {
        subscriber.onStatus?.(status, error);
      } catch (listenerError) {
        this.report({
          kind: "listener_error",
          topic: entry.topic,
          event: entry.event,
          status,
          error: listenerError,
        });
      }
    }

    if (status === "CHANNEL_ERROR") {
      this.report({
        kind: "channel_error",
        topic: entry.topic,
        event: entry.event,
        status,
        error,
      });
      // realtime-js owns its exponential rejoin loop after CHANNEL_ERROR.
      // Keeping the physical channel registered lets its next SUBSCRIBED
      // status recover every logical listener without duplicate sockets.
      return;
    }

    if (status === "TIMED_OUT") {
      this.report({
        kind: "timed_out",
        topic: entry.topic,
        event: entry.event,
        status,
        error,
      });
      // A join timeout follows the same realtime-js rejoin path. If the
      // channel becomes terminal instead, CLOSED below creates a fresh one.
      return;
    }

    if (status === "CLOSED") {
      entry.channel = null;
      this.report({
        kind: "unexpected_closed",
        topic: entry.topic,
        event: entry.event,
        status,
        error,
      });
      this.scheduleRetry(entry);
    }
  }

  private scheduleRetry(entry: RegistryEntry) {
    if (!this.isActive(entry) || entry.retryTimer) return;
    entry.retryTimer = setTimeout(() => {
      entry.retryTimer = null;
      this.start(entry);
    }, this.retryDelayMs);
  }

  private close(entry: RegistryEntry) {
    if (this.entries.get(entry.topic) !== entry) return;
    this.entries.delete(entry.topic);
    entry.expectedClose = true;
    if (entry.retryTimer) clearTimeout(entry.retryTimer);
    entry.retryTimer = null;

    const channel = entry.channel;
    entry.channel = null;
    const closing = channel
      ? channel.close().catch((error) => {
          this.report({
            kind: "remove_error",
            topic: entry.topic,
            event: entry.event,
            error,
          });
        })
      : Promise.resolve();

    this.closingByTopic.set(entry.topic, closing);
    void closing.finally(() => {
      if (this.closingByTopic.get(entry.topic) === closing) {
        this.closingByTopic.delete(entry.topic);
      }
    });
  }

  private report(diagnostic: PrivateBroadcastDiagnostic) {
    try {
      this.onDiagnostic?.(diagnostic);
    } catch {
      // Diagnostics must never alter channel ownership or payload fan-out.
    }
  }
}
