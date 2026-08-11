/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const setModel = vi.fn();
const openSettings = vi.fn();

vi.mock("@/runtime/provider", () => ({
  useModels: () => ({
    models: [
      { model_name: "anthropic/sonnet-4.6", loaded: true },
      { model_name: "openrouter/sonnet-4.6", loaded: false },
    ],
    modelName: "anthropic/sonnet-4.6",
    agentProfile: "researcher",
    modelsLoading: false,
    modelsFailure: false,
    switchingModel: false,
    setModel,
  }),
  useSettings: () => ({ openSettings }),
}));

const { ModelSelector, compactModelName } = await import(
  "@/components/model-selector"
);

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe("compactModelName", () => {
  it.each([
    ["anthropic/sonnet-4.6", "Sonnet 4.6"],
    ["openai/gpt-5.4", "GPT 5.4"],
    ["claude_opus", "Claude Opus"],
    ["gateway/team/model-name", "Model Name"],
    ["gateway/team/", "Team"],
    ["", "Select model"],
  ])("humanizes %s", (input, expected) => {
    expect(compactModelName(input)).toBe(expected);
  });
});

describe("ModelSelector", () => {
  it("keeps exact provider-prefixed IDs in the menu", async () => {
    const user = userEvent.setup();
    render(<ModelSelector />);

    expect(screen.getByRole("button", { name: "Model: anthropic/sonnet-4.6" }))
      .toHaveTextContent("Sonnet 4.6");
    await user.click(screen.getByRole("button", { name: /Model:/ }));

    expect(screen.getByRole("menuitemradio", { name: "anthropic/sonnet-4.6" }))
      .toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("menuitemradio", { name: "openrouter/sonnet-4.6" }))
      .toBeInTheDocument();
    expect(screen.getByText("Agent profile:").parentElement)
      .toHaveTextContent("researcher");
  });

  it("selects through the SDK state action and links to agent settings", async () => {
    const user = userEvent.setup();
    render(<ModelSelector />);
    await user.click(screen.getByRole("button", { name: /Model:/ }));
    await user.click(
      screen.getByRole("menuitemradio", { name: "openrouter/sonnet-4.6" }),
    );
    expect(setModel).toHaveBeenCalledWith("openrouter/sonnet-4.6");

    await user.click(screen.getByRole("button", { name: /Model:/ }));
    await user.click(screen.getByRole("menuitem", { name: "Manage models and agents" }));
    expect(openSettings).toHaveBeenCalledWith("agents");
  });
});
