/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CommandMarkdown } from "@/components/command-renderers";

describe("Settings command tables", () => {
  it("isolates a wide table in its own horizontal scroller", () => {
    render(
      <CommandMarkdown text={"| First | Second |\n| --- | --- |\n| one | two |"} />,
    );

    const table = screen.getByRole("table");
    expect(table).toHaveClass("w-max", "max-w-none");
    expect(table.parentElement).toHaveClass(
      "w-full",
      "max-w-full",
      "overflow-x-auto",
      "[contain:inline-size]",
    );
  });
});
