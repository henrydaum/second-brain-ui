// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

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
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PendingAttachment } from "@assistant-ui/react";

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
  listConversations: async () => ({ items: [], hasMore: false, categories: [] }),
  CONVERSATION_PAGE: 50,
  PLACEHOLDER_TITLE: "",
  setConversationTitle: async () => true,
  setConversationCategory: async () => true,
}));
vi.mock("@/lib/notifications", () => ({
  listNotifications: async () => [],
  markRead: async () => undefined,
}));

const { SecondBrainProvider, attachmentAdapter, useModels, useSession } =
  await import("@/runtime/provider");

/** Reads the one field under test out of the context. */
const Probe = () => {
  const { state } = useSession();
  return <span data-testid="typing">{String(state.typing)}</span>;
};

const ModelProbe = () => {
  const { modelName, agentProfile, models, setModel, reasoningControl, refreshReasoning, setReasoningValue } =
    useModels();
  return (
    <>
      <span data-testid="model">{modelName}</span>
      <span data-testid="agent">{agentProfile}</span>
      <span data-testid="models">{models.map((model) => model.model_name).join(",")}</span>
      <span data-testid="reasoning">{reasoningControl?.value ?? "none"}</span>
      <button type="button" onClick={() => void setModel("openrouter/gpt-5.4")}>
        Switch
      </button>
      <button type="button" onClick={() => void refreshReasoning()}>
        Look up reasoning
      </button>
      <button type="button" onClick={() => void setReasoningValue("high")}>
        Think harder
      </button>
    </>
  );
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
  readConversation.mockResolvedValue({ turns: [], conversation: null });
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

/**
 * What `llm.list({ params })` answers for a model that has a reasoning dial.
 *
 * The panel asks this on open rather than at boot, because whether a control
 * exists is a fact about the *model* and the backend is the only thing that
 * knows it. Every test that touches the control therefore has to press "Look
 * up reasoning" first, exactly as opening the panel does.
 */
const REASONING_PARAMS = {
  params: [
    { name: "temperature", supported: true, choices: [] },
    {
      name: "reasoning_effort",
      role: "reasoning",
      supported: true,
      choices: ["low", "medium", "high"],
    },
  ],
};

describe("global model synchronization", () => {
  it("reads the default model, agent profile, and configured models", async () => {
    sdk.mockImplementation(async (type: string, args?: { key?: string }) => {
      if (type === "session.get") {
        return {
          conversation_id: 7,
          mode: "ask",
          busy: false,
          agent_profile: "researcher",
        };
      }
      if (type === "llm.list") {
        return { profiles: [{ model_name: "anthropic/sonnet-4.6" }] };
      }
      if (type === "config.read") {
        return args?.key === "llm_profiles"
          ? { "anthropic/sonnet-4.6": { llm_extra_params: { reasoning_effort: "low" } } }
          : "anthropic/sonnet-4.6";
      }
      return null;
    });

    render(
      <SecondBrainProvider>
        <ModelProbe />
      </SecondBrainProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("model")).toHaveTextContent("anthropic/sonnet-4.6"),
    );
    expect(screen.getByTestId("agent")).toHaveTextContent("researcher");
    expect(screen.getByTestId("models")).toHaveTextContent("anthropic/sonnet-4.6");
    // No control at boot, even though the profile carries a value: whether
    // there is a dial is a question about the model, and asking it is a round
    // trip that boot should not spend on a panel nobody has opened.
    expect(screen.getByTestId("reasoning")).toHaveTextContent("none");
  });

  it("builds the control from the backend, not from a fixed ladder", async () => {
    sdk.mockImplementation(async (type: string, args?: { key?: string; params?: string }) => {
      if (type === "session.get") return { mode: "ask", busy: false };
      if (type === "llm.list") {
        return args?.params
          ? REASONING_PARAMS
          : { profiles: [{ model_name: "anthropic/sonnet-4.6" }] };
      }
      if (type === "config.read") {
        return args?.key === "llm_profiles"
          ? { "anthropic/sonnet-4.6": { llm_extra_params: { reasoning_effort: "low" } } }
          : "anthropic/sonnet-4.6";
      }
      return null;
    });
    const user = userEvent.setup();
    render(
      <SecondBrainProvider>
        <ModelProbe />
      </SecondBrainProvider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("model")).toHaveTextContent("anthropic/sonnet-4.6"),
    );

    await user.click(screen.getByRole("button", { name: "Look up reasoning" }));

    await waitFor(() =>
      expect(screen.getByTestId("reasoning")).toHaveTextContent("low"),
    );
  });

  it("has no control when the backend vouches for none", async () => {
    // The common case: a model routed through a gateway under a name litellm
    // has no record of. Nothing can tell "does not reason" from "no record",
    // so neither is claimed and the row simply does not appear.
    sdk.mockImplementation(async (type: string, args?: { key?: string; params?: string }) => {
      if (type === "session.get") return { mode: "ask", busy: false };
      if (type === "llm.list") {
        return args?.params
          ? { params: [{ name: "reasoning_effort", role: "reasoning", supported: false, choices: [] }] }
          : { profiles: [{ model_name: "anthropic/sonnet-4.6" }] };
      }
      if (type === "config.read") {
        return args?.key === "llm_profiles"
          ? { "anthropic/sonnet-4.6": { llm_extra_params: { reasoning_effort: "low" } } }
          : "anthropic/sonnet-4.6";
      }
      return null;
    });
    const user = userEvent.setup();
    render(
      <SecondBrainProvider>
        <ModelProbe />
      </SecondBrainProvider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("model")).toHaveTextContent("anthropic/sonnet-4.6"),
    );

    await user.click(screen.getByRole("button", { name: "Look up reasoning" }));

    // Still none, and the stored `low` is deliberately not shown: a value the
    // backend will not vouch for is not evidence of a control.
    await waitFor(() =>
      expect(screen.getByTestId("reasoning")).toHaveTextContent("none"),
    );
  });

  it("switches the global default through config.write", async () => {
    bootWith(false);
    sdk.mockImplementation(async (type: string) => {
      if (type === "session.get") {
        return { mode: "ask", busy: false };
      }
      if (type === "llm.list") return { profiles: [] };
      if (type === "config.read") return "anthropic/sonnet-4.6";
      if (type === "config.write") return true;
      return null;
    });
    const user = userEvent.setup();
    render(
      <SecondBrainProvider>
        <ModelProbe />
      </SecondBrainProvider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("model")).toHaveTextContent("anthropic/sonnet-4.6"),
    );
    await user.click(screen.getByRole("button", { name: "Switch" }));
    await waitFor(() =>
      expect(screen.getByTestId("model")).toHaveTextContent("openrouter/gpt-5.4"),
    );
    expect(sdk).toHaveBeenCalledWith("config.write", {
      key: "default_llm_profile",
      value: "openrouter/gpt-5.4",
      scope: "plugin",
    });
  });

  /**
   * `config.write` takes one whole top-level setting, so a nested field means
   * writing `llm_profiles` back entire. Everything this does not mean to touch
   * has to survive that — the other profiles, the sibling fields of the one it
   * does touch, and above all the API key, which comes back as a handle and is
   * restored by the kernel only if the handle is written back unchanged.
   */
  it("writes one profile's effort back without disturbing the rest", async () => {
    const stored = {
      "anthropic/sonnet-4.6": {
        llm_endpoint: "https://api.anthropic.com/v1",
        secret_llm_api_key: "<secret:secret_llm_api_key>",
        llm_capabilities: { image: true, audio: false },
        llm_extra_params: { reasoning_effort: "low", temperature: 0.4 },
      },
      "openrouter/gpt-5.4": { llm_endpoint: "https://openrouter.ai/api/v1" },
    };
    sdk.mockImplementation(async (type: string, args?: { key?: string; params?: string }) => {
      if (type === "session.get") return { mode: "ask", busy: false };
      if (type === "llm.list") {
        return args?.params ? REASONING_PARAMS : { profiles: [] };
      }
      if (type === "config.read") {
        return args?.key === "llm_profiles" ? stored : "anthropic/sonnet-4.6";
      }
      if (type === "config.write") return true;
      return null;
    });
    const user = userEvent.setup();
    render(
      <SecondBrainProvider>
        <ModelProbe />
      </SecondBrainProvider>,
    );
    await user.click(screen.getByRole("button", { name: "Look up reasoning" }));
    await waitFor(() =>
      expect(screen.getByTestId("reasoning")).toHaveTextContent("low"),
    );

    await user.click(screen.getByRole("button", { name: "Think harder" }));
    await waitFor(() =>
      expect(screen.getByTestId("reasoning")).toHaveTextContent("high"),
    );

    expect(sdk).toHaveBeenCalledWith("config.write", {
      key: "llm_profiles",
      scope: "plugin",
      value: {
        "anthropic/sonnet-4.6": {
          llm_endpoint: "https://api.anthropic.com/v1",
          secret_llm_api_key: "<secret:secret_llm_api_key>",
          llm_capabilities: { image: true, audio: false },
          llm_extra_params: { reasoning_effort: "high", temperature: 0.4 },
        },
        "openrouter/gpt-5.4": { llm_endpoint: "https://openrouter.ai/api/v1" },
      },
    });
  });

  it("puts the effort back when the write is refused", async () => {
    sdk.mockImplementation(async (type: string, args?: { key?: string; params?: string }) => {
      if (type === "session.get") return { mode: "ask", busy: false };
      if (type === "llm.list") {
        return args?.params ? REASONING_PARAMS : { profiles: [] };
      }
      if (type === "config.read") {
        return args?.key === "llm_profiles"
          ? { "anthropic/sonnet-4.6": { llm_extra_params: { reasoning_effort: "low" } } }
          : "anthropic/sonnet-4.6";
      }
      if (type === "config.write") throw new Error("approval_declined");
      return null;
    });
    const user = userEvent.setup();
    render(
      <SecondBrainProvider>
        <ModelProbe />
      </SecondBrainProvider>,
    );
    await user.click(screen.getByRole("button", { name: "Look up reasoning" }));
    await waitFor(() =>
      expect(screen.getByTestId("reasoning")).toHaveTextContent("low"),
    );

    // Declining the approval dialog is a refused write like any other, and the
    // optimistic segment must not be left standing on a value nothing stored.
    await user.click(screen.getByRole("button", { name: "Think harder" }));
    await waitFor(() =>
      expect(screen.getByTestId("reasoning")).toHaveTextContent("low"),
    );
  });

  it("refuses to invent a profile the setting does not have", async () => {
    sdk.mockImplementation(async (type: string, args?: { key?: string; params?: string }) => {
      if (type === "session.get") return { mode: "ask", busy: false };
      if (type === "llm.list") {
        return args?.params ? REASONING_PARAMS : { profiles: [] };
      }
      if (type === "config.read") {
        return args?.key === "llm_profiles"
          ? { "someone/else": {} }
          : "anthropic/sonnet-4.6";
      }
      if (type === "config.write") return true;
      return null;
    });
    const user = userEvent.setup();
    render(
      <SecondBrainProvider>
        <ModelProbe />
      </SecondBrainProvider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("model")).toHaveTextContent("anthropic/sonnet-4.6"),
    );
    await user.click(screen.getByRole("button", { name: "Look up reasoning" }));

    await user.click(screen.getByRole("button", { name: "Think harder" }));
    // A profile carrying nothing but extra params reads as a configured model
    // and cannot answer, so no write at all is the right outcome.
    await waitFor(() =>
      expect(screen.getByTestId("reasoning")).toHaveTextContent("none"),
    );
    expect(sdk).not.toHaveBeenCalledWith(
      "config.write",
      expect.objectContaining({ key: "llm_profiles" }),
    );
  });
});

