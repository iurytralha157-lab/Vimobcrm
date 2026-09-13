"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { TourOverlay } from "@/components/features/setup-guide/tour/TourOverlay";
import {
  normalizeStepId,
  TOUR_PLANS,
  type TourItem,
} from "@/components/features/setup-guide/tour/model";
import {
  clamp,
  getTourTooltipStyle,
} from "@/components/features/setup-guide/tour/positioning";
import {
  activateTourElement,
  closeOpenLayer,
  findElementBySelector,
} from "@/components/features/setup-guide/tour/targeting";
import { useAuth } from "@/contexts/AuthContext";
import {
  SETUP_GUIDE_ACTIVE_STEP_PREFIX,
  SETUP_GUIDE_COMPLETE_EVENT,
  SETUP_GUIDE_STEP_EVENT,
  type SetupStepId,
} from "@/hooks/use-setup-guide";
import { setupGuidePathMatches } from "@/lib/setup-guide/navigation";

export function SetupGuideTour() {
  const { activeOrganization, user } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [activeStepId, setActiveStepId] = useState<SetupStepId | null>(null);
  const [items, setItems] = useState<TourItem[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [targetElement, setTargetElement] = useState<HTMLElement | null>(null);
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const [isResolving, setIsResolving] = useState(false);
  const tourDialogRef = useRef<HTMLDivElement | null>(null);
  const previousFocusedElementRef = useRef<HTMLElement | null>(null);

  const organizationId = activeOrganization.organizationId;
  const storageKey =
    user?.id && organizationId
      ? `${SETUP_GUIDE_ACTIVE_STEP_PREFIX}${user.id}:${organizationId}`
      : null;
  const queryStepId = normalizeStepId(searchParams.get("setupGuide"));
  const plan = activeStepId ? TOUR_PLANS[activeStepId] : null;
  const routeMatches = !!plan && setupGuidePathMatches(pathname, plan.path);
  const currentItem = items[currentIndex];

  const readActiveStep = useCallback(() => {
    if (!storageKey) {
      setActiveStepId(null);
      return;
    }

    try {
      setActiveStepId(normalizeStepId(window.localStorage.getItem(storageKey)));
    } catch {
      setActiveStepId(null);
    }
  }, [storageKey]);

  const finishTour = useCallback(
    (complete = false) => {
      const completedStepId = activeStepId;
      closeOpenLayer();
      if (storageKey) {
        try {
          window.localStorage.removeItem(storageKey);
        } catch {
          // ignore
        }
      }
      setActiveStepId(null);
      setItems([]);
      setTargetElement(null);
      setTargetRect(null);
      window.dispatchEvent(
        new CustomEvent(SETUP_GUIDE_STEP_EVENT, { detail: null }),
      );
      if (complete && completedStepId) {
        window.dispatchEvent(
          new CustomEvent(SETUP_GUIDE_COMPLETE_EVENT, {
            detail: completedStepId,
          }),
        );
      }
    },
    [activeStepId, storageKey],
  );

  const handleTourDialogKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        finishTour(false);
        return;
      }

      if (event.key !== "Tab") return;
      const dialog = tourDialogRef.current;
      if (!dialog) return;
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => element.getClientRects().length > 0);

      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus({ preventScroll: true });
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus({ preventScroll: true });
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus({ preventScroll: true });
      }
    },
    [finishTour],
  );

  useEffect(() => {
    if (!activeStepId) return;
    previousFocusedElementRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

    return () => {
      previousFocusedElementRef.current?.focus({ preventScroll: true });
      previousFocusedElementRef.current = null;
    };
  }, [activeStepId]);

  useEffect(() => {
    if (!activeStepId) return;
    const frame = requestAnimationFrame(() => {
      tourDialogRef.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [activeStepId, currentIndex, isResolving, routeMatches]);

  useEffect(() => {
    queueMicrotask(readActiveStep);
  }, [readActiveStep]);

  useEffect(() => {
    document.documentElement.dataset.setupGuideActiveStep = activeStepId || "";
    if (activeStepId) {
      document.body.dataset.setupGuideActive = "true";
    } else {
      delete document.body.dataset.setupGuideActive;
    }

    return () => {
      delete document.documentElement.dataset.setupGuideActiveStep;
      delete document.body.dataset.setupGuideActive;
    };
  }, [activeStepId]);

  useEffect(() => {
    if (!queryStepId || !storageKey) return;

    try {
      window.localStorage.setItem(storageKey, queryStepId);
    } catch {
      // ignore
    }

    queueMicrotask(() => {
      setActiveStepId(queryStepId);

      const url = new URL(window.location.href);
      url.searchParams.delete("setupGuide");
      window.history.replaceState(
        null,
        "",
        `${url.pathname}${url.search}${url.hash}`,
      );
    });
  }, [queryStepId, storageKey]);

  useEffect(() => {
    const handleStepChange = (event: Event) => {
      setActiveStepId(
        normalizeStepId((event as CustomEvent<string | null>).detail),
      );
    };

    const handleStorage = (event: StorageEvent) => {
      if (storageKey && event.key === storageKey) readActiveStep();
    };

    window.addEventListener(SETUP_GUIDE_STEP_EVENT, handleStepChange);
    window.addEventListener("storage", handleStorage);

    return () => {
      window.removeEventListener(SETUP_GUIDE_STEP_EVENT, handleStepChange);
      window.removeEventListener("storage", handleStorage);
    };
  }, [readActiveStep, storageKey]);

  useEffect(() => {
    if (!activeStepId || !plan || !routeMatches) {
      queueMicrotask(() => {
        setItems([]);
        setTargetElement(null);
        setTargetRect(null);
        setCurrentIndex(0);
        setIsResolving(false);
      });
      return;
    }

    queueMicrotask(() => {
      setItems(plan.items);
      setCurrentIndex(0);
      setTargetElement(null);
      setTargetRect(null);
      setIsResolving(false);
    });
  }, [activeStepId, plan, routeMatches, pathname]);

  useEffect(() => {
    queueMicrotask(() => {
      setCurrentIndex((current) =>
        clamp(current, 0, Math.max(items.length - 1, 0)),
      );
    });
  }, [items.length]);

  useEffect(() => {
    if (!currentItem) {
      queueMicrotask(() => {
        setTargetElement(null);
        setTargetRect(null);
      });
      return;
    }

    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let attempts = 0;
    let actionAttempts = 0;
    let targetSelector: string | string[] = currentItem.selector;

    const resolveTarget = () => {
      if (cancelled) return;
      const element = findElementBySelector(targetSelector);

      if (element || attempts >= 25) {
        setTargetElement(element);
        setTargetRect(element ? element.getBoundingClientRect() : null);
        setIsResolving(false);
        if (element) {
          element.scrollIntoView({
            block: "center",
            inline: "center",
            behavior: "auto",
          });
          timeoutId = setTimeout(() => {
            if (!cancelled) setTargetRect(element.getBoundingClientRect());
          }, 120);
        }
        return;
      }

      attempts += 1;
      timeoutId = setTimeout(resolveTarget, 100);
    };

    const runAction = () => {
      if (currentItem.closeOpenLayer) closeOpenLayer();

      if (!currentItem.action) {
        resolveTarget();
        return;
      }

      const action = currentItem.action;
      if (action.closeOpenLayer) closeOpenLayer();

      if (action.type === "hash") {
        const nextHash = `#${action.hash}`;
        if (window.location.hash !== nextHash) {
          window.location.hash = nextHash;
        } else {
          window.dispatchEvent(new HashChangeEvent("hashchange"));
        }
        if (action.waitFor) targetSelector = action.waitFor;
        attempts = 0;
        timeoutId = setTimeout(resolveTarget, 120);
        return;
      }

      const resolveActionTrigger = () => {
        if (cancelled) return;
        const trigger = findElementBySelector(action.selector);
        if (!trigger && actionAttempts < 30) {
          actionAttempts += 1;
          timeoutId = setTimeout(resolveActionTrigger, 100);
          return;
        }

        activateTourElement(trigger);

        if (action.waitFor) {
          targetSelector = action.waitFor;
          attempts = 0;
          timeoutId = setTimeout(resolveTarget, 80);
          return;
        }

        resolveTarget();
      };

      timeoutId = setTimeout(resolveActionTrigger, 120);
    };

    queueMicrotask(() => {
      if (cancelled) return;
      setIsResolving(true);
      setTargetElement(null);
      setTargetRect(null);
      runAction();
    });

    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [currentItem]);

  useEffect(() => {
    if (!targetElement) return;

    const updateRect = () => {
      setTargetRect(targetElement.getBoundingClientRect());
    };

    window.addEventListener("resize", updateRect);
    window.addEventListener("scroll", updateRect, true);

    return () => {
      window.removeEventListener("resize", updateRect);
      window.removeEventListener("scroll", updateRect, true);
    };
  }, [targetElement]);

  const tooltipStyle = useMemo(
    () =>
      getTourTooltipStyle(
        targetRect,
        typeof window === "undefined"
          ? null
          : { width: window.innerWidth, height: window.innerHeight },
      ),
    [targetRect],
  );

  if (!activeStepId || !plan) return null;

  return (
    <TourOverlay
      currentIndex={currentIndex}
      currentItem={currentItem}
      isResolving={isResolving}
      itemCount={items.length}
      onClose={() => finishTour(false)}
      onDialogKeyDown={handleTourDialogKeyDown}
      onNavigate={() => router.push(plan.route)}
      onNext={() => {
        if (currentIndex >= items.length - 1) {
          finishTour(true);
          return;
        }
        setCurrentIndex((index) => index + 1);
      }}
      onPrevious={() =>
        setCurrentIndex((index) => Math.max(0, index - 1))
      }
      routeMatches={routeMatches}
      targetRect={targetRect}
      tooltipStyle={tooltipStyle}
      tourDialogRef={tourDialogRef}
    />
  );
}
