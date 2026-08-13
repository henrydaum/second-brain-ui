/** @vitest-environment jsdom */

/**
 * The openers on an empty thread fill the composer; they do not send.
 *
 * That is the whole point of them — someone who presses one should get the
 * question in the box with the cursor after it, free to change it — and it is
 * one prop away from the opposite behaviour, so it is worth pinning down.
 */

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AssistantRuntimeProvider,
  useAuiState,
  useLocalRuntime,
  type ChatModelAdapter,
} from "@assistant-ui/react";
import type { FC, ReactNode } from "react";

/** Nothing here should reach a model; a call to this is a failed assertion. */
const run = vi.fn<ChatModelAdapter["run"]>(() => {
  throw new Error("a suggestion sent a message");
});

const Harness: FC<{ children: ReactNode }> = ({ children }) => {
  const runtime = useLocalRuntime({ run });
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      {children}
    </AssistantRuntimeProvider>
  );
};

/** Reads the two pieces of runtime state the buttons are supposed to move. */
const Probe: FC = () => {
  const text = useAuiState((s) => s.composer.text);
  const count = useAuiState((s) => s.thread.messages.length);
  return (
    <>
      <span data-testid="composer">{text}</span>
      <span data-testid="messages">{count}</span>
    </>
  );
};

const { WelcomeSuggestions } = await import("@/components/thread");

afterEach(cleanup);

describe("WelcomeSuggestions", () => {
  it.each([
    ["About Henry", "Tell me about Henry Daum"],
    ["Art Demo", "Show me a cool art demo"],
    [
      "How It Works",
      "Read your own README, then tell me about yourself in a few sentences.",
    ],
  ])("puts %s's prompt in the composer unsent", async (label, prompt) => {
    const user = userEvent.setup();
    render(
      <Harness>
        <WelcomeSuggestions />
        <Probe />
      </Harness>,
    );

    await user.click(screen.getByRole("button", { name: label }));

    expect(screen.getByTestId("composer")).toHaveTextContent(prompt);
    expect(screen.getByTestId("messages")).toHaveTextContent("0");
    expect(run).not.toHaveBeenCalled();
  });
});
