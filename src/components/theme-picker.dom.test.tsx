/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ThemePicker } from "@/components/theme-picker";
import { THEME_KEY } from "@/lib/theme";

beforeEach(() => {
  // Newer Node releases may expose their own partial `localStorage` global.
  // Pin the DOM test to jsdom's real Storage implementation rather than
  // depending on which global Vitest happened to install first.
  vi.stubGlobal("localStorage", window.localStorage);
  window.localStorage.clear();
  document.documentElement.classList.remove("dark");
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  });
});

afterEach(() => vi.unstubAllGlobals());

describe("ThemePicker", () => {
  it("supports arrow-key selection through the radio menu", async () => {
    const user = userEvent.setup();
    render(<ThemePicker />);

    await user.click(screen.getByRole("button", { name: "Appearance" }));
    const system = screen.getByRole("menuitemradio", { name: "System" });
    system.focus();
    await user.keyboard("{ArrowDown}{ArrowDown}{Enter}");

    await waitFor(() =>
      expect(window.localStorage.getItem(THEME_KEY)).toBe("dark"),
    );
    expect(document.documentElement).toHaveClass("dark");
  });
});
