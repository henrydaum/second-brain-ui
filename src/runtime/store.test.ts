/**
 * What a message sent mid-turn does to the transcript.
 *
 * The composer can now send while the agent still has the turn — the kernel
 * queues it and drains it at the next loop boundary. The line has to land
 * *between* what the agent had already said and whatever it says next, which
 * means closing the open reply and continuing it below.
 *
 * That is a stream told in two halves, and the `done` frame carries
 * `final_text` for the whole of it. Most of what follows is about that: the
 * failure it causes is not a missing message but a doubled one. See
 * `splitOpenTurn` and `tailOf`.
 */

import { describe, expect, it } from "vitest";

import type { Frame } from "@/lib/events";
import {
  initialState,
  reduce,
  type State,
  type TextPart,
  type ToolPart,
} from "@/runtime/store";

/** Drive the reducer over a script, starting from nothing. */
const run = (...frames: Frame[]): State =>
  frames.reduce(
    (state, frame) => reduce(state, { type: "frame", frame }),
    initialState,
  );

const typing = (on: boolean) => ({ kind: "typing", payload: on }) as Frame;

const delta = (text: string, over: Record<string, unknown> = {}): Frame =>
  ({
    kind: "stream_delta",
    payload: { stream_id: "s1", delta: text, done: false, ...over },
  }) as Frame;

const toolStatus = (status: "started" | "progressed" | "finished"): Frame =>
  ({
    kind: "tool_status",
    payload: {
      kind: "tool",
      call_id: "c1",
      tool_name: "read_file",
      status,
      narration: "Reading",
      ...(status === "finished" ? { ok: true, summary: "Read it." } : {}),
    },
  }) as Frame;

/** Every text part of every turn, in order, as plain strings. */
const said = (state: State) =>
  state.turns.map((turn) =>
    turn.parts
      .filter((part): part is TextPart => part.kind === "text")
      .map((part) => part.text)
      .join(""),
  );

