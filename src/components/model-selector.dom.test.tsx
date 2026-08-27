/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const setModel = vi.fn();
const setReasoningEffort = vi.fn();

// Mutable so a test can put the panel in one state without a second mock.
let reasoningEffort = "medium";
let settingReasoning = false;

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
    reasoningEffort,
    settingReasoning,
    setReasoningEffort,
  }),
}));

const { ModelSelector, compactModelName } = await import(
  "@/components/model-selector"
);

beforeEach(() => {
  vi.clearAllMocks();
  reasoningEffort = "medium";
  settingReasoning = false;
});
afterEach(cleanup);

describe("compactModelName", () => {
  it.each([
    ["anthropic/sonnet-4.6", "Sonnet 4.6"],
    ["openai/gpt-5.4", "GPT 5.4"],
    ["minimax/minimax-m3", "MiniMax M3"],
    ["deepseek-v3.2", "DeepSeek V3.2"],
    ["openai/gpt-oss-120b", "GPT OSS 120B"],
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

  it("selects through the SDK state action", async () => {
    const user = userEvent.setup();
    render(<ModelSelector />);
    await user.click(screen.getByRole("button", { name: /Model:/ }));
    await user.click(
      screen.getByRole("menuitemradio", { name: "openrouter/sonnet-4.6" }),
    );
    expect(setModel).toHaveBeenCalledWith("openrouter/sonnet-4.6");
  });
});

describe("the reasoning row", () => {
  const openPanel = async () => {
    const user = userEvent.setup();
    render(<ModelSelector />);
    await user.click(screen.getByRole("button", { name: /Model:/ }));
    return user;
  };

  it("shows the stored effort, and Medium when there is none", async () => {
    await openPanel();
    expect(screen.getByRole("radio", { name: "Med" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByRole("radio", { name: "High" })).toHaveAttribute(
      "aria-checked",
      "false",
    );

    cleanup();
    reasoningEffort = "off";
    await openPanel();
    expect(screen.getByRole("radio", { name: "Off" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("sets the effort without closing the panel", async () => {
    const user = await openPanel();
    await user.click(screen.getByRole("radio", { name: "High" }));
    expect(setReasoningEffort).toHaveBeenCalledWith("high");
    // Picking a model is a decision you leave on; effort is one you may want to
    // change twice, so the menu has to survive the click.
    expect(screen.getByRole("radiogroup", { name: "Reasoning effort" }))
      .toBeInTheDocument();
  });

  it("goes inert while a write is in flight", async () => {
    settingReasoning = true;
    const user = await openPanel();
    const high = screen.getByRole("radio", { name: "High" });
    expect(high).toBeDisabled();
    await user.click(high);
    expect(setReasoningEffort).not.toHaveBeenCalled();
  });
});
