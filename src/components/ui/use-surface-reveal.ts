import { useEffect, useRef } from "react";

/** Animate replacement content in place: no remount, stale interactive copy,
 * or delay before the next screen can accept input. */
export function useSurfaceReveal<T extends HTMLElement>(identity: unknown) {
  const ref = useRef<T>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element?.animate || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const animation = element.animate(
      [{ opacity: 0.35 }, { opacity: 1 }],
      { duration: 160, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
    );
    return () => animation.cancel();
  }, [identity]);
  return ref;
}
