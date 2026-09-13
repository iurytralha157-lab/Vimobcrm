"use client";

import { useCallback, useEffect } from "react";

export const PROPERTY_FORM_UNSAVED_MESSAGE =
  "Há alterações não salvas neste imóvel. Deseja descartá-las e sair?";

type PropertyFormNavigationGuardOptions = {
  enabled: boolean;
  onConfirmDiscard: () => void;
};

export function usePropertyFormNavigationGuard({
  enabled,
  onConfirmDiscard,
}: PropertyFormNavigationGuardOptions) {
  const confirmNavigation = useCallback(() => {
    if (!enabled) return true;
    if (!window.confirm(PROPERTY_FORM_UNSAVED_MESSAGE)) return false;

    onConfirmDiscard();
    return true;
  }, [enabled, onConfirmDiscard]);

  useEffect(() => {
    if (!enabled) return;

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;

    const handleDocumentClick = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }

      const target = event.target;
      const anchor =
        target instanceof Element
          ? target.closest<HTMLAnchorElement>("a[href]")
          : null;
      if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) {
        return;
      }

      const current = new URL(window.location.href);
      const destination = new URL(anchor.href, current);
      if (
        destination.origin === current.origin &&
        destination.pathname === current.pathname &&
        destination.search === current.search
      ) {
        return;
      }
      if (confirmNavigation()) return;

      event.preventDefault();
      event.stopImmediatePropagation();
    };

    document.addEventListener("click", handleDocumentClick, true);
    return () => document.removeEventListener("click", handleDocumentClick, true);
  }, [confirmNavigation, enabled]);

  useEffect(() => {
    if (!enabled) return;

    let restoringHistory = false;
    const handlePopState = () => {
      if (restoringHistory) {
        restoringHistory = false;
        return;
      }
      if (confirmNavigation()) return;

      restoringHistory = true;
      window.history.forward();
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [confirmNavigation, enabled]);

  return confirmNavigation;
}
