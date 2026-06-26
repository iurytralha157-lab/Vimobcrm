import * as React from "react";

const MOBILE_BREAKPOINT = 768;

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined);

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    };
    mql.addEventListener("change", onChange);
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    });
    return () => {
      cancelled = true;
      mql.removeEventListener("change", onChange);
    };
  }, []);

  return !!isMobile;
}
