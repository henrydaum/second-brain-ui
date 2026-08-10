/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ThemePicker } from "@/components/theme-picker";
import { THEME_KEY } from "@/lib/theme";

beforeEach(() => {
  localStorage.clear();
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

describe("ThemePicker", () => {
  it("supports arrow-key selection through the radio menu", async () => {
    const user = userEvent.setup();
    render(<ThemePicker />);

    await user.click(screen.getByRole("button", { name: "Appearance" }));
    const system = screen.getByRole("menuitemradio", { name: "System" });
    system.focus();
    await user.keyboard("{ArrowDown}{ArrowDown}{Enter}");

    await waitFor(() => expect(localStorage.getItem(THEME_KEY)).toBe("dark"));
    expect(document.documentElement).toHaveClass("dark");
  });
});
