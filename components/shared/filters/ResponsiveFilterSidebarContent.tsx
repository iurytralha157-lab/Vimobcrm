import { useEffect, useLayoutEffect, type ReactElement } from "react";
import { FocusScope } from "@radix-ui/react-focus-scope";
import { RemoveScroll } from "react-remove-scroll";
import { hideOthers } from "aria-hidden";

type Props = {
  open: boolean;
  mobile: boolean;
  element: HTMLElement | null;
  children: ReactElement;
};

/** Toggle isolation around a stable nonmodal Sheet, without replacing editors. */
export function ResponsiveFilterSidebarContent({ open, mobile, element, children }: Props) {
  const isolated = open && mobile;
  useLayoutEffect(() => {
    if (!isolated || !element) return;
    const scope = element.dataset.filterLayer;
    const portals = scope ? Array.from(document.querySelectorAll<HTMLElement>("[data-filter-layer]"))
      .filter(layer => layer !== element && layer.dataset.filterLayer === scope) : [];
    return hideOthers([element, ...portals]);
  }, [element, isolated]);
  useEffect(() => {
    // FocusScope starts tracking focus when trapping is enabled. Seed its
    // current candidate without refocusing/selecting text or interrupting IME.
    const focused = document.activeElement;
    if (isolated && focused instanceof HTMLElement && element?.contains(focused)) {
      focused.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    }
  }, [element, isolated]);
  return (
    <RemoveScroll enabled={isolated} allowPinchZoom forwardProps>
      <FocusScope asChild loop={isolated} trapped={isolated}
        onMountAutoFocus={event => event.preventDefault()}
        onUnmountAutoFocus={event => event.preventDefault()}>
        {children}
      </FocusScope>
    </RemoveScroll>
  );
}
