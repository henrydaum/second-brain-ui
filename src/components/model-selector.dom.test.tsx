/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const setModel = vi.fn();
const setReasoningValue = vi.fn();
const refreshReasoning = vi.fn();

// Mutable so a test can put the panel in one state without a second mock.
// `null` is the ordinary case, not an edge one: the backend answers it for
// every model it cannot vouch for a reasoning parameter on.
let reasoningControl: {
  param: string;
  choices: string[];
  value: string | null;
} | null = null;
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
    reasoningControl,
    settingReasoning,
    refreshReasoning,
    setReasoningValue,
  }),
}));

const { ModelSelector, compactModelName } = await import(
  "@/components/model-selector"
);

beforeEach(() => {
  vi.clearAllMocks();
  reasoningControl = {
    param: "reasoning_effort",
    choices: ["none", "low", "medium", "high", "xhigh"],
    value: "medium",
  };
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

  const openReasoning = async () => {
    const user = await openPanel();
    await user.click(screen.getByRole("menuitem", { name: /Reasoning:/ }));
    return user;
  };

  /**
   * Choose a value from the open submenu, by keyboard.
   *
   * Radix opens a submenu on click here and leaves its items inert to a
   * further click — jsdom has no real pointer, and the library gates item
   * selection on pointer state it never sees. Keyboard selection is the path
   * it supports without one, and it is a path a person genuinely uses.
   */
  const choose = async (
    user: ReturnType<typeof userEvent.setup>,
    label: string,
  ) => {
    const items = screen.getAllByRole("menuitemradio");
    const target = items.find((item) => item.textContent === label);
    if (!target) throw new Error(`no submenu item named ${label}`);
    target.focus();
    await user.keyboard("{Enter}");
  };

  it("is absent when the backend vouches for no reasoning parameter", async () => {
    // The case that matters most, and the common one: a model routed through a
    // gateway under a name litellm has no record of. Showing a control there
    // would be asserting values nothing said were accepted.
    reasoningControl = null;
    await openPanel();

    expect(screen.queryByText(/Reasoning:/)).not.toBeInTheDocument();
  });

  it("offers exactly the values the backend named", async () => {
    await openReasoning();

    // Not a fixed ladder: five here, and a different provider names two or
    // seven. `xhigh` in particular was unreachable from the old control.
    // The model list uses the same role in the parent menu, so only the
    // submenu's own items are compared.
    const labels = screen
      .getAllByRole("menuitemradio")
      .map((item) => item.textContent)
      .filter((label) => !label?.includes("/"));
    expect(labels).toEqual(["Not set", "none", "low", "medium", "high", "xhigh"]);
  });

  it("says which value is set, and reads a cleared one as Not set", async () => {
    await openPanel();
    expect(screen.getByText("Reasoning:").parentElement).toHaveTextContent(
      "Reasoning: medium",
    );

    cleanup();
    // `null` is a profile that sets nothing, which leaves the provider's own
    // default. Deliberately not called "Off" — a provider default may well
    // still reason, and only a value it names, like `none`, means off.
    reasoningControl = {
      param: "reasoning_effort",
      choices: ["none", "low", "high"],
      value: null,
    };
    await openPanel();
    expect(screen.getByText("Reasoning:").parentElement).toHaveTextContent(
      "Reasoning: Not set",
    );
  });

  it("sets the value the backend named", async () => {
    const user = await openReasoning();
    await choose(user, "high");

    expect(setReasoningValue).toHaveBeenCalledWith("high");
  });

  it("clears the parameter rather than storing a word for it", async () => {
    // The old control wrote the literal "off", which the kernel used to alias
    // to a null and no longer does — so the word reached providers that have
    // no such level. Clearing is `null`, and the write path deletes the key.
    reasoningControl = {
      param: "reasoning_effort",
      choices: ["low", "high"],
      value: "high",
    };
    const user = await openReasoning();
    await choose(user, "Not set");

    expect(setReasoningValue).toHaveBeenCalledWith(null);
  });

  it("goes inert while a write is in flight", async () => {
    settingReasoning = true;
    await openPanel();

    expect(screen.getByRole("menuitem", { name: /Reasoning:/ })).toHaveAttribute(
      "data-disabled",
    );
  });
});
