/**
 * Light, dark, or whatever the machine is set to.
 *
 * The palette for both has been in `index.css` from the beginning, along with
 * a `dark:` variant and a scattering of `dark:` classes across a dozen
 * components. None of it could ever fire: nothing put `.dark` on the document,
 * so the app was permanently light and half its stylesheet was unreachable.
 * This is the missing half — the part that decides.
 *
 * **Three states, not two.** "System" is the default everywhere this app is
 * trying to feel like, and it is a genuinely different setting from "light":
 * one tracks the machine as it changes through the day, the other does not.
 * Collapsing them into a toggle loses that, and loses it silently.
 *
 * The class is also applied by an inline script in `index.html`, before the
 * bundle loads. That is not a duplicate of this: React's first paint is far too
 * late to prevent a white flash on a dark desktop, and the flash is the whole
 * thing people notice.
 */

import { useCallback, useEffect, useState } from "react";

export type Theme = "system" | "light" | "dark";

/** Shared with the pre-paint script in `index.html`. Changing it here without
 *  changing it there brings the flash back. */
export const THEME_KEY = "second-brain:theme";

const DARK_QUERY = "(prefers-color-scheme: dark)";

/** The stored preference, or "system" for anything unrecognised — including a
 *  browser that refuses `localStorage` entirely, which throws rather than
 *  answering null. */
export function readTheme(): Theme {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === "light" || stored === "dark" || stored === "system") {
      return stored;
    }
  } catch {
    // Private mode, or storage disabled. Not a reason to fail to render.
  }
  return "system";
}

/** What "system" actually resolves to right now. */
export function resolveTheme(theme: Theme): "light" | "dark" {
  if (theme !== "system") return theme;
  return window.matchMedia(DARK_QUERY).matches ? "dark" : "light";
}

function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle(
    "dark",
    resolveTheme(theme) === "dark",
  );
}

/**
 * The current theme and a way to change it.
 *
 * The media listener is only attached while the preference is "system" — an
 * explicit choice is not something the OS gets to overrule, and leaving the
 * listener attached would let it.
 */
export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(readTheme);

  useEffect(() => {
    applyTheme(theme);
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      // The preference will not survive a reload. The theme still applies.
    }

    if (theme !== "system") return;
    const media = window.matchMedia(DARK_QUERY);
    const onChange = () => applyTheme("system");
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [theme]);

  const setTheme = useCallback((next: Theme) => setThemeState(next), []);

  return { theme, setTheme, resolved: resolveTheme(theme) };
}