describe("a message sent while the agent is still talking", () => {
  it("lands under what was already said, not under the whole turn", () => {
    let state = run(typing(true), delta("Half a "));
    state = reduce(state, { type: "said", text: "one more thing" });
    state = reduce(state, { type: "frame", frame: delta("sentence.") });

    // The tail is its own message *below* the queued line — the thing the
    // single-turn reading got backwards, by writing it into the message above.
    expect(state.turns.map((turn) => turn.role)).toEqual([
      "assistant",
      "user",
      "assistant",
    ]);
    expect(said(state)).toEqual(["Half a ", "one more thing", "sentence."]);
  });

  it("leaves only one message running, so only one indicator draws", () => {
    let state = run(typing(true), delta("Half a "));
    state = reduce(state, { type: "said", text: "one more thing" });
    state = reduce(state, { type: "frame", frame: delta("sentence.") });

    expect(state.turns.filter((turn) => turn.running)).toHaveLength(1);
    expect(state.turns.at(-1)!.running).toBe(true);
  });

  it("does not repeat the first half when the stream finishes", () => {
    // `final_text` is the *whole* stream and replaces what accumulated. Landing
    // it whole in the second half is how the first half appeared twice.
    let state = run(typing(true), delta("Half a "));
    state = reduce(state, { type: "said", text: "one more thing" });
    state = reduce(state, {
      type: "frame",
      frame: delta("sentence.", { done: true, final_text: "Half a sentence." }),
    });

    expect(said(state)).toEqual(["Half a ", "one more thing", "sentence."]);
  });

  it("keeps the deltas when the cleaned text cannot be lined up", () => {
    // `final_text` is cleaned, so it need not start with what is on screen.
    // Falling back to the deltas shows the tail once; trusting `final_text`
    // would show the first half twice.
    let state = run(typing(true), delta("Half a "));
    state = reduce(state, { type: "said", text: "one more thing" });
    state = reduce(state, {
      type: "frame",
      frame: delta("sentence.", {
        done: true,
        final_text: "Something else entirely.",
      }),
    });

    expect(said(state)).toEqual(["Half a ", "one more thing", "sentence."]);
  });

  it("still recognises the whole reply if a messages frame repeats it", () => {
    let state = run(typing(true), delta("Half a "));
    state = reduce(state, { type: "said", text: "one more thing" });
    state = reduce(state, {
      type: "frame",
      frame: delta("sentence.", { done: true, final_text: "Half a sentence." }),
    });
    state = reduce(state, {
      type: "frame",
      frame: { kind: "messages", payload: ["Half a sentence."] } as Frame,
    });

    expect(said(state)).toEqual(["Half a ", "one more thing", "sentence."]);
  });

  it("moves the indicator below the line rather than leaving one above", () => {
    // `typing: true` opens a turn before there is anything to put in it. Closing
    // it in place would leave a blank running message above the person's line —
    // and dropping it without replacement would leave the agent looking stopped
    // while it works. It moves.
    let state = run(typing(true));
    state = reduce(state, { type: "said", text: "one more thing" });

    expect(state.turns.map((turn) => turn.role)).toEqual(["user", "assistant"]);
    expect(state.turns[1].parts).toEqual([]);
    expect(state.turns[1].running).toBe(true);
  });

  it("carries a call still in flight down with the reply", () => {
    // A tool-call part with no result inherits its message's status, so a
    // running call left in the closed half would draw as finished — and its
    // `finished` frame would then appear again below as a second block.
    let state = run(typing(true), delta("Looking. "), toolStatus("started"));
    state = reduce(state, { type: "said", text: "and check the logs" });

    expect(state.turns.map((turn) => turn.role)).toEqual([
      "assistant",
      "user",
      "assistant",
    ]);
    expect(state.turns[0].parts.map((part) => part.kind)).toEqual(["text"]);
    expect(state.turns[2].parts.map((part) => part.kind)).toEqual(["tool"]);

    // And the result updates that one block rather than making another.
    state = reduce(state, { type: "frame", frame: toolStatus("finished") });
    expect(state.turns).toHaveLength(3);
    expect(state.turns[2].parts).toHaveLength(1);
    expect((state.turns[2].parts[0] as ToolPart).status).toBe("finished");
  });

  it("leaves a call that already finished where it was made", () => {
    let state = run(
      typing(true),
      delta("Looked. "),
      toolStatus("started"),
      toolStatus("finished"),
    );
    state = reduce(state, { type: "said", text: "and now the logs" });

    expect(state.turns.map((turn) => turn.role)).toEqual([
      "assistant",
      "user",
      "assistant",
    ]);
    expect(state.turns[0].parts.map((part) => part.kind)).toEqual([
      "text",
      "tool",
    ]);
    expect(state.turns[2].parts).toEqual([]);
  });

  it("survives being sent twice in one reply", () => {
    let state = run(typing(true), delta("One "));
    state = reduce(state, { type: "said", text: "first" });
    state = reduce(state, { type: "frame", frame: delta("two ") });
    state = reduce(state, { type: "said", text: "second" });
    state = reduce(state, {
      type: "frame",
      frame: delta("three.", { done: true, final_text: "One two three." }),
    });

    expect(said(state)).toEqual([
      "One ",
      "first",
      "two ",
      "second",
      "three.",
    ]);
  });

  it("forgets the carried text once the turn ends", () => {
    let state = run(typing(true), delta("Half a "));
    state = reduce(state, { type: "said", text: "one more thing" });
    state = reduce(state, {
      type: "frame",
      frame: delta("sentence.", { done: true, final_text: "Half a sentence." }),
    });
    state = reduce(state, { type: "frame", frame: typing(false) });

    expect(state.carried).toEqual({});
  });
});

describe("an uninterrupted reply", () => {
  it("is still one message, with final_text replacing the deltas", () => {
    const state = run(
      typing(true),
      delta("Half a "),
      delta("sentance.", { done: true, final_text: "Half a sentence." }),
      typing(false),
    );

    expect(said(state)).toEqual(["Half a sentence."]);
    expect(state.carried).toEqual({});
  });
});

describe("approval cancellation acknowledgements", () => {
  it("keeps the exact Cancelled acknowledgement out of the conversation", () => {
    let state = reduce(initialState, {
      type: "suppressNextCancellationNotice",
    });
    state = reduce(state, {
      type: "frame",
      frame: { kind: "messages", payload: ["Cancelled."] } as Frame,
    });

    expect(state.turns).toEqual([]);
    expect(state.suppressNextCancellationNotice).toBe(false);
  });

  it("does not hide other text after an approval dialog closes", () => {
    let state = reduce(initialState, {
      type: "suppressNextCancellationNotice",
    });
    state = reduce(state, {
      type: "frame",
      frame: {
        kind: "messages",
        payload: ["The operation was cancelled after a timeout."],
      } as Frame,
    });

    expect(said(state)).toEqual([
      "The operation was cancelled after a timeout.",
    ]);
  });
});