/**
 * What the composer is told when an attachment cannot be uploaded.
 *
 * **Yielded, never thrown**, and that is a fact about assistant-ui rather than
 * a preference: `ComposerPrimitive.AddAttachment` and the dropzone both await
 * `add` inside a `try {} catch {}` whose body is empty, so an exception is
 * discarded and the chip stays frozen on whatever it last showed. A file
 * refused for its size would then look exactly like one still uploading, for
 * ever. The red tile and its tooltip in `attachment.tsx` are drawn from the
 * status below and from nothing else.
 */
describe("an attachment that cannot be uploaded", () => {
  // The adapter's `add` is typed as "generator or promise", which is how
  // assistant-ui drives it too. Ours is always the generator.
  const drain = async (file: File) => {
    const states: PendingAttachment[] = [];
    const added = attachmentAdapter.add({ file });
    if (Symbol.asyncIterator in added) {
      for await (const state of added) states.push(state);
    } else {
      states.push(await added);
    }
    return states;
  };

  const fileOfSize = (bytes: number, name = "film.mov"): File =>
    ({
      name,
      type: "video/quicktime",
      size: bytes,
      slice: () => ({ arrayBuffer: async () => new ArrayBuffer(0) }),
    }) as unknown as File;

  it("reports the reason on the chip rather than throwing it away", async () => {
    // Over the cap in `lib/upload.ts`, which refuses before reading anything.
    const states = await drain(fileOfSize(200 * 1024 * 1024));

    expect(states.at(-1)?.status).toMatchObject({
      type: "incomplete",
      reason: "error",
      message: expect.stringContaining("100 MB"),
    });
  });

  it("claims the chip before it can fail, so there is somewhere to say so", async () => {
    const states = await drain(fileOfSize(200 * 1024 * 1024));
    expect(states[0]?.status).toMatchObject({ type: "running" });
  });

  it("finishes ready to send when the upload works", async () => {
    sdk.mockImplementation(async (type: string) =>
      type === "fs.temp" ? "/tmp/scratch.mov" : true,
    );

    const states = await drain(fileOfSize(1024));

    expect(states.at(-1)?.status).toEqual({
      type: "requires-action",
      reason: "composer-send",
    });
  });
});
