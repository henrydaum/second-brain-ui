// @vitest-environment jsdom

/**
 * What the provider believes about the turn when the page first loads.
 *
 * `typing` only ever moves on a `typing` frame, and a reload cannot receive the
 * one that opened a turn already in progress. Everything downstream of that is
 * cosmetic except one thing: `isRunning` is what puts Stop in the composer, so
 * getting it wrong takes away the only control that ends a turn — the case that
 * is worth a real render.
 *
 * The provider is *rendered* here, unlike the component tests next door, which
 * stub it deliberately. What is under test is its boot sequence, and there is no
 * way to stub that and still be testing it. The six modules it reaches the
 * server through are mocked instead, so nothing opens a connection.
 */

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sdk = vi.fn();
const connect = vi.fn();
const readConversation = vi.fn();

vi.mock("@/lib/client", () => ({
  sdk: (...args: unknown[]) => sdk(...args),
  RequestFailed: class RequestFailed extends Error {},
}));
vi.mock("@/lib/events", () => ({
  connect: (...args: unknown[]) => connect(...args),
}));
vi.mock("@/lib/history", () => ({
  readConversation: (...args: unknown[]) => readConversation(...args),
}));
vi.mock("@/lib/commands", () => ({
  listCommands: async () => [],
  looksLikeCommand: () => false,
}));
vi.mock("@/lib/conversations", () => ({
  listConversations: async () => [],
  isUnused: () => false,
  PLACEHOLDER_TITLE: "",
}));
vi.mock("@/lib/notifications", () => ({
  listNotifications: async () => [],
  markRead: async () => undefined,
}));

const { SecondBrainProvider, useSession } = await import("@/runtime/provider");

/** Reads the one field under test out of the context. */
const Probe = () => {
  const { state } = useSession();
  return <span data-testid="typing">{String(state.typing)}</span>;
};

/** Answer `session.get` with `busy`, and everything else with nothing. */
const bootWith = (busy: boolean) => {
  sdk.mockImplementation(async (type: string) => {
    if (type === "session.get") {
      return { conversation_id: 7, mode: "ask", busy };
    }
    return null;
  });
};

beforeEach(() => {
  vi.clearAllMocks();
  readConversation.mockResolvedValue([]);
  // The stream reports itself open, which is what the reconnect sync keys on.
  connect.mockImplementation(
    (_onFrame: unknown, setStatus: (s: string) => void) => {
      setStatus("open");
      return () => {};
    },
  );
});

afterEach(cleanup);

describe("a page that loads in the middle of a turn", () => {
  it("comes up knowing the agent has the turn", async () => {
    bootWith(true);
    render(
      <SecondBrainProvider>
        <Probe />
      </SecondBrainProvider>,
    );

    // Without this the composer offers Send where Stop belongs, and reloading
    // becomes a way to lose the ability to interrupt.
    await waitFor(() =>
      expect(screen.getByTestId("typing").textContent).toBe("true"),
    );
  });

  it("survives the history read, which resets everything transient", async () => {
    // `history` is dispatched after the session is read and returns the store to
    // its initial state — so a seed placed before it would be thrown away, and
    // the assertion above would pass for one render and then stop being true.
    bootWith(true);
    render(
      <SecondBrainProvider>
        <Probe />
      </SecondBrainProvider>,
    );

    await waitFor(() => expect(readConversation).toHaveBeenCalledWith(7));
    await waitFor(() =>
      expect(screen.getByTestId("typing").textContent).toBe("true"),
    );
  });

  it("leaves an idle session idle", async () => {
    bootWith(false);
    render(
      <SecondBrainProvider>
        <Probe />
      </SecondBrainProvider>,
    );

    await waitFor(() => expect(readConversation).toHaveBeenCalledWith(7));
    expect(screen.getByTestId("typing").textContent).toBe("false");
  });
});