describe("callable output", () => {
  it("routes command output to its panel while messages stay in chat", () => {
    const state = run(
      {
        kind: "tool_status",
        payload: {
          kind: "command",
          call_id: "cmd-1",
          command_name: "config",
          status: "started",
        },
      },
      { kind: "messages", payload: ["An agent reply."] },
      { kind: "callable_output", payload: ["| setting | value |"] },
    );

    expect(said(state)).toEqual(["An agent reply."]);
    expect(state.command?.outcome).toEqual(["| setting | value |"]);
  });

  it("keeps directly invoked tool output in a Settings output run", () => {
    const state = run({
      kind: "callable_output",
      payload: ["Direct result"],
    });

    expect(state.turns).toEqual([]);
    expect(state.command).toMatchObject({
      name: "output",
      status: "finished",
      outcome: ["Direct result"],
    });
  });

  it("adopts an early synthetic output run when command status follows", () => {
    let state = run({
      kind: "callable_output",
      payload: ["Project root /project"],
    });
    state = reduce(state, {
      type: "frame",
      frame: {
        kind: "tool_status",
        payload: {
          kind: "command",
          call_id: "cmd:locations:later",
          command_name: "locations",
          status: "finished",
          ok: true,
        },
      },
    });

    expect(state.command).toMatchObject({
      callId: "cmd:locations:later",
      name: "locations",
      outcome: ["Project root /project"],
    });
  });

  it("keeps command output in Settings when it beats the status frame", () => {
    let state = reduce(initialState, {
      type: "said",
      text: "/locations",
      isCommand: true,
    });
    state = reduce(state, {
      type: "frame",
      frame: { kind: "callable_output", payload: ["Project root /project"] },
    });

    expect(state.turns).toEqual([]);
    expect(state.command).toMatchObject({
      callId: "pending:locations",
      name: "locations",
      outcome: ["Project root /project"],
    });

    state = reduce(state, {
      type: "frame",
      frame: {
        kind: "tool_status",
        payload: {
          kind: "command",
          call_id: "cmd:locations:1234",
          command_name: "locations",
          status: "finished",
          ok: true,
        },
      },
    });

    expect(state.command).toMatchObject({
      callId: "cmd:locations:1234",
      status: "finished",
      outcome: ["Project root /project"],
    });
  });

  it("narrates a long command's progress on the command, not in chat", () => {
    // A package install reports what it is doing from deep inside the kernel.
    // It used to reach the person on `messages`, which put the progress of a
    // command run from Settings into the transcript — and, since a push writes
    // no history row, took it away again on the next reload.
    let state = reduce(initialState, {
      type: "said",
      text: "/packages",
      isCommand: true,
    });
    const frames: Frame[] = [
      {
        kind: "tool_status",
        payload: {
          kind: "command",
          call_id: "cmd:packages:1",
          command_name: "packages",
          status: "started",
          args: { action: "install", package_id: "memory" },
        },
      },
      {
        kind: "tool_status",
        payload: {
          kind: "command",
          call_id: "cmd:packages:1",
          command_name: "packages",
          status: "progressed",
          narration: "Copying package files",
        },
      },
    ];
    state = frames.reduce(
      (current, frame) => reduce(current, { type: "frame", frame }),
      state,
    );

    expect(said(state)).toEqual([]);
    expect(state.command).toMatchObject({
      callId: "cmd:packages:1",
      status: "progressed",
      narration: "Copying package files",
      // A progress frame says nothing about the answers already given, so it
      // must not blank them out — the panel is still showing them.
      args: { action: "install", package_id: "memory" },
    });
  });

  it("structurally ignores output from a cancelled command", () => {
    let state = run({
      kind: "tool_status",
      payload: {
        kind: "command",
        call_id: "cmd-1",
        command_name: "config",
        status: "started",
      },
    });
    state = reduce(state, { type: "said", text: "/cancel", isCommand: true });
    state = reduce(state, {
      type: "frame",
      frame: { kind: "callable_output", payload: ["Cancelled."] },
    });

    expect(state.command?.outcome).toEqual([]);
  });

  it("keeps the documented cancel Request acknowledgement out of chat", () => {
    let state = run({
      kind: "tool_status",
      payload: {
        kind: "command",
        call_id: "cmd-1",
        command_name: "locations",
        status: "started",
      },
    });
    state = reduce(state, { type: "said", text: "/cancel", isCommand: true });
    state = reduce(state, {
      type: "frame",
      frame: { kind: "messages", payload: ["Cancelled."] },
    });

    expect(state.turns).toEqual([]);
  });

  it("does not swallow a non-cancellation message after command cancellation", () => {
    let state = run({
      kind: "tool_status",
      payload: {
        kind: "command",
        call_id: "cmd-1",
        command_name: "locations",
        status: "started",
      },
    });
    state = reduce(state, { type: "said", text: "/cancel", isCommand: true });
    state = reduce(state, {
      type: "frame",
      frame: { kind: "messages", payload: ["An overlapping agent reply."] },
    });

    expect(said(state)).toEqual(["An overlapping agent reply."]);
  });
});

