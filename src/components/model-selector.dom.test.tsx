/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const setModel = vi.fn();
const openSettings = vi.fn();

vi.mock("@/runtime/provider", () => ({
  useSettings: () => ({ openSettings }),
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
}));

const { ModelSelector, compactModelName } = await import(
  "@/components/model-selector"
);

beforeEach(() => {
  vi.clearAllMocks();
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

describe("the settings link", () => {
  const openPanel = async () => {
    const user = userEvent.setup();
    render(<ModelSelector />);
    await user.click(screen.getByRole("button", { name: /Model:/ }));
    return user;
  };

  it("sends you to the section that manages model parameters", async () => {
    // The panel used to carry a reasoning control of its own: four values
    // written into `reasoning_effort`. That was a guess about the parameter's
    // name, about whether this model takes it, and about its values — and the
    // honest version can only draw a control for models something has vouched
    // for, which is a minority. One destination that is always right beats a
    // control that is sometimes there.
    const user = await openPanel();
    await user.click(
      screen.getByRole("menuitem", { name: "Configure language models" }),
    );

    expect(openSettings).toHaveBeenCalledWith("agents");
  });

  it("closes the panel on the way", async () => {
    const user = await openPanel();
    await user.click(
      screen.getByRole("menuitem", { name: "Configure language models" }),
    );

    // Settings opens over the composer, so a panel left standing would be
    // behind it and still open when it closes.
    await waitFor(() =>
      expect(
        screen.queryByRole("menuitem", { name: "Configure language models" }),
      ).not.toBeInTheDocument(),
    );
  });

  it("offers no reasoning control of its own", async () => {
    await openPanel();

    expect(screen.queryByText(/Reasoning/)).not.toBeInTheDocument();
  });
});
