import { Component, createRef, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

interface Props {
  children: ReactNode;
  wrapperRef: RefObject<HTMLDivElement | null>;
  side: "left" | "right";
  active: boolean;
  present: boolean;
  mobile: boolean;
  panelElement: HTMLElement | null;
  dockElement: HTMLElement | null;
  hidden: boolean;
}
type Box = { left: number; top: number; width: number; height: number };
type Snapshot = { box: Box; focused: boolean } | null;

/** A stable portal host keeps one launcher DOM; snapshots bridge layout changes. */
export class FloatingLauncherPlacement extends Component<Props, { host: HTMLDivElement | null }, Snapshot> {
  state = { host: null as HTMLDivElement | null };
  private home = createRef<HTMLDivElement>();
  private motion: Animation | null = null;
  private reducedMotion: MediaQueryList | null = null;
  private epoch = 0;
  private mounted = false;
  private lastBox: Box | null = null;
  private waitingForDock = false;

  componentDidMount() {
    this.mounted = true;
    const host = document.createElement("div");
    host.dataset.floatingChatLauncherHost = "";
    host.style.display = "contents";
    this.home.current?.appendChild(host);
    this.reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    this.reducedMotion.addEventListener("change", this.onMotionPreference);
    window.addEventListener("resize", this.onResize);
    this.setState({ host });
  }

  componentWillUnmount() {
    this.mounted = false;
    this.epoch += 1;
    this.motion?.cancel();
    this.reducedMotion?.removeEventListener("change", this.onMotionPreference);
    window.removeEventListener("resize", this.onResize);
    this.state.host?.remove();
  }

  getSnapshotBeforeUpdate(previous: Props): Snapshot {
    if (!this.placementChanged(previous)) return null;
    const element = this.props.wrapperRef.current;
    const box = element?.isConnected ? element.getBoundingClientRect() : this.lastBox;
    return box && box.width ? { box, focused: Boolean(element?.contains(document.activeElement)) } : null;
  }

  componentDidUpdate(previous: Props, previousState: { host: HTMLDivElement | null }, snapshot: Snapshot) {
    const initial = previousState.host !== this.state.host;
    const changed = initial || this.placementChanged(previous);
    if (changed) this.place(snapshot);
    else if (!this.props.present && !this.motion) this.clearTravelStyles();
  }

  private wantsDock = (props: Props) => props.active && props.mobile && Boolean(props.dockElement);
  private placementChanged = (previous: Props) => this.wantsDock(previous) !== this.wantsDock(this.props)
    || previous.side !== this.props.side || (this.wantsDock(this.props)
      && (previous.dockElement !== this.props.dockElement || previous.panelElement !== this.props.panelElement));
  private onMotionPreference = () => { if (this.reducedMotion?.matches) this.place(null); };
  private onResize = () => { if (this.waitingForDock) this.place(this.capture()); };
  private capture = (): Snapshot => {
    const element = this.props.wrapperRef.current;
    return element?.isConnected ? { box: element.getBoundingClientRect(), focused: element.contains(document.activeElement) } : null;
  };

  private clearTravelStyles() {
    const element = this.props.wrapperRef.current;
    if (!element) return;
    for (const name of ["position", "left", "right", "top", "bottom", "z-index", "pointer-events"]) element.style.removeProperty(name);
  }

  private animate(snapshot: Snapshot): Promise<unknown> {
    const element = this.props.wrapperRef.current;
    if (!element) return Promise.resolve();
    const transition = element.style.transition;
    const transform = element.style.transform;
    element.style.transition = "none";
    element.style.transform = "none";
    const target = element.getBoundingClientRect();
    element.style.transform = transform;
    element.style.transition = transition;
    this.lastBox = target;
    if (!snapshot || this.reducedMotion?.matches || (Math.abs(snapshot.box.left - target.left) < 0.5 && Math.abs(snapshot.box.top - target.top) < 0.5)) return Promise.resolve();
    const motion = element.animate([
      { transform: `translate(${snapshot.box.left - target.left}px, ${snapshot.box.top - target.top}px)` },
      { transform: "translate(0px, 0px)" },
    ], { duration: 300, easing: "ease" });
    this.motion = motion;
    void motion.finished.then(() => {
      if (!this.mounted || this.motion !== motion) return;
      this.motion = null;
      this.lastBox = element.getBoundingClientRect();
      if (!this.props.present && !this.waitingForDock) this.clearTravelStyles();
    }).catch(() => {});
    return motion.finished.catch(() => {});
  }

  private place(snapshot: Snapshot) {
    const host = this.state.host;
    const element = this.props.wrapperRef.current;
    if (!this.mounted || !host || !element || !this.home.current) return;
    const epoch = ++this.epoch;
    this.motion?.cancel();
    this.motion = null;
    if (host.parentNode !== this.home.current) this.home.current.appendChild(host);
    this.clearTravelStyles();
    this.waitingForDock = this.wantsDock(this.props);
    if (!this.waitingForDock) {
      if (this.props.present) {
        element.style.zIndex = "130";
        if (!this.props.active || this.props.mobile) element.style.pointerEvents = "none";
      }
      void this.animate(snapshot);
      this.restoreFocus(snapshot);
      return;
    }
    const dock = this.props.dockElement;
    const panel = this.props.panelElement;
    if (!dock?.isConnected || !panel) return;
    const matrix = new DOMMatrixReadOnly(getComputedStyle(panel).transform);
    const box = dock.getBoundingClientRect();
    Object.assign(element.style, {
      position: "fixed", left: `${box.left - matrix.m41}px`, top: `${box.top - matrix.m42}px`,
      right: "auto", bottom: "auto", zIndex: "130", pointerEvents: "none",
    });
    const travel = this.animate(snapshot ?? this.capture());
    const animations = this.reducedMotion?.matches ? [] : panel.getAnimations().filter(animation => animation.playState === "running" || animation.pending);
    const attach = () => {
      if (!this.mounted || epoch !== this.epoch || !this.wantsDock(this.props) || this.props.dockElement !== dock || !dock.isConnected) return;
      this.waitingForDock = false;
      this.motion?.cancel(); this.motion = null;
      dock.appendChild(host);
      Object.assign(element.style, { position: "relative", left: "0px", top: "0px", right: "auto", bottom: "auto", zIndex: "auto", pointerEvents: "" });
      this.lastBox = element.getBoundingClientRect();
      this.restoreFocus(snapshot);
    };
    void Promise.allSettled([travel, ...animations.map(animation => animation.finished)]).then(attach);
  }

  private restoreFocus(snapshot: Snapshot) {
    const element = this.props.wrapperRef.current;
    if (!snapshot?.focused || !element || this.props.hidden || (this.props.present && !this.props.active)) return;
    const active = document.activeElement;
    const dialog = active instanceof Element ? active.closest('[role="dialog"], [role="alertdialog"]') : null;
    if (dialog && !dialog.contains(element)) return;
    if (!element.contains(active)) element.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
  }

  render() {
    return <><div ref={this.home} className="contents" data-floating-chat-launcher-home="" />{this.state.host && createPortal(this.props.children, this.state.host, "floating-chat-launcher")}</>;
  }
}
