"use client";

import { useLayoutEffect, type RefObject } from "react";

const LAUNCHER_SELECTOR = "[data-filter-panel-launcher]";
const GAP = 8;

/** Keep this page's controls clear of the shared launcher without moving it. */
export function useContactPaginationClearance(
  footerRef: RefObject<HTMLDivElement | null>,
  enabled: boolean,
) {
  useLayoutEffect(() => {
    const element = footerRef.current;
    if (!enabled || !element) return;
    const footer = element;

    let active = true;
    let frame = 0;
    let launcher: HTMLElement | null = null;
    let previousLeft = -1;
    let previousRight = -1;

    const schedule = () => {
      if (active && !frame) frame = window.requestAnimationFrame(measure);
    };
    const resizeObserver = new ResizeObserver(schedule);
    const launcherObserver = new MutationObserver(schedule);
    const setClearance = (left: number, right: number) => {
      if (left !== previousLeft) {
        footer.style.setProperty("--contacts-pagination-clearance-left", String(left) + "px");
        previousLeft = left;
      }
      if (right !== previousRight) {
        footer.style.setProperty("--contacts-pagination-clearance-right", String(right) + "px");
        previousRight = right;
      }
    };

    function measure() {
      frame = 0;
      if (!active || !footer.isConnected) return;
      const next = document.querySelector<HTMLElement>(LAUNCHER_SELECTOR);
      if (next !== launcher) {
        if (launcher) resizeObserver.unobserve(launcher);
        launcherObserver.disconnect();
        launcher = next;
        if (launcher) {
          resizeObserver.observe(launcher);
          launcherObserver.observe(launcher, {
            attributes: true,
            subtree: true,
            attributeFilter: ["class", "style", "aria-hidden", "inert"],
          });
        }
      }
      const style = launcher ? window.getComputedStyle(launcher) : null;
      if (!launcher || launcher.getAttribute("aria-hidden") === "true"
        || launcher.inert || style?.display === "none" || style?.visibility === "hidden") {
        setClearance(0, 0);
        return;
      }
      // A pointer drag cannot activate pagination. Retain its last settled gap.
      if (launcher.style.transform) return;
      const box = launcher.getBoundingClientRect();
      const area = footer.getBoundingClientRect();
      const intersects = box.width > 0 && box.height > 0
        && box.left < area.right && box.right > area.left
        && box.top < area.bottom && box.bottom > area.top;
      if (!intersects) setClearance(0, 0);
      else if (box.left + box.width / 2 < area.left + area.width / 2) {
        setClearance(Math.max(0, Math.ceil(box.right + GAP - area.left)), 0);
      } else {
        setClearance(0, Math.max(0, Math.ceil(area.right - box.left + GAP)));
      }
      // Dock travel uses the Web Animations API, which has no DOM mutations.
      if (launcher.getAnimations().some(animation => animation.playState === "running")) schedule();
    }

    const containsLauncher = (node: Node) => node instanceof Element
      && (node.matches(LAUNCHER_SELECTOR) || Boolean(node.querySelector(LAUNCHER_SELECTOR)));
    const mountObserver = new MutationObserver(records => {
      if (records.some(record => [...record.addedNodes, ...record.removedNodes].some(containsLauncher))) schedule();
    });
    // Observe only mount/removal here; our own CSS variable writes are excluded.
    mountObserver.observe(document.body, { childList: true, subtree: true });
    resizeObserver.observe(footer);
    window.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("scroll", schedule);
    measure();

    return () => {
      active = false;
      if (frame) window.cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      launcherObserver.disconnect();
      mountObserver.disconnect();
      window.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("scroll", schedule);
      footer.style.removeProperty("--contacts-pagination-clearance-left");
      footer.style.removeProperty("--contacts-pagination-clearance-right");
    };
  }, [footerRef, enabled]);
}