describe("sent attachment hydration", () => {
  it("replaces optimistic names with the cached paths from conv.read", () => {
    let state = reduce(initialState, {
      type: "said",
      text: "Look at this",
      attachments: [
        {
          fileName: "chart.png",
          modality: "image",
          extension: "png",
        },
      ],
    });
    state = reduce(state, {
      type: "hydrateSentAttachments",
      attachments: [
        {
          path: "/workspace/attachments/1_chart.png",
          fileName: "chart.png",
          modality: "image",
          extension: "png",
        },
      ],
    });

    expect(state.turns[0]?.parts[0]).toMatchObject({
      kind: "files",
      paths: ["/workspace/attachments/1_chart.png"],
      attachments: [
        { path: "/workspace/attachments/1_chart.png", fileName: "chart.png" },
      ],
    });
  });
});

/**
 * A compaction marker arriving after the fact.
 *
 * `/compact` writes a stored row and no frame announces it, so the provider
 * reads it back and hands it over — without disturbing the command panel that
 * is reporting the compaction at that moment.
 */
describe("compaction markers", () => {
  const marker = {
    id: "stored-7",
    role: "system" as const,
    parts: [
      { kind: "text" as const, streamId: "stored-7", text: "A summary", done: true },
    ],
    running: false,
    aborted: false,
    createdAt: 1786732595340,
  };

  it("lands at the end of the transcript without touching what is on screen", () => {
    const said = reduce(initialState, { type: "said", text: "Hello" });
    const state = reduce(said, { type: "compacted", turn: marker });

    expect(state.turns.map((turn) => turn.role)).toEqual(["user", "system"]);
    expect(state.turns[0]).toBe(said.turns[0]);
  });

  it("draws one line however many times the same marker is read", () => {
    const once = reduce(initialState, { type: "compacted", turn: marker });
    const twice = reduce(once, { type: "compacted", turn: marker });

    expect(twice).toBe(once);
    expect(twice.turns).toHaveLength(1);
  });
});

/**
 * The narration ends up in one place, whichever way the wire sent it.
 *
 * The model writes it as a reserved argument; the wire also lifts it out to a
 * field of its own. Only the argument is stored, so a conversation read back
 * has only that — and a client keeping both would show the blurb while you
 * watched and lose it on reload. See `toolArgs`.
 */
describe("tool narration", () => {
  const tool = (over: Record<string, unknown>): Frame =>
    ({
      kind: "tool_status",
      payload: { kind: "tool", call_id: "c1", tool_name: "read_file", ...over },
    }) as Frame;

  const argsOf = (state: State) => {
    const part = state.turns
      .flatMap((turn) => turn.parts)
      .find((p): p is ToolPart => p.kind === "tool");
    return part?.args;
  };

  it("folds the lifted field in beside the arguments", () => {
    const state = run(
      tool({ status: "started", args: { path: "/etc/x" }, narration: "Checking the config" }),
    );
    expect(argsOf(state)).toEqual({
      path: "/etc/x",
      narration: "Checking the config",
    });
  });

  it("leaves a narration the model wrote as an argument alone", () => {
    const state = run(
      tool({ status: "started", args: { narration: "as written" }, narration: "lifted" }),
    );
    expect(argsOf(state)).toEqual({ narration: "as written" });
  });

  it("adds nothing to a call that was never narrated", () => {
    const state = run(tool({ status: "started", args: { path: "/etc/x" } }));
    expect(argsOf(state)).toEqual({ path: "/etc/x" });
  });

  it("carries it across a later frame that brings arguments without it", () => {
    // `narration` is repeated on `finished` deliberately, but a kernel that
    // omitted it must not take back what `started` established.
    const state = run(
      tool({ status: "started", narration: "Checking the config" }),
      tool({ status: "finished", args: { path: "/etc/x" }, ok: true, summary: "Read it." }),
    );
    expect(argsOf(state)).toEqual({
      path: "/etc/x",
      narration: "Checking the config",
    });
  });
});
