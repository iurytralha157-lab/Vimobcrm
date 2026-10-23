export type FilterPanelCloseReason = 'explicit' | 'outside' | 'chat';
export type FilterPanelRegistrationState = {
  active: boolean;
  present: boolean;
  mobile: boolean;
  panelElement: HTMLElement | null;
  dockElement: HTMLElement | null;
  tryClose: (reason: FilterPanelCloseReason) => boolean;
};
export type FilterPanelLayoutSnapshot = Omit<FilterPanelRegistrationState, 'tryClose'> & {
  panelId: string | null;
  panelWidth: number;
};
export type FilterPanelRegistration = {
  update: (state: FilterPanelRegistrationState) => void;
  unregister: () => void;
};
export const EMPTY_FILTER_PANEL_LAYOUT: FilterPanelLayoutSnapshot = {
  active: false, present: false, mobile: false, panelElement: null,
  dockElement: null, panelId: null, panelWidth: 0,
};

type PanelRecord = { id: string; state: FilterPanelRegistrationState };
type PendingChat = { token: symbol; callback: () => void; accepted: boolean; cancel?: () => void };
type AfterExit = (callback: () => void) => () => void;

/** Presentation only: a validated panel close precedes the existing chat action. */
export class FilterPanelLayoutCoordinator {
  private records = new Map<symbol, PanelRecord>();
  private listeners = new Set<() => void>();
  private snapshot = EMPTY_FILTER_PANEL_LAYOUT;
  private pending: PendingChat | null = null;
  private afterExit: AfterExit;

  constructor(afterExit: AfterExit) { this.afterExit = afterExit; }

  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };

  registerPanel = (id: string): FilterPanelRegistration => {
    const token = Symbol(id);
    this.records.set(token, { id, state: {
      active: false, present: false, mobile: false, panelElement: null, dockElement: null, tryClose: () => false,
    } });
    return {
      update: (state) => {
        const previous = this.records.get(token);
        if (!previous) return;
        if (this.pending && ((this.pending.token === token && previous && !previous.state.active && state.active)
          || (this.pending.token !== token && state.active))) this.cancelPending();
        this.records.set(token, { id, state });
        this.publish();
        this.finishAfterExit();
      },
      unregister: () => {
        this.records.delete(token);
        if (this.pending?.token === token) this.cancelPending();
        this.publish();
        this.finishAfterExit();
      },
    };
  };

  requestOpenChat = (callback: () => void): boolean => {
    const selected = this.selected();
    if (!selected) { callback(); return true; }
    const [token, panel] = selected;
    if (this.pending?.token === token) return true;
    this.cancelPending();
    const request: PendingChat = { token, callback, accepted: false };
    this.pending = request;
    if (panel.state.active) {
      let accepted = false;
      try { accepted = panel.state.tryClose('chat'); } catch { /* A failed validation never opens chat. */ }
      if (!accepted) { this.cancelPending(); return false; }
    }
    request.accepted = true;
    this.finishAfterExit();
    return true;
  };

  refreshGeometry = () => this.publish();
  reset = () => {
    this.cancelPending();
    this.records.clear();
    this.publish();
  };

  private selected() {
    const entries = [...this.records.entries()];
    return entries.reverse().find(([, record]) => record.state.active)
      ?? entries.find(([, record]) => record.state.present);
  }

  private publish() {
    const record = this.selected()?.[1];
    const next: FilterPanelLayoutSnapshot = record ? {
      panelId: record.id, active: record.state.active, present: record.state.present,
      mobile: record.state.mobile, panelElement: record.state.panelElement,
      dockElement: record.state.dockElement,
      panelWidth: record.state.panelElement?.getBoundingClientRect().width ?? 0,
    } : EMPTY_FILTER_PANEL_LAYOUT;
    if ((Object.keys(next) as (keyof FilterPanelLayoutSnapshot)[]).every(key => this.snapshot[key] === next[key])) return;
    this.snapshot = next;
    this.listeners.forEach(listener => listener());
  }

  private cancelPending() {
    this.pending?.cancel?.();
    this.pending = null;
  }

  private finishAfterExit() {
    const request = this.pending;
    if (!request?.accepted || request.cancel) return;
    const record = this.records.get(request.token);
    if (!record || record.state.active || record.state.present || this.selected()) return;
    request.cancel = this.afterExit(() => {
      if (this.pending !== request || this.selected()) return;
      this.pending = null;
      request.callback();
    });
  }
}
